"""
map.py — 노선도 geometry API

  GET /map/rail-routes/all/geometry        ← rail_computed_geometry 전체 노선 (line_type 포함)
  GET /map/rail-routes/all/stations        ← KP 기반 역 위치 (rail_baseline_points station_center)
  GET /map/rail-routes/all/facility-items  ← rail_facilities 시설물 GeoJSON (is_active=1)
  GET /map/organizations/{id}/boundaries   ← 조직 관할 구간 경계 (KP 기반)
  GET /map/organizations/{id}/viewport     ← 조직 초기 뷰 설정
  GET /map/rail-route-region-boundaries    ← 노선별 구역 경계 GeoJSON
  GET /map/block-orders/segments           ← 차단명령 구간 GeoJSON (날짜 필터)
  GET /map/sigungu?level=1|2               ← 시도/시군구 경계 GeoJSON (정적 파일, 대한민국 지도)
"""

import json
import re
from datetime import date as date_type
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.block_order import BlockOrder
from app.models.facility import Facility
from app.models.org_viewport import OrgViewport
from app.models.organization import Organization, OrganizationRouteRange
from app.models.rail_baseline import RailFacility, RailFacilityClassification, RailRoute, RailRouteRegionBoundary
from app.models.route import Route
from app.models.user import User

router = APIRouter(prefix="/map", tags=["노선도"])


# ── center_only 모드: rail_baseline_points(station_center) 기반 노선 ──────

