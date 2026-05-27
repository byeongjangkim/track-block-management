"""
map.py — 노선도 geometry API

  GET /map/routes/all/geometry        ← 전체 노선
  GET /map/routes/{code}/geometry     ← 단일 노선
  GET /map/routes/{code}/facilities   ← 노선 시설물 GeoJSON (km 보간 포함)
  GET /map/organizations/{id}/boundaries  ← 조직 관할 구간 경계
  GET /map/organizations/{id}/viewport    ← 조직 초기 뷰 설정
  GET /map/block-orders/segments          ← 차단명령 구간 GeoJSON (날짜 필터)
  GET /map/sigungu?level=1|2              ← 시도/시군구 경계 GeoJSON (정적 파일)
"""

import json
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
from app.models.rail_baseline import RailRoute, RailRouteRegionBoundary
from app.models.route import Route
from app.models.route_geometry import RouteGeometry
from app.models.user import User

router = APIRouter(prefix="/map", tags=["노선도"])

SOURCE_PRIORITY = ("user", "shp")  # user 우선, 없으면 shp


# ── 전체 노선 geometry ────────────────────────────────────────────────────
# 주의: /routes/{code}/geometry 보다 먼저 등록해야 'all'이 code로 매칭되지 않음

@router.get("/routes/all/geometry")
def get_all_routes_geometry(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # (route_code, source) 조합 — user 있으면 user만, 없으면 shp
    route_codes = db.execute(
        text("SELECT DISTINCT route_code FROM route_geometry ORDER BY route_code")
    ).scalars().all()

    features = []
    for code in route_codes:
        # user 우선, 없으면 shp
        source = db.execute(
            text("SELECT source FROM route_geometry WHERE route_code=:code AND source='user' LIMIT 1"),
            {"code": code},
        ).scalar() or "shp"

        segments = db.execute(
            text("SELECT DISTINCT segment FROM route_geometry "
                 "WHERE route_code=:code AND source=:src AND lod='high' ORDER BY segment"),
            {"code": code, "src": source},
        ).scalars().all()

        for seg in segments:
            rows = (
                db.query(RouteGeometry.lat, RouteGeometry.lon)
                .filter(
                    RouteGeometry.route_code == code,
                    RouteGeometry.source == source,
                    RouteGeometry.lod == "high",
                    RouteGeometry.segment == seg,
                )
                .order_by(RouteGeometry.seq)
                .all()
            )
            if not rows:
                continue
            coordinates = [[row.lon, row.lat] for row in rows]
            features.append({
                "type": "Feature",
                "properties": {
                    "route_code":  code,
                    "source":      source,
                    "segment":     seg,
                    "point_count": len(coordinates),
                },
                "geometry": {"type": "LineString", "coordinates": coordinates},
            })

    return {"type": "FeatureCollection", "features": features}


# ── 단일 노선 geometry ────────────────────────────────────────────────────

@router.get("/routes/{code}/geometry")
def get_route_geometry(
    code: str,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    source = db.execute(
        text("SELECT source FROM route_geometry WHERE route_code=:code AND source='user' LIMIT 1"),
        {"code": code},
    ).scalar() or "shp"

    segments = db.execute(
        text("SELECT DISTINCT segment FROM route_geometry "
             "WHERE route_code=:code AND source=:src AND lod='high' ORDER BY segment"),
        {"code": code, "src": source},
    ).scalars().all()

    if not segments:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"노선 '{code}' 데이터 없음")

    features = []
    for seg in segments:
        rows = (
            db.query(RouteGeometry.lat, RouteGeometry.lon)
            .filter(
                RouteGeometry.route_code == code,
                RouteGeometry.source == source,
                RouteGeometry.lod == "high",
                RouteGeometry.segment == seg,
            )
            .order_by(RouteGeometry.seq)
            .all()
        )
        if not rows:
            continue
        coordinates = [[row.lon, row.lat] for row in rows]
        features.append({
            "type": "Feature",
            "properties": {
                "route_code":  code,
                "source":      source,
                "segment":     seg,
                "point_count": len(coordinates),
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })

    return {"type": "FeatureCollection", "features": features}


# ── 조직 관할 구간 경계 ───────────────────────────────────────────────────

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

    features = []
    for rng in ranges:
        route = db.query(Route).filter(Route.id == rng.route_id).first()
        if not route:
            continue

        source = db.execute(
            text("SELECT source FROM route_geometry WHERE route_code=:code AND source='user' LIMIT 1"),
            {"code": route.code},
        ).scalar() or "shp"

        segments = db.execute(
            text("SELECT DISTINCT segment FROM route_geometry "
                 "WHERE route_code=:code AND source=:src AND lod='high' ORDER BY segment"),
            {"code": route.code, "src": source},
        ).scalars().all()

        for seg in segments:
            rows = (
                db.query(RouteGeometry.seq, RouteGeometry.lat, RouteGeometry.lon, RouteGeometry.km)
                .filter(
                    RouteGeometry.route_code == route.code,
                    RouteGeometry.source == source,
                    RouteGeometry.lod == "high",
                    RouteGeometry.segment == seg,
                )
                .order_by(RouteGeometry.seq)
                .all()
            )
            if not rows:
                continue

            has_km = any(r.km is not None for r in rows)
            if has_km:
                segment_rows = [r for r in rows if r.km is not None and rng.start_km <= r.km <= rng.end_km]
            else:
                segment_rows = rows

            if not segment_rows:
                continue

            coordinates = [[r.lon, r.lat] for r in segment_rows]
            features.append({
                "type": "Feature",
                "properties": {
                    "organization_id":   org_id,
                    "organization_name": org.name,
                    "route_code":        route.code,
                    "route_name":        route.name,
                    "field":             rng.field,
                    "start_km":          rng.start_km,
                    "end_km":            rng.end_km,
                },
                "geometry": {"type": "LineString", "coordinates": coordinates},
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


# ── km → (lat, lon) 보간 헬퍼 ────────────────────────────────────────────

def _interpolate_km(db: Session, route_code: str, km: float) -> tuple[float, float] | None:
    rows = db.execute(
        text("""
            SELECT lat, lon, km FROM route_geometry
            WHERE route_code=:code AND source='user' AND lod='high' AND km IS NOT NULL
            ORDER BY km
        """),
        {"code": route_code},
    ).fetchall()

    if not rows:
        return None
    if km <= rows[0].km:
        return (rows[0].lat, rows[0].lon)
    if km >= rows[-1].km:
        return (rows[-1].lat, rows[-1].lon)

    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        if a.km <= km <= b.km:
            t = (km - a.km) / (b.km - a.km)
            return (a.lat + t * (b.lat - a.lat), a.lon + t * (b.lon - a.lon))

    return None


def _km_range_coords(db: Session, route_code: str, start_km: float, end_km: float) -> list[list[float]]:
    rows = db.execute(
        text("""
            SELECT lat, lon, km FROM route_geometry
            WHERE route_code=:code AND source='user' AND lod='high' AND km IS NOT NULL
            ORDER BY km
        """),
        {"code": route_code},
    ).fetchall()

    if not rows:
        return []

    coords: list[list[float]] = []
    start_pt = _interpolate_km(db, route_code, start_km)
    if start_pt:
        coords.append([start_pt[1], start_pt[0]])

    for r in rows:
        if start_km < r.km < end_km:
            coords.append([r.lon, r.lat])

    end_pt = _interpolate_km(db, route_code, end_km)
    if end_pt:
        coords.append([end_pt[1], end_pt[0]])

    return coords


def _interpolate_rail_kp(db: Session, rail_route_id: int, kp: float) -> tuple[float, float] | None:
    rows = db.execute(
        text("""
            SELECT lat, lon, kp
            FROM rail_baseline_points
            WHERE rail_route_id=:rail_route_id
              AND is_interpolation_anchor = 1
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


def _rail_kp_range_coords(db: Session, rail_route_id: int, start_kp: float, end_kp: float) -> list[list[float]]:
    start, end = sorted((start_kp, end_kp))
    rows = db.execute(
        text("""
            SELECT lat, lon, kp
            FROM rail_baseline_points
            WHERE rail_route_id=:rail_route_id
              AND is_render_anchor = 1
            ORDER BY segment_no, kp, seq
        """),
        {"rail_route_id": rail_route_id},
    ).fetchall()

    if not rows:
        return []

    coords: list[list[float]] = []
    start_pt = _interpolate_rail_kp(db, rail_route_id, start)
    if start_pt:
        coords.append([start_pt[1], start_pt[0]])

    for r in rows:
        if start < r.kp < end:
            coord = [r.lon, r.lat]
            if not coords or coords[-1] != coord:
                coords.append(coord)

    end_pt = _interpolate_rail_kp(db, rail_route_id, end)
    if end_pt:
        coord = [end_pt[1], end_pt[0]]
        if not coords or coords[-1] != coord:
            coords.append(coord)

    return coords


# ── 노선 시설물 GeoJSON ───────────────────────────────────────────────────

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


@router.get("/routes/{code}/facilities")
def get_route_facilities(
    code: str,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    route = db.query(Route).filter(Route.code == code).first()
    if not route:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"노선 '{code}' 없음")

    facilities = (
        db.query(Facility)
        .filter(Facility.route_id == route.id)
        .order_by(Facility.km)
        .all()
    )

    features = []
    for f in facilities:
        if f.lat is not None and f.lon is not None:
            start_coord = (f.lat, f.lon)
        else:
            start_coord = _interpolate_km(db, code, f.km)

        if start_coord is None:
            continue

        props = {
            "id":              f.id,
            "type":            f.type,
            "station_type":    f.station_type,
            "name":            f.name,
            "km":              f.km,
            "km_end":          f.km_end,
            "direction":       f.direction,
            "has_station_map": f.has_station_map,
            "note":            f.note,
            "route_code":      route.code,
            "route_name":      route.name,
        }

        if f.km_end is not None and f.type == "구조물":
            coords = _km_range_coords(db, code, f.km, f.km_end)
            if len(coords) < 2:
                geometry = {"type": "Point", "coordinates": [start_coord[1], start_coord[0]]}
            else:
                geometry = {"type": "LineString", "coordinates": coords}
        else:
            geometry = {"type": "Point", "coordinates": [start_coord[1], start_coord[0]]}

        features.append({"type": "Feature", "properties": props, "geometry": geometry})

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
            section_type = "power_cut"
            f_start = db.query(Facility).filter(Facility.id == bo.start_facility_id).first() \
                if bo.start_facility_id else None
            f_end   = db.query(Facility).filter(Facility.id == bo.end_facility_id).first() \
                if bo.end_facility_id else None
            if f_start is None or f_end is None or legacy_route is None:
                continue
            coords = _km_range_coords(db, legacy_route.code, f_start.km, f_end.km)
            display_km = f"{f_start.km}~{f_end.km}"
            section_note = bo.section_note or f"{f_start.name}~{f_end.name}"
        else:
            section_type = "normal"
            if start_kp is None or end_kp is None:
                continue
            coords = (
                _rail_kp_range_coords(db, bo.rail_route_id, start_kp, end_kp)
                if bo.rail_route_id
                else []
            )
            if len(coords) < 2 and legacy_route is not None:
                coords = _km_range_coords(db, legacy_route.code, start_kp, end_kp)
            display_km = f"{start_kp}~{end_kp}"
            section_note = bo.section_note

        if len(coords) < 2:
            continue

        features.append({
            "type": "Feature",
            "properties": {
                "id":              bo.id,
                "route_id":        bo.route_id,
                "rail_route_id":   bo.rail_route_id,
                "route_code":      route_code,
                "route_name":      route_name,
                "direction":       bo.direction,
                "section_type":    section_type,
                "start_km":        bo.start_km,
                "end_km":          bo.end_km,
                "start_kp":        start_kp,
                "end_kp":          end_kp,
                "section_note":    section_note,
                "display_km":      display_km,
                "work_date":       bo.work_date.isoformat(),
                "start_time":      bo.start_time.strftime("%H:%M"),
                "end_time":        bo.end_time.strftime("%H:%M"),
                "field":           bo.field,
                "block_type":      bo.block_type,
                "organization_id": bo.organization_id,
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })

    return {"type": "FeatureCollection", "features": features, "work_date": target_date.isoformat()}


# ── 시군구 배경 지도 (정적 GeoJSON 파일) ──────────────────────────────────────

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