def _get_geometry_center_only(db, line_type: str | None) -> dict:
    """
    station_mode=center_only: station_yard_start/end 제외한 앵커로 노선 geometry 반환.
    포함: station_center, facility_point, facility_start, facility_end (터널·교량 경계 포함)
    제외: station_yard_start, station_yard_end (역 진입로 굴곡 방지)
    """
    where_type = "AND rr.line_type = :line_type" if line_type else ""
    rows = db.execute(
        text(f"""
            SELECT
                rbp.rail_route_id,
                rr.korail_route_code,
                rr.name          AS route_name,
                rr.line_type,
                rr.default_track_count,
                rr.default_has_catenary,
                rbp.kp,
                rbp.lat,
                rbp.lon,
                rbp.seq
            FROM rail_baseline_points rbp
            JOIN rail_routes rr ON rr.id = rbp.rail_route_id
            WHERE rbp.point_type IN {_CENTER_ONLY_POINT_TYPES}
              AND rbp.is_render_anchor = TRUE
              AND rr.is_active = TRUE
              {where_type}
            ORDER BY rbp.rail_route_id, rbp.segment_no, rbp.kp, rbp.seq
        """),
        {**({"line_type": line_type} if line_type else {})},
    ).fetchall()

    sections_rows = db.execute(
        text("""
            SELECT rail_route_id, start_kp, end_kp, track_count, has_catenary, note
            FROM rail_track_sections
            ORDER BY rail_route_id, start_kp
        """)
    ).fetchall()
    sections_by_route: dict[int, list] = {}
    for s in sections_rows:
        rid = s.rail_route_id
        if rid not in sections_by_route:
            sections_by_route[rid] = []
        sections_by_route[rid].append({
            "start_kp":     s.start_kp,
            "end_kp":       s.end_kp,
            "track_count":  s.track_count,
            "has_catenary": bool(s.has_catenary),
            "note":         s.note,
        })

    from itertools import groupby as _groupby
    features = []
    for route_id, pts in _groupby(rows, key=lambda r: r.rail_route_id):
        pts_list = list(pts)
        if not pts_list:
            continue
        first = pts_list[0]
        coordinates = [[r.lon, r.lat, round(r.kp, 3)] for r in pts_list]
        features.append({
            "type": "Feature",
            "properties": {
                "rail_route_id":        route_id,
                "korail_route_code":    first.korail_route_code,
                "route_name":           first.route_name,
                "line_type":            first.line_type,
                "default_track_count":  first.default_track_count,
                "default_has_catenary": bool(first.default_has_catenary),
                "track_sections":       sections_by_route.get(route_id, []),
                "lod":                  "center_only",
                "point_count":          len(coordinates),
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })
    return {"type": "FeatureCollection", "features": features}


# ── rail_computed_geometry 전체 노선 ─────────────────────────────────────
# 주의: /rail-routes/{id}/... 보다 먼저 등록

@router.get("/rail-routes/all/geometry")
def get_all_rail_routes_geometry(
    lod: str = Query("high", pattern="^(high|mid|low)$"),
    line_type: str | None = Query(None, description="고속선 | 일반선"),
    station_mode: str = Query("center_only", description="역 좌표 모드: center_only | all_points"),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """노선 GeoJSON 반환.

    station_mode=center_only (기본):
      rail_baseline_points의 station_center 포인트만 사용 — 예상치 못한 굴곡 방지
    station_mode=all_points:
      rail_computed_geometry 사용 (시점·중앙·종점 모두 포함한 사전계산 데이터)

    properties:
      - korail_route_code, route_name, line_type
      - default_track_count: 노선 기본 선로 수 (1/2/4/6)
      - default_has_catenary: 노선 기본 전차선 유무
      - track_sections: KP 구간별 선로수·전차선 예외 목록
    coordinates: [lon, lat, kp] — GeoJSON 3D 좌표 (세 번째 값 = KP)
    """
    if station_mode == "center_only":
        return _get_geometry_center_only(db, line_type)

    where_type = "AND rcg.line_type = :line_type" if line_type else ""
    rows = db.execute(
        text(f"""
            SELECT
                rcg.rail_route_id,
                rr.korail_route_code,
                rr.name  AS route_name,
                rcg.line_type,
                rr.default_track_count,
                rr.default_has_catenary,
                rcg.kp,
                rcg.lat,
                rcg.lon,
                rcg.seq
            FROM rail_computed_geometry rcg
            JOIN rail_routes rr ON rr.id = rcg.rail_route_id
            WHERE rcg.lod = :lod AND rr.is_active = TRUE {where_type}
            ORDER BY rcg.rail_route_id, rcg.seq
        """),
        {"lod": lod, **({"line_type": line_type} if line_type else {})},
    ).fetchall()

    # 노선별 rail_track_sections 조회 (KP 예외 구간)
    sections_rows = db.execute(
        text("""
            SELECT rail_route_id, start_kp, end_kp, track_count, has_catenary, note
            FROM rail_track_sections
            ORDER BY rail_route_id, start_kp
        """)
    ).fetchall()
    sections_by_route: dict[int, list] = {}
    for s in sections_rows:
        rid = s.rail_route_id
        if rid not in sections_by_route:
            sections_by_route[rid] = []
        sections_by_route[rid].append({
            "start_kp":    s.start_kp,
            "end_kp":      s.end_kp,
            "track_count": s.track_count,
            "has_catenary": bool(s.has_catenary),
            "note":        s.note,
        })

    from itertools import groupby as _groupby

    features = []
    for route_id, pts in _groupby(rows, key=lambda r: r.rail_route_id):
        pts_list = list(pts)
        if not pts_list:
            continue
        first = pts_list[0]
        # [lon, lat, kp] — KP를 세 번째 좌표로 포함
        coordinates = [[r.lon, r.lat, round(r.kp, 3)] for r in pts_list]
        features.append({
            "type": "Feature",
            "properties": {
                "rail_route_id":        route_id,
                "korail_route_code":    first.korail_route_code,
                "route_name":           first.route_name,
                "line_type":            first.line_type,
                "default_track_count":  first.default_track_count,
                "default_has_catenary": bool(first.default_has_catenary),
                "track_sections":       sections_by_route.get(route_id, []),
                "lod":                  lod,
                "point_count":          len(coordinates),
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })

    return {"type": "FeatureCollection", "features": features}


# ── 기지 노선 목록 (line_type='기지') ──────────────────────────────────────

@router.get("/rail-routes/depots")
def get_depot_routes(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """차단명령 등록 폼용 기지 노선 목록. line_type='기지'인 rail_routes만 반환."""
    rows = db.query(RailRoute).filter(
        RailRoute.line_type == "기지",
        RailRoute.is_active.is_(True),
    ).order_by(RailRoute.name).all()
    return [
        {
            "id":                 r.id,
            "name":               r.name,
            "korail_route_code":  r.korail_route_code,
            "start_kp":           r.start_kp,
            "end_kp":             r.end_kp,
            "route_category":     r.route_category,
        }
        for r in rows
    ]


# ── 전차선단전용 변전설비 목록 ───────────────────────────────────────────────

@router.get("/rail-routes/substations")
def get_rail_substations(
    route_id: int | None = Query(None, description="OLD routes.id — rail_routes와 이름 매칭"),
    rail_route_id: int | None = Query(None, description="NEW rail_routes.id (직접 지정)"),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """전차선단전 등록 폼용 변전설비 목록 (SS/SP/SSP/PP/ATP 등).

    route_id(OLD routes) 또는 rail_route_id(NEW rail_routes) 중 하나를 전달.
    route_id 전달 시 routes.name = rail_routes.name 으로 매칭.
    """
    import re as _re

    resolved_rail_route_id: int | None = rail_route_id
    if resolved_rail_route_id is None and route_id is not None:
        old_route = db.query(Route).filter(Route.id == route_id).first()
        if old_route:
            base_name = _re.sub(r'\s*\([^)]*\)\s*$', '', old_route.name).strip()
            rail_route = db.query(RailRoute).filter(
                (RailRoute.name == old_route.name) | (RailRoute.name == base_name)
            ).first()
            if rail_route:
                resolved_rail_route_id = rail_route.id

    if resolved_rail_route_id is None:
        return []

    rows = (
        db.query(RailFacility, RailFacilityClassification)
        .join(RailFacilityClassification, RailFacilityClassification.id == RailFacility.classification_id)
        .filter(
            RailFacility.rail_route_id == resolved_rail_route_id,
            RailFacility.is_active.is_(True),
            RailFacilityClassification.major_category == "전기설비",
            RailFacilityClassification.sub_category == "변전설비",
        )
        .order_by(RailFacility.kp_start)
        .all()
    )

    return [
        {
            "id":              rf.id,
            "name":            rf.name,
            "kp":              rf.kp_start,
            "detail_category": cls.detail_category,
            "lat":             rf.lat,
            "lon":             rf.lon,
        }
        for rf, cls in rows
        if rf.kp_start is not None
    ]


# ── KP 기반 역 위치 (rail_baseline_points station_center) ─────────────────

@router.get("/rail-routes/all/stations")
def get_all_rail_stations(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """rail_baseline_points(station_center) 기반 전 노선 역 위치 GeoJSON.

    GPS 좌표는 실측 anchor 값 — km 보간이 아닌 실좌표.
    FacilityCollection 형식으로 반환하여 기존 시설물 레이어와 병합 가능.
    """
    rows = db.execute(
        text("""
            SELECT
                rbp.id,
                rr.korail_route_code,
                rr.name   AS route_name,
                rbp.kp,
                rbp.lat,
                rbp.lon,
                rs.name   AS station_name,
                rs.station_type,
                rs.station_role
            FROM rail_baseline_points rbp
            JOIN rail_routes rr ON rr.id = rbp.rail_route_id
            JOIN rail_stations rs ON rs.id = rbp.station_id
            WHERE rbp.point_type = 'station_center'
              AND rbp.is_interpolation_anchor = TRUE
              AND rbp.lat IS NOT NULL
              AND rbp.lon IS NOT NULL
              AND rbp.station_id IS NOT NULL
            ORDER BY rbp.rail_route_id, rbp.kp
        """)
    ).fetchall()

    features = []
    for r in rows:
        station_type = r.station_type or (
            '관리역' if r.station_role == '관리역' else '보통역'
        )
        features.append({
            "type": "Feature",
            "properties": {
                "id":            r.id,
                "type":          "역",
                "station_type":  station_type,
                "name":          r.station_name,
                "km":            r.kp,
                "km_end":        None,
                "direction":     None,
                "has_station_map": False,
                "note":          None,
                "route_code":    r.korail_route_code,
                "route_name":    r.route_name,
            },
            "geometry": {
                "type":        "Point",
                "coordinates": [r.lon, r.lat],
            },
        })

    return {"type": "FeatureCollection", "features": features}


# ── rail_facilities 시설물 GeoJSON ────────────────────────────────────────

@router.get("/rail-routes/all/facility-items")
def get_all_rail_facility_items(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text("""
            SELECT rf.id,
                   rr.korail_route_code,
                   rr.name AS route_name,
                   rf.kp_start, rf.kp_end,
                   rf.lat, rf.lon,
                   rf.lat_end, rf.lon_end,
                   rf.name AS facility_name,
                   rf.direction, rf.note, rf.bore_type,
                   c.major_category, c.sub_category, c.detail_category, c.geometry_type
            FROM rail_facilities rf
            JOIN rail_routes rr ON rr.id = rf.rail_route_id
            JOIN rail_facility_classifications c ON c.id = rf.classification_id
            WHERE rf.is_active = TRUE AND rf.kp_start IS NOT NULL
            ORDER BY rr.korail_route_code, rf.kp_start
        """)
    ).fetchall()

    features = []
    for r in rows:
        if r.major_category == '구조물':
            ftype = '구조물'
            station_type = r.sub_category
        else:
            ftype = '변전소'
            station_type = (r.detail_category or r.sub_category or '').lower() or None

        if (r.geometry_type == 'linear'
                and r.lat is not None and r.lon is not None
                and r.lat_end is not None and r.lon_end is not None):
            geometry = {
                "type": "LineString",
                "coordinates": [[r.lon, r.lat], [r.lon_end, r.lat_end]],
            }
        elif r.lat is not None and r.lon is not None:
            geometry = {
                "type": "Point",
                "coordinates": [r.lon, r.lat],
            }
        else:
            continue

        features.append({
            "type": "Feature",
            "properties": {
                "id":            r.id,
                "type":          ftype,
                "station_type":  station_type,
                "name":          r.facility_name,
                "km":            r.kp_start,
                "km_end":        r.kp_end,
                "direction":     r.direction,
                "bore_type":     r.bore_type or '복선',
                "has_station_map": False,
                "note":          r.note,
                "route_code":    r.korail_route_code,
                "route_name":    r.route_name,
            },
            "geometry": geometry,
        })

    return {"type": "FeatureCollection", "features": features}


# ── 조직 관할 구간 경계 (KP 기반) ─────────────────────────────────────────

@router.get("/organizations/{org_id}/boundaries")
def get_org_boundaries(
    org_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="조직을 찾을 수 없습니다")

    ranges = (
        db.query(OrganizationRouteRange)
        .filter(OrganizationRouteRange.organization_id == org_id)
        .all()
    )

    rail_route_ids = {rng.rail_route_id for rng in ranges}
    rail_route_map = {
        r.id: r
        for r in db.query(RailRoute).filter(RailRoute.id.in_(rail_route_ids)).all()
    }

    features = []
    for rng in ranges:
        rail_route = rail_route_map.get(rng.rail_route_id)
        if not rail_route:
            continue

        coords = _rail_kp_range_coords(db, rail_route.id, rng.start_km, rng.end_km)
        if len(coords) < 2:
            continue

        features.append({
            "type": "Feature",
            "properties": {
                "organization_id":   org_id,
                "organization_name": org.name,
                "route_code":        rail_route.korail_route_code,
                "route_name":        rail_route.name,
                "field":             rng.field,
                "start_km":          rng.start_km,
                "end_km":            rng.end_km,
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })

    return {"type": "FeatureCollection", "features": features}


# ── 조직 초기 viewport ────────────────────────────────────────────────────

@router.get("/organizations/{org_id}/viewport")
def get_org_viewport(
    org_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="조직을 찾을 수 없습니다")

    vp = db.query(OrgViewport).filter(OrgViewport.organization_id == org_id).first()
    if not vp:
        return {
            "organization_id":   org_id,
            "organization_name": org.name,
            "center_lat":        36.5,
            "center_lon":        127.5,
            "zoom_level":        2.5,
        }

    return {
        "organization_id":   org_id,
        "organization_name": org.name,
        "center_lat":        vp.center_lat,
        "center_lon":        vp.center_lon,
        "zoom_level":        vp.zoom_level,
    }


# ── KP → (lat, lon) 보간 헬퍼 (rail_baseline_points 기반) ─────────────────

# center_only 모드에서 허용되는 point_type
# - station_center: 역 중심 GPS (포함)
# - facility_point: 변전소 등 점 시설물 (포함)
# - facility_start/end: 터널·교량 경계점 → 본선 위에 있으므로 포함
# - station_yard_start/end: 역 구내 진입로 → 곡선 유발, 제외
_CENTER_ONLY_POINT_TYPES = "('station_center', 'facility_point', 'facility_start', 'facility_end')"


def _get_station_mode(db: Session) -> str:
    """system_settings에서 station_points_mode를 읽어 반환. 기본 'center_only'."""
    row = db.execute(
        text("""
            SELECT value FROM system_settings
            WHERE category = 'map_settings' AND key = 'station_points_mode'
        """)
    ).fetchone()
    return row[0] if row else 'center_only'


def _interpolate_rail_kp(
    db: Session,
    rail_route_id: int,
    kp: float,
    center_only: bool = False,
) -> tuple[float, float] | None:
    pt_filter = f"AND point_type IN {_CENTER_ONLY_POINT_TYPES}" if center_only else ""
    rows = db.execute(
        text(f"""
            SELECT lat, lon, kp
            FROM rail_baseline_points
            WHERE rail_route_id=:rail_route_id
              AND is_interpolation_anchor = TRUE
              {pt_filter}
            ORDER BY segment_no, kp, seq
        """),
        {"rail_route_id": rail_route_id},
    ).fetchall()

    if not rows:
        return None
    if kp <= rows[0].kp:
        return (rows[0].lat, rows[0].lon)
    if kp >= rows[-1].kp:
        return (rows[-1].lat, rows[-1].lon)

    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        if a.kp <= kp <= b.kp:
            if b.kp == a.kp:
                return (a.lat, a.lon)
            t = (kp - a.kp) / (b.kp - a.kp)
            return (a.lat + t * (b.lat - a.lat), a.lon + t * (b.lon - a.lon))

    return None


def _rail_kp_range_coords(
    db: Session,
    rail_route_id: int,
    start_kp: float,
    end_kp: float,
    center_only: bool = False,
) -> list[list[float]]:
    start, end = sorted((start_kp, end_kp))
    pt_filter = f"AND point_type IN {_CENTER_ONLY_POINT_TYPES}" if center_only else ""
    rows = db.execute(
        text(f"""
            SELECT lat, lon, kp
            FROM rail_baseline_points
            WHERE rail_route_id=:rail_route_id
              AND is_render_anchor = TRUE
              {pt_filter}
            ORDER BY segment_no, kp, seq
        """),
        {"rail_route_id": rail_route_id},
    ).fetchall()

    if not rows:
        return []

    coords: list[list[float]] = []

    # ── 맥락 앵커 포함 (법선 방향 오차 방지) ─────────────────────────────
    # buildOffsetPath는 각 포인트의 수직 방향을 이웃 포인트로 계산한다.
    # 블록 시작점의 앞 앵커(start 직전)가 없으면 노선 경로와 법선 방향이 달라져
    # 오프셋 위치가 어긋난다. → start 직전 앵커 1개를 맥락으로 선행 추가.
    before_rows = [r for r in rows if r.kp <= start]
    if before_rows:
        prev = before_rows[-1]
        coords.append([prev.lon, prev.lat])

    start_pt = _interpolate_rail_kp(db, rail_route_id, start, center_only=center_only)
    if start_pt:
        coord = [start_pt[1], start_pt[0]]
        if not coords or coords[-1] != coord:
            coords.append(coord)

    for r in rows:
        if start < r.kp < end:
            coord = [r.lon, r.lat]
            if not coords or coords[-1] != coord:
                coords.append(coord)

    end_pt = _interpolate_rail_kp(db, rail_route_id, end, center_only=center_only)
    if end_pt:
        coord = [end_pt[1], end_pt[0]]
        if not coords or coords[-1] != coord:
            coords.append(coord)

    # end 직후 앵커 1개도 추가 (종료점 법선 오차 방지)
    after_rows = [r for r in rows if r.kp > end]
    if after_rows:
        nxt = after_rows[0]
        coord = [nxt.lon, nxt.lat]
        if not coords or coords[-1] != coord:
            coords.append(coord)

    return coords


# ── 노선별 구역 경계 GeoJSON ─────────────────────────────────────────────

@router.get("/rail-route-region-boundaries")
def get_rail_route_region_boundaries(
    rail_route_id: int | None = Query(None, description="rail_routes 노선 ID 필터"),
    organization_id: int | None = Query(None, description="지역본부 organization ID 필터"),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = (
        db.query(RailRouteRegionBoundary, RailRoute, Organization)
        .join(RailRoute, RailRoute.id == RailRouteRegionBoundary.rail_route_id)
        .join(Organization, Organization.id == RailRouteRegionBoundary.organization_id)
    )
    if rail_route_id is not None:
        q = q.filter(RailRouteRegionBoundary.rail_route_id == rail_route_id)
    if organization_id is not None:
        q = q.filter(RailRouteRegionBoundary.organization_id == organization_id)

    rows = q.order_by(
        RailRouteRegionBoundary.rail_route_id,
        RailRouteRegionBoundary.start_kp,
        RailRouteRegionBoundary.organization_id,
    ).all()

    features = []
    for boundary, route, org in rows:
        coords = _rail_kp_range_coords(db, boundary.rail_route_id, boundary.start_kp, boundary.end_kp)
        if len(coords) < 2:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "id": boundary.id,
                "organization_id": boundary.organization_id,
                "organization_name": org.name,
                "rail_route_id": boundary.rail_route_id,
                "route_code": route.korail_route_code,
                "route_name": route.name,
                "boundary_type": boundary.boundary_type,
                "start_kp": boundary.start_kp,
                "end_kp": boundary.end_kp,
                "source_type": boundary.source_type,
                "source_id": boundary.source_id,
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })

    return {"type": "FeatureCollection", "features": features}


# ── 차단명령 구간 GeoJSON ─────────────────────────────────────────────────

@router.get("/block-orders/segments")
def get_block_order_segments(
    work_date: date_type | None = Query(None, description="조회 날짜 (YYYY-MM-DD), 미입력 시 오늘"),
    route_id: int | None = Query(None, description="legacy 노선 ID 필터"),
    rail_route_id: int | None = Query(None, description="rail_routes 노선 ID 필터"),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from datetime import date as today_date
    target_date = work_date or today_date.today()

    # 설정값에 따라 노선도 렌더링과 동일한 앵커 셋 사용 (일관성 유지)
    # center_only: station_center + facility_point/start/end 사용 (station_yard 제외)
    # all_points:  전체 앵커 사용 (station_yard 포함)
    center_only = (_get_station_mode(db) == 'center_only')

    q = db.query(BlockOrder).filter(BlockOrder.work_date == target_date)
    if route_id is not None:
        q = q.filter(BlockOrder.route_id == route_id)
    if rail_route_id is not None:
        q = q.filter(BlockOrder.rail_route_id == rail_route_id)

    rows = q.order_by(BlockOrder.rail_route_id, BlockOrder.route_id, BlockOrder.start_kp).all()

    features = []
    for bo in rows:
        legacy_route = db.query(Route).filter(Route.id == bo.route_id).first() if bo.route_id else None
        rail_route = (
            db.query(RailRoute).filter(RailRoute.id == bo.rail_route_id).first()
            if bo.rail_route_id
            else None
        )
        route_name = rail_route.name if rail_route else (legacy_route.name if legacy_route else None)
        route_code = (
            rail_route.korail_route_code
            if rail_route
            else (legacy_route.code if legacy_route else None)
        )
        start_kp = bo.start_kp if bo.start_kp is not None else bo.start_km
        end_kp = bo.end_kp if bo.end_kp is not None else bo.end_km

        if start_kp is None and end_kp is None:
            # 전차선 단전 구간 — 변전소 KP 보간 우선, GPS fallback
            section_type = "power_cut"

            # NEW: rail_facilities FK 우선 — KP 보간으로 실제 노선 경로 표시
            if bo.start_rail_facility_id and bo.end_rail_facility_id:
                rf_start = db.query(RailFacility).filter(RailFacility.id == bo.start_rail_facility_id).first()
                rf_end   = db.query(RailFacility).filter(RailFacility.id == bo.end_rail_facility_id).first()
                if rf_start is None or rf_end is None:
                    continue
                pcut_kp_start = rf_start.kp_start
                pcut_kp_end   = rf_end.kp_start
                if bo.rail_route_id and pcut_kp_start is not None and pcut_kp_end is not None:
                    coords = _rail_kp_range_coords(db, bo.rail_route_id, pcut_kp_start, pcut_kp_end, center_only=center_only)
                elif rf_start.lat and rf_start.lon and rf_end.lat and rf_end.lon:
                    # rail_route_id 없을 때만 GPS 직선 fallback
                    coords = [[rf_start.lon, rf_start.lat], [rf_end.lon, rf_end.lat]]
                else:
                    continue
                start_kp = pcut_kp_start
                end_kp   = pcut_kp_end
                display_km = f"{pcut_kp_start}~{pcut_kp_end}"
                section_note = bo.section_note or f"{rf_start.name}~{rf_end.name}"
            else:
                # LEGACY: OLD facilities FK fallback
                f_start = db.query(Facility).filter(Facility.id == bo.start_facility_id).first() \
                    if bo.start_facility_id else None
                f_end   = db.query(Facility).filter(Facility.id == bo.end_facility_id).first() \
                    if bo.end_facility_id else None
                if f_start is None or f_end is None:
                    continue
                if bo.rail_route_id and f_start.km is not None and f_end.km is not None:
                    coords = _rail_kp_range_coords(db, bo.rail_route_id, f_start.km, f_end.km, center_only=center_only)
                    start_kp = f_start.km
                    end_kp   = f_end.km
                elif f_start.lat and f_start.lon and f_end.lat and f_end.lon:
                    coords = [[f_start.lon, f_start.lat], [f_end.lon, f_end.lat]]
                else:
                    continue
                display_km = f"{f_start.km}~{f_end.km}"
                section_note = bo.section_note or f"{f_start.name}~{f_end.name}"
        else:
            section_type = "normal"
            if start_kp is None or end_kp is None:
                continue
            coords = (
                _rail_kp_range_coords(db, bo.rail_route_id, start_kp, end_kp, center_only=center_only)
                if bo.rail_route_id
                else []
            )
            display_km = f"{start_kp}~{end_kp}"
            section_note = bo.section_note

        if len(coords) < 2:
            continue

        # 노선 선로 수 조회: KP 구간 우선, 없으면 노선 기본값
        # 2복선/3복선 구간에서 상1/상2 등을 정확한 선로 위치에 표시하기 위해
        # rail_track_sections에서 해당 KP 중간점의 선로 수를 먼저 확인한다.
        route_track_count = 2
        if rail_route:
            route_track_count = rail_route.default_track_count or 2
            # KP 범위가 있을 때 구간별 실제 선로 수 확인
            _s_kp = start_kp if start_kp is not None else bo.start_km
            _e_kp = end_kp   if end_kp   is not None else bo.end_km
            if _s_kp is not None and _e_kp is not None:
                mid_kp = (_s_kp + _e_kp) / 2
                _sec = db.execute(
                    text("""
                        SELECT track_count FROM rail_track_sections
                        WHERE rail_route_id = :rid
                          AND start_kp <= :kp AND end_kp >= :kp
                        LIMIT 1
                    """),
                    {"rid": rail_route.id, "kp": mid_kp},
                ).fetchone()
                if _sec:
                    route_track_count = int(_sec.track_count)

        # tracks: 선로별 feature 1개씩 생성
        import json as _json
        try:
            track_list = _json.loads(bo.tracks) if isinstance(bo.tracks, str) else bo.tracks
        except Exception:
            track_list = ["상선"]
        for track_val in track_list:
            features.append({
                "type": "Feature",
                "properties": {
                    "id":                bo.id,
                    "route_id":          bo.route_id,
                    "rail_route_id":     bo.rail_route_id,
                    "route_code":        route_code,
                    "route_name":        route_name,
                    "track":             track_val,
                    "route_track_count": route_track_count,
                    "section_type":      section_type,
                    "start_km":          bo.start_km,
                    "end_km":            bo.end_km,
                    "start_kp":          start_kp,
                    "end_kp":            end_kp,
                    "section_note":      section_note,
                    "display_km":        display_km,
                    "work_date":         bo.work_date.isoformat(),
                    "start_time":        bo.start_time.strftime("%H:%M"),
                    "end_time":          bo.end_time.strftime("%H:%M"),
                    "field":             bo.field,
                    "block_type":        bo.block_type,
                    "work_type":         bo.work_type,
                    "implementer":       bo.implementer,
                    "danger_level":      bo.danger_level,
                    "organization_id":   bo.organization_id,
                },
                "geometry": {"type": "LineString", "coordinates": coords},
            })

    return {"type": "FeatureCollection", "features": features, "work_date": target_date.isoformat()}


# ── 시군구 배경 지도 (정적 GeoJSON 파일 — 대한민국 지도, 삭제 금지) ─────────────

_MAP_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "maps" / "data"


@lru_cache(maxsize=2)
def _load_geojson(filename: str) -> dict:
    path = _MAP_DATA_DIR / filename
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/sigungu")
def get_sigungu(
    level: int = Query(2),
    _: User = Depends(get_current_user),
):
    # level=1 → 시도만, level=2 → 시도+시군구 모두
    features = _load_geojson("korea_map_level1.geojson")["features"]
    if level >= 2:
        features = features + _load_geojson("korea_map_level2.geojson")["features"]
    return {"type": "FeatureCollection", "features": features}
