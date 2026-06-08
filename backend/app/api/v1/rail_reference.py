import csv
import io
import math
from itertools import groupby as _groupby

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_org_admin
from app.models.user import User

router = APIRouter(prefix="/rail-reference", tags=["기준정보"])

VALID_DIRECTIONS = {"상선", "하선", "상하선"}

_LAT_M = 111000.0


def _lon_m(lat_deg: float) -> float:
    return _LAT_M * math.cos(math.radians(lat_deg))


def _interpolate_and_tangent(pts: list, kp_target: float):
    """pts: [(kp, lat, lon), ...] KP 오름차순. Returns (center_lat, center_lon, tx, ty) or None."""
    if len(pts) < 2:
        return None
    lower = upper = None
    for i, (kp, _, __) in enumerate(pts):
        if kp <= kp_target:
            lower = i
        if kp >= kp_target and upper is None:
            upper = i
            break
    if lower is None:
        lower, upper = 0, 1
    elif upper is None:
        lower, upper = len(pts) - 2, len(pts) - 1
    if lower == upper:
        lower = max(0, lower - 1) if lower > 0 else 0
        upper = lower + 1
    if upper >= len(pts):
        upper = len(pts) - 1
        lower = upper - 1
    kp_a, lat_a, lon_a = pts[lower]
    kp_b, lat_b, lon_b = pts[upper]
    avg_lat = (lat_a + lat_b) / 2
    lm = _lon_m(avg_lat)
    dx = (lon_b - lon_a) * lm
    dy = (lat_b - lat_a) * _LAT_M
    length = math.sqrt(dx * dx + dy * dy)
    if length < 1e-9:
        return None
    tx, ty = dx / length, dy / length
    if kp_b == kp_a:
        return lat_a, lon_a, tx, ty
    t = (kp_target - kp_a) / (kp_b - kp_a)
    return lat_a + t * (lat_b - lat_a), lon_a + t * (lon_b - lon_a), tx, ty


def _correct_20m(gps_lat: float, gps_lon: float, center_lat: float, center_lon: float, tx: float, ty: float, offset_m: float = 20.0):
    """GPS → 레일 중심선 방향으로 offset_m 이동. Returns (new_lat, new_lon)."""
    avg_lat = (gps_lat + center_lat) / 2
    lm = _lon_m(avg_lat)
    gx = (gps_lon - center_lon) * lm
    gy = (gps_lat - center_lat) * _LAT_M
    nx, ny = -ty, tx  # 접선의 90° CCW 법선
    signed_dist = gx * nx + gy * ny
    sign = 1.0 if signed_dist > 0 else -1.0
    new_lon = gps_lon - sign * offset_m * nx / lm
    new_lat = gps_lat - sign * offset_m * ny / _LAT_M
    return new_lat, new_lon


VALID_BORE_TYPES = {'복선', '단선_상선', '단선_하선'}


class RailFacilityCreate(BaseModel):
    facility_code: str | None = None
    name: str
    classification_id: int
    kp_start: float
    kp_end: float | None = None
    lat: float | None = None
    lon: float | None = None
    lat_end: float | None = None
    lon_end: float | None = None
    direction: str | None = None
    section_from: str | None = None
    section_to: str | None = None
    address: str | None = None
    road_width_m: float | None = None
    is_paved: bool | None = None
    bus_accessible: bool | None = None
    entrance_passage_type: str | None = None
    entrance_lock_type: str | None = None
    nearest_station_id: int | None = None
    management_office_id: int | None = None
    # 터널·교량 선로 적용 방식 ('복선'|'단선_상선'|'단선_하선')
    bore_type: str = '복선'
    use_as_baseline_anchor: bool = False
    is_active: bool = True
    note: str | None = None


class RailFacilityUpdate(BaseModel):
    facility_code: str | None = None
    name: str | None = None
    classification_id: int | None = None
    kp_start: float | None = None
    kp_end: float | None = None
    lat: float | None = None
    lon: float | None = None
    lat_end: float | None = None
    lon_end: float | None = None
    direction: str | None = None
    section_from: str | None = None
    section_to: str | None = None
    address: str | None = None
    road_width_m: float | None = None
    is_paved: bool | None = None
    bus_accessible: bool | None = None
    entrance_passage_type: str | None = None
    entrance_lock_type: str | None = None
    nearest_station_id: int | None = None
    management_office_id: int | None = None
    bore_type: str | None = None
    use_as_baseline_anchor: bool | None = None
    is_active: bool | None = None
    note: str | None = None


def _count_table(db: Session, table_name: str) -> int:
    return int(db.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar_one())


def _ensure_rail_route(db: Session, rail_route_id: int) -> None:
    exists = db.execute(
        text("SELECT 1 FROM rail_routes WHERE id = :rail_route_id"),
        {"rail_route_id": rail_route_id},
    ).first()
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="노선원장을 찾을 수 없습니다",
        )


def _get_classification(db: Session, classification_id: int):
    row = (
        db.execute(
            text(
                """
                SELECT id, code, major_category, sub_category, detail_category, tertiary_category, geometry_type, is_active
                FROM rail_facility_classifications
                WHERE id = :classification_id
                """
            ),
            {"classification_id": classification_id},
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="시설물 분류를 찾을 수 없습니다",
        )
    if not bool(row["is_active"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비활성 시설물 분류는 사용할 수 없습니다",
        )
    return row


def _validate_facility_data(
    db: Session,
    data: dict,
    *,
    existing: dict | None = None,
) -> dict:
    merged = {**(existing or {}), **data}

    name = merged.get("name")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="시설물명을 입력하세요")
    data["name"] = name.strip()

    classification_id = merged.get("classification_id")
    if classification_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="시설물 분류를 선택하세요")
    classification = _get_classification(db, int(classification_id))

    kp_start = merged.get("kp_start")
    if kp_start is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="시작 KP를 입력하세요")

    kp_end = merged.get("kp_end")
    if classification["geometry_type"] == "linear" and kp_end is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="구간형 시설물은 종료 KP가 필요합니다")
    if kp_end is not None and float(kp_end) < float(kp_start):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="종료 KP는 시작 KP보다 작을 수 없습니다")

    # bore_type 검증 (터널·교량에만 의미 있으나 모든 시설물에 허용)
    bore_type = merged.get("bore_type", "복선")
    if bore_type not in VALID_BORE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bore_type은 '복선', '단선_상선', '단선_하선' 중 하나여야 합니다",
        )

    direction = merged.get("direction")
    if direction not in (None, "") and direction not in VALID_DIRECTIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="방향은 상선, 하선, 상하선 중 하나여야 합니다")
    if data.get("direction") == "":
        data["direction"] = None

    for left, right, label in (
        ("lat", "lon", "시작 GPS"),
        ("lat_end", "lon_end", "종료 GPS"),
    ):
        left_value = merged.get(left)
        right_value = merged.get(right)
        if (left_value is None) ^ (right_value is None):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{label}는 위도와 경도를 함께 입력해야 합니다")

    return data


def _facility_response(db: Session, facility_id: int) -> dict:
    row = (
        db.execute(
            text(
                """
                SELECT
                    rf.id,
                    rf.rail_route_id,
                    rr.name AS rail_route_name,
                    rr.korail_route_code,
                    rf.facility_code,
                    rf.name,
                    rf.classification_id,
                    c.code AS classification_code,
                    c.major_category,
                    c.sub_category,
                    c.detail_category,
                    c.tertiary_category,
                    c.geometry_type,
                    rf.kp_start,
                    rf.kp_end,
                    rf.lat,
                    rf.lon,
                    rf.lat_end,
                    rf.lon_end,
                    rf.direction,
                    rf.section_from,
                    rf.section_to,
                    rf.address,
                    rf.road_width_m,
                    rf.is_paved,
                    rf.bus_accessible,
                    rf.entrance_passage_type,
                    rf.entrance_lock_type,
                    rf.nearest_station_id,
                    ns.name AS nearest_station_name,
                    rf.management_office_id,
                    mo.office_name AS management_office_name,
                    rf.bore_type,
                    rf.use_as_baseline_anchor,
                    rf.is_active,
                    rf.note,
                    rf.created_at,
                    rf.updated_at
                FROM rail_facilities rf
                JOIN rail_routes rr ON rr.id = rf.rail_route_id
                JOIN rail_facility_classifications c ON c.id = rf.classification_id
                LEFT JOIN rail_stations ns ON ns.id = rf.nearest_station_id
                LEFT JOIN rail_facility_management_offices mo ON mo.id = rf.management_office_id
                WHERE rf.id = :facility_id
                """
            ),
            {"facility_id": facility_id},
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시설물을 찾을 수 없습니다")
    item = dict(row)
    item["bore_type"] = item.get("bore_type") or "복선"
    item["use_as_baseline_anchor"] = bool(item["use_as_baseline_anchor"])
    item["is_active"] = bool(item["is_active"])
    if item["is_paved"] is not None:
        item["is_paved"] = bool(item["is_paved"])
    if item["bus_accessible"] is not None:
        item["bus_accessible"] = bool(item["bus_accessible"])
    return item


def _resequence_baseline_route(db: Session, rail_route_id: int) -> None:
    rows = db.execute(
        text(
            """
            SELECT id
            FROM rail_baseline_points
            WHERE rail_route_id = :rail_route_id
            ORDER BY
                segment_no,
                kp,
                CASE point_type
                    WHEN 'station_yard_start' THEN 10
                    WHEN 'station_center' THEN 20
                    WHEN 'station_yard_end' THEN 30
                    WHEN 'facility_start' THEN 40
                    WHEN 'facility_point' THEN 50
                    WHEN 'facility_end' THEN 60
                    WHEN 'junction_point' THEN 70
                    WHEN 'manual_control' THEN 80
                    ELSE 90
                END,
                id
            """
        ),
        {"rail_route_id": rail_route_id},
    ).fetchall()
    for seq, row in enumerate(rows, start=1):
        db.execute(
            text("UPDATE rail_baseline_points SET seq = :seq, updated_at = CURRENT_TIMESTAMP WHERE id = :id"),
            {"seq": seq, "id": row.id},
        )


def _rebuild_computed_geometry_route(db: Session, rail_route_id: int) -> None:
    """rail_baseline_points → rail_computed_geometry 재계산 (단일 노선, 3 LOD)."""
    route = (
        db.execute(
            text("SELECT id, line_type FROM rail_routes WHERE id = :id"),
            {"id": rail_route_id},
        )
        .mappings()
        .first()
    )
    if not route:
        return

    anchors_all = db.execute(
        text("""
            SELECT segment_no, kp, lat, lon
            FROM rail_baseline_points
            WHERE rail_route_id = :route_id
              AND is_interpolation_anchor = TRUE
            ORDER BY segment_no, kp
        """),
        {"route_id": rail_route_id},
    ).fetchall()

    if not anchors_all:
        return

    segments: dict[int, list] = {}
    for seg_no, pts in _groupby(anchors_all, key=lambda r: r.segment_no):
        pts_list = list(pts)
        if len(pts_list) >= 2:
            segments[seg_no] = pts_list

    if not segments:
        return

    def _interp(anc: list, interval: float) -> list[tuple[float, float, float]]:
        out: list[tuple[float, float, float]] = []
        for i in range(len(anc) - 1):
            kp1, lat1, lon1 = anc[i].kp, anc[i].lat, anc[i].lon
            kp2, lat2, lon2 = anc[i + 1].kp, anc[i + 1].lat, anc[i + 1].lon
            if kp2 <= kp1 + 1e-6:
                continue
            out.append((kp1, lat1, lon1))
            kp = kp1 + interval
            while kp < kp2 - 1e-6:
                t = (kp - kp1) / (kp2 - kp1)
                out.append((kp, lat1 + t * (lat2 - lat1), lon1 + t * (lon2 - lon1)))
                kp += interval
        if anc:
            last = anc[-1]
            out.append((last.kp, last.lat, last.lon))
        return out

    for lod, interval in {"high": 0.5, "mid": 2.0, "low": 10.0}.items():
        db.execute(
            text("DELETE FROM rail_computed_geometry WHERE rail_route_id = :rid AND lod = :lod"),
            {"rid": rail_route_id, "lod": lod},
        )
        seq = 0
        for seg_no in sorted(segments):
            for kp, lat, lon in _interp(segments[seg_no], interval):
                db.execute(
                    text("""
                        INSERT INTO rail_computed_geometry
                            (rail_route_id, line_type, kp, lat, lon, source, lod, seq)
                        VALUES
                            (:rid, :lt, :kp, :lat, :lon, 'interpolated', :lod, :seq)
                    """),
                    {
                        "rid": rail_route_id,
                        "lt": route["line_type"],
                        "kp": round(kp, 3),
                        "lat": round(lat, 6),
                        "lon": round(lon, 6),
                        "lod": lod,
                        "seq": seq,
                    },
                )
                seq += 1


def _sync_facility_baseline_points(db: Session, facility_id: int) -> None:
    row = (
        db.execute(
            text(
                """
                SELECT
                    rf.id,
                    rf.rail_route_id,
                    rf.kp_start,
                    rf.kp_end,
                    rf.lat,
                    rf.lon,
                    rf.lat_end,
                    rf.lon_end,
                    rf.bore_type,
                    rf.use_as_baseline_anchor,
                    rf.is_active,
                    rf.direction,
                    c.geometry_type,
                    c.major_category
                FROM rail_facilities rf
                JOIN rail_facility_classifications c ON c.id = rf.classification_id
                WHERE rf.id = :facility_id
                """
            ),
            {"facility_id": facility_id},
        )
        .mappings()
        .first()
    )
    if not row:
        return

    db.execute(
        text(
            """
            DELETE FROM rail_baseline_points
            WHERE rail_facility_id = :facility_id
               OR (source_type = 'rail_facility' AND source_id = :facility_id)
            """
        ),
        {"facility_id": facility_id},
    )

    if not bool(row["is_active"]) or not bool(row["use_as_baseline_anchor"]):
        _resequence_baseline_route(db, int(row["rail_route_id"]))
        return

    point_rows: list[dict] = []
    if row["geometry_type"] == "linear":
        if row["kp_start"] is not None and row["lat"] is not None and row["lon"] is not None:
            point_rows.append(
                {
                    "point_type": "facility_start",
                    "kp": row["kp_start"],
                    "lat": row["lat"],
                    "lon": row["lon"],
                    "is_interpolation_anchor": True,
                    "note": "철도시설물 시작점 기준선 앵커",
                }
            )
        if row["kp_end"] is not None and row["lat_end"] is not None and row["lon_end"] is not None:
            point_rows.append(
                {
                    "point_type": "facility_end",
                    "kp": row["kp_end"],
                    "lat": row["lat_end"],
                    "lon": row["lon_end"],
                    "is_interpolation_anchor": True,
                    "note": "철도시설물 종료점 기준선 앵커",
                }
            )
    elif row["kp_start"] is not None and row["lat"] is not None and row["lon"] is not None:
        anchor_lat = row["lat"]
        anchor_lon = row["lon"]

        # 전기설비(point): GPS → 선로 중심 방향으로 20m 이동 (direction 기반)
        if row["major_category"] == "전기설비":
            anchor_lat, anchor_lon = _apply_20m_baseline_correction(
                db,
                route_id=int(row["rail_route_id"]),
                kp=float(row["kp_start"]),
                gps_lat=float(row["lat"]),
                gps_lon=float(row["lon"]),
                direction=row["direction"],
            )

        point_rows.append(
            {
                "point_type": "facility_point",
                "kp": row["kp_start"],
                "lat": anchor_lat,
                "lon": anchor_lon,
                "is_interpolation_anchor": True,
                "note": "철도시설물 기준선 앵커",
            }
        )

    for point in point_rows:
        db.execute(
            text(
                """
                INSERT INTO rail_baseline_points (
                    rail_route_id,
                    segment_no,
                    seq,
                    kp,
                    lat,
                    lon,
                    point_type,
                    source_type,
                    source_id,
                    rail_facility_id,
                    is_interpolation_anchor,
                    is_render_anchor,
                    note,
                    updated_at
                )
                VALUES (
                    :rail_route_id,
                    0,
                    0,
                    :kp,
                    :lat,
                    :lon,
                    :point_type,
                    'rail_facility',
                    :facility_id,
                    :facility_id,
                    :is_interpolation_anchor,
                    TRUE,
                    :note,
                    CURRENT_TIMESTAMP
                )
                """
            ),
            {
                "rail_route_id": row["rail_route_id"],
                "facility_id": row["id"],
                **point,
            },
        )

    _resequence_baseline_route(db, int(row["rail_route_id"]))


def _apply_20m_baseline_correction(
    db: Session,
    route_id: int,
    kp: float,
    gps_lat: float,
    gps_lon: float,
    direction: str | None = None,
) -> tuple[float, float]:
    """전기설비 GPS → 선로 중심 방향으로 20m 이동.

    direction='하선': 시점→종점 기준 왼쪽(하선) → 오른쪽(CW)으로 20m
                     dlon = ty×20/lon_m,  dlat = -tx×20/LAT_M
    direction='상선': 시점→종점 기준 오른쪽(상선) → 왼쪽(CCW)으로 20m
                     dlon = -ty×20/lon_m, dlat =  tx×20/LAT_M
    direction='상하선': 선로 중심부 → GPS 그대로
    direction=None:  기하학적 signed-distance 방식 (fallback)
    실패 시 원본 GPS 반환.
    """
    if direction == "상하선":
        return gps_lat, gps_lon

    pts_rows = db.execute(
        text(
            """
            SELECT kp, lat, lon
            FROM rail_baseline_points
            WHERE rail_route_id = :route_id
              AND point_type IN (
                  'station_center', 'station_yard_start', 'station_yard_end',
                  'facility_start', 'facility_end'
              )
              AND kp IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL
            ORDER BY kp
            """
        ),
        {"route_id": route_id},
    ).fetchall()
    pts = [(r[0], r[1], r[2]) for r in pts_rows]

    result = _interpolate_and_tangent(pts, kp)
    if result is None:
        return gps_lat, gps_lon

    _, _, tx, ty = result
    lm = _lon_m(gps_lat)

    if direction == "하선":
        # 하선(왼쪽) → 오른쪽(CW, 선로 중심) 방향으로 20m: (ty, -tx)
        return gps_lat - tx * 20.0 / _LAT_M, gps_lon + ty * 20.0 / lm
    elif direction == "상선":
        # 상선(오른쪽) → 왼쪽(CCW, 선로 중심) 방향으로 20m: (-ty, tx)
        return gps_lat + tx * 20.0 / _LAT_M, gps_lon - ty * 20.0 / lm
    else:
        # direction=None: 기하학적 signed-distance fallback
        center_lat, center_lon, tx2, ty2 = result
        return _correct_20m(gps_lat, gps_lon, center_lat, center_lon, tx2, ty2, 20.0)


@router.get("/summary")
def get_reference_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    counts = {
        "rail_routes": _count_table(db, "rail_routes"),
        "rail_stations": _count_table(db, "rail_stations"),
        "rail_route_station_points": _count_table(db, "rail_route_station_points"),
        "rail_baseline_points": _count_table(db, "rail_baseline_points"),
        "rail_facilities": _count_table(db, "rail_facilities"),
        "rail_facility_classifications": _count_table(db, "rail_facility_classifications"),
        "rail_route_region_boundaries": _count_table(db, "rail_route_region_boundaries"),
    }

    baseline_by_type = [
        dict(row)
        for row in db.execute(
            text(
                """
                SELECT
                    point_type,
                    COUNT(*) AS total,
                    SUM(CASE WHEN is_render_anchor THEN 1 ELSE 0 END) AS render_anchor_count,
                    SUM(CASE WHEN is_interpolation_anchor = TRUE THEN 1 ELSE 0 END) AS interpolation_anchor_count
                FROM rail_baseline_points
                GROUP BY point_type
                ORDER BY total DESC, point_type
                """
            )
        )
        .mappings()
        .all()
    ]

    quality = dict(
        db.execute(
            text(
                """
                SELECT
                    (SELECT COUNT(DISTINCT rail_route_id) FROM rail_route_station_points) AS routes_with_station_points,
                    (SELECT COUNT(DISTINCT rail_route_id) FROM rail_baseline_points) AS routes_with_baseline,
                    (
                        SELECT COUNT(*)
                        FROM (
                            SELECT rail_route_id
                            FROM rail_baseline_points
                            WHERE is_render_anchor = TRUE
                            GROUP BY rail_route_id
                            HAVING COUNT(*) >= 2
                        ) renderable
                    ) AS routes_renderable,
                    (
                        SELECT COUNT(*)
                        FROM rail_route_station_points
                        WHERE center_kp IS NOT NULL
                    ) AS station_points_with_center_kp,
                    (
                        SELECT COUNT(*)
                        FROM rail_route_station_points
                        WHERE center_kp IS NULL
                    ) AS station_points_missing_center_kp,
                    (
                        SELECT COUNT(*)
                        FROM rail_route_station_points rsp
                        JOIN rail_stations s ON s.id = rsp.station_id
                        WHERE s.lat IS NOT NULL AND s.lon IS NOT NULL
                    ) AS station_points_with_gps,
                    (
                        SELECT COUNT(*)
                        FROM rail_route_station_points rsp
                        JOIN rail_stations s ON s.id = rsp.station_id
                        WHERE s.lat IS NULL OR s.lon IS NULL
                    ) AS station_points_missing_gps
                """
            )
        )
        .mappings()
        .one()
    )

    return {
        "counts": counts,
        "baseline_by_type": baseline_by_type,
        "quality": quality,
    }


@router.get("/facility-classifications")
def list_facility_classifications(
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    rows = (
        db.execute(
            text(
                """
                SELECT
                    id,
                    code,
                    major_category,
                    sub_category,
                    detail_category,
                    tertiary_category,
                    geometry_type,
                    sort_order,
                    is_active
                FROM rail_facility_classifications
                ORDER BY sort_order, major_category, sub_category, detail_category, tertiary_category
                """
            )
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows:
        item = dict(row)
        item["is_active"] = bool(item["is_active"])
        items.append(item)
    return items


@router.get("/routes")
def list_reference_routes(
    line_type: str | None = Query(None, description="고속선 | 일반선"),
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    where_clause = ""
    params: dict = {}
    if line_type in ("고속선", "일반선"):
        where_clause = "WHERE rr.line_type = :line_type"
        params["line_type"] = line_type

    rows = (
        db.execute(
            text(
                f"""
                WITH station_counts AS (
                    SELECT
                        rail_route_id,
                        COUNT(*) AS station_point_count
                    FROM rail_route_station_points
                    GROUP BY rail_route_id
                ),
                baseline_counts AS (
                    SELECT
                        rail_route_id,
                        COUNT(*) AS baseline_point_count,
                        SUM(CASE WHEN is_render_anchor THEN 1 ELSE 0 END) AS render_anchor_count,
                        MIN(kp) AS baseline_kp_min,
                        MAX(kp) AS baseline_kp_max
                    FROM rail_baseline_points
                    GROUP BY rail_route_id
                ),
                computed_counts AS (
                    SELECT
                        rail_route_id,
                        COUNT(*) FILTER (WHERE lod = 'high') AS computed_high_count,
                        MAX(computed_at) AS last_computed_at
                    FROM rail_computed_geometry
                    GROUP BY rail_route_id
                )
                SELECT
                    rr.id,
                    rr.korail_route_code,
                    rr.name,
                    rr.line_type,
                    rr.route_category,
                    rr.start_station_name,
                    rr.end_station_name,
                    rr.start_lat,
                    rr.start_lon,
                    rr.end_lat,
                    rr.end_lon,
                    rr.start_kp,
                    rr.end_kp,
                    rr.length_kp,
                    rr.calculation_basis,
                    rr.is_active,
                    rr.source_file,
                    rr.imported_at,
                    rr.default_track_count,
                    rr.default_has_catenary,
                    COALESCE(sc.station_point_count, 0) AS station_point_count,
                    COALESCE(bc.baseline_point_count, 0) AS baseline_point_count,
                    COALESCE(bc.render_anchor_count, 0) AS render_anchor_count,
                    bc.baseline_kp_min,
                    bc.baseline_kp_max,
                    COALESCE(cc.computed_high_count, 0) AS computed_high_count,
                    cc.last_computed_at
                FROM rail_routes rr
                LEFT JOIN station_counts sc ON sc.rail_route_id = rr.id
                LEFT JOIN baseline_counts bc ON bc.rail_route_id = rr.id
                LEFT JOIN computed_counts cc ON cc.rail_route_id = rr.id
                {where_clause}
                ORDER BY rr.line_type DESC, rr.name, rr.korail_route_code
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows:
        item = dict(row)
        item["is_active"]             = bool(item["is_active"])
        item["default_has_catenary"]  = bool(item.get("default_has_catenary", True))
        item["default_track_count"]   = int(item.get("default_track_count", 2))
        items.append(item)
    return items


@router.get("/routes/route-summaries")
def get_route_summaries(
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """노선별 역/KP 및 시설물 집계 — 역/KP 관리·시설물 관리 목록 화면용"""
    rows = db.execute(text("""
        WITH sp AS (
            -- rail_route_station_points 와 rail_stations(GPS) 조인
            SELECT rsp.rail_route_id,
                   COUNT(*) AS station_total,
                   SUM(CASE WHEN rs.lat IS NOT NULL AND rs.lon IS NOT NULL THEN 1 ELSE 0 END) AS station_gps,
                   SUM(CASE WHEN rsp.center_kp IS NULL OR rsp.yard_start_kp IS NULL OR rsp.yard_end_kp IS NULL
                             OR (rsp.yard_start_kp > rsp.center_kp) OR (rsp.yard_end_kp < rsp.center_kp)
                             OR (rsp.yard_start_kp > rsp.yard_end_kp) THEN 1 ELSE 0 END) AS station_error
            FROM rail_route_station_points rsp
            LEFT JOIN rail_stations rs ON rs.id = rsp.station_id
            GROUP BY rsp.rail_route_id
        ),
        fac AS (
            SELECT rail_route_id,
                   COUNT(*) AS facility_total,
                   SUM(CASE WHEN lat IS NOT NULL AND lon IS NOT NULL THEN 1 ELSE 0 END) AS facility_gps
            FROM rail_facilities
            GROUP BY rail_route_id
        )
        SELECT
            rr.id,
            rr.korail_route_code,
            rr.name,
            rr.line_type,
            rr.start_station_name,
            rr.end_station_name,
            rr.start_kp,
            rr.end_kp,
            rr.is_active,
            rr.default_track_count,
            COALESCE(sp.station_total, 0) AS station_total,
            COALESCE(sp.station_gps,   0) AS station_gps,
            COALESCE(sp.station_error, 0) AS station_error,
            COALESCE(fac.facility_total, 0) AS facility_total,
            COALESCE(fac.facility_gps,   0) AS facility_gps
        FROM rail_routes rr
        LEFT JOIN sp  ON sp.rail_route_id  = rr.id
        LEFT JOIN fac ON fac.rail_route_id = rr.id
        ORDER BY rr.line_type DESC, rr.name
    """)).mappings().fetchall()

    return [dict(r) for r in rows]


@router.get("/routes/{rail_route_id}/station-points")
def list_route_station_points(
    rail_route_id: int,
    limit: int = Query(1000, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    rows = (
        db.execute(
            text(
                """
                SELECT
                    rsp.id,
                    rsp.route_sequence_no,
                    rsp.center_kp,
                    rsp.yard_start_kp,
                    rsp.yard_end_kp,
                    rsp.regional_org,
                    rsp.is_baseline_anchor,
                    rsp.match_note,
                    s.station_code,
                    s.name AS station_name,
                    s.lat,
                    s.lon,
                    s.station_role,
                    s.station_type
                FROM rail_route_station_points rsp
                JOIN rail_stations s ON s.id = rsp.station_id
                WHERE rsp.rail_route_id = :rail_route_id
                ORDER BY
                    CASE WHEN rsp.route_sequence_no IS NULL THEN 1 ELSE 0 END,
                    rsp.route_sequence_no,
                    rsp.center_kp,
                    s.name
                LIMIT :limit
                """
            ),
            {"rail_route_id": rail_route_id, "limit": limit},
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows:
        item = dict(row)
        item["is_baseline_anchor"] = bool(item["is_baseline_anchor"])
        items.append(item)
    return items


class StationPointUpdate(BaseModel):
    center_kp: float | None = None
    yard_start_kp: float | None = None
    yard_end_kp: float | None = None
    is_baseline_anchor: bool | None = None
    lat: float | None = None
    lon: float | None = None
    station_role: str | None = None
    station_type: str | None = None


@router.patch("/station-points/{point_id}")
def update_station_point(
    point_id: int,
    body: StationPointUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """역 포인트 KP·GPS·역 구분 업데이트 (org_admin 이상)"""
    row = db.execute(
        text("SELECT rsp.id, rsp.station_id, rsp.rail_route_id FROM rail_route_station_points rsp WHERE rsp.id = :id"),
        {"id": point_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="역 포인트를 찾을 수 없습니다")

    updates: dict = {}
    if body.center_kp is not None:
        updates["center_kp"] = body.center_kp
    if body.yard_start_kp is not None:
        updates["yard_start_kp"] = body.yard_start_kp
    if body.yard_end_kp is not None:
        updates["yard_end_kp"] = body.yard_end_kp
    if body.is_baseline_anchor is not None:
        updates["is_baseline_anchor"] = body.is_baseline_anchor

    if updates:
        set_clause = ", ".join(f"{k} = :{k}" for k in updates)
        db.execute(
            text(f"UPDATE rail_route_station_points SET {set_clause} WHERE id = :id"),
            {**updates, "id": point_id},
        )

    station_updates: dict = {}
    if body.lat is not None:
        station_updates["lat"] = body.lat
    if body.lon is not None:
        station_updates["lon"] = body.lon
    if body.station_role is not None:
        station_updates["station_role"] = body.station_role
    if body.station_type is not None:
        station_updates["station_type"] = body.station_type

    if station_updates:
        set_clause = ", ".join(f"{k} = :{k}" for k in station_updates)
        db.execute(
            text(f"UPDATE rail_stations SET {set_clause} WHERE id = :station_id"),
            {**station_updates, "station_id": row["station_id"]},
        )

    # ── rail_baseline_points 동기화 ─────────────────────────────────────────
    # GPS·KP·is_baseline_anchor 변경 시 station_center 레코드를 동기화한다.
    needs_sync = (
        body.is_baseline_anchor is not None
        or body.lat is not None
        or body.lon is not None
        or body.center_kp is not None
    )

    if needs_sync:
        # 업데이트 반영 후 현재 최종 상태 조회 (같은 트랜잭션 내에서 자신의 변경이 보임)
        final = db.execute(
            text("""
                SELECT rsp.is_baseline_anchor, rsp.center_kp,
                       s.lat, s.lon
                FROM rail_route_station_points rsp
                JOIN rail_stations s ON s.id = rsp.station_id
                WHERE rsp.id = :id
            """),
            {"id": point_id},
        ).mappings().first()

        if final:
            anchor_val = final["is_baseline_anchor"]
            kp_val     = final["center_kp"]
            lat_val    = final["lat"]
            lon_val    = final["lon"]

            # 기존 station_center 레코드 조회
            existing_bp = db.execute(
                text("""
                    SELECT id FROM rail_baseline_points
                    WHERE station_id = :sid
                      AND rail_route_id = :rid
                      AND point_type = 'station_center'
                """),
                {"sid": row["station_id"], "rid": row["rail_route_id"]},
            ).first()

            if anchor_val and lat_val is not None and lon_val is not None and kp_val is not None:
                # is_baseline_anchor=True + GPS + KP 있음 → UPSERT station_center
                if existing_bp:
                    db.execute(
                        text("""
                            UPDATE rail_baseline_points
                            SET kp = :kp, lat = :lat, lon = :lon,
                                is_interpolation_anchor = TRUE,
                                is_render_anchor = TRUE,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE id = :id
                        """),
                        {"kp": kp_val, "lat": lat_val, "lon": lon_val, "id": existing_bp.id},
                    )
                else:
                    db.execute(
                        text("""
                            INSERT INTO rail_baseline_points
                              (rail_route_id, segment_no, seq, kp, lat, lon,
                               point_type, source_type, station_id,
                               is_interpolation_anchor, is_render_anchor)
                            VALUES (:rid, 0, 0, :kp, :lat, :lon,
                                    'station_center', 'station', :sid, TRUE, TRUE)
                        """),
                        {
                            "rid": row["rail_route_id"],
                            "kp": kp_val, "lat": lat_val, "lon": lon_val,
                            "sid": row["station_id"],
                        },
                    )
            elif not anchor_val and existing_bp:
                # is_baseline_anchor=False → 플래그 해제 (레코드는 유지)
                db.execute(
                    text("""
                        UPDATE rail_baseline_points
                        SET is_interpolation_anchor = FALSE,
                            is_render_anchor = FALSE,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = :id
                    """),
                    {"id": existing_bp.id},
                )

            # KP 순서 재정렬
            db.execute(
                text("""
                    WITH ranked AS (
                        SELECT id,
                               ROW_NUMBER() OVER (ORDER BY kp, id) AS new_seq
                        FROM rail_baseline_points
                        WHERE rail_route_id = :rid
                    )
                    UPDATE rail_baseline_points bp
                    SET seq = r.new_seq
                    FROM ranked r
                    WHERE bp.id = r.id
                """),
                {"rid": row["rail_route_id"]},
            )

    db.commit()

    # 노선 geometry 재계산
    if needs_sync:
        _rebuild_computed_geometry_route(db, row["rail_route_id"])
        db.commit()

    updated = db.execute(
        text("""
            SELECT rsp.id, rsp.route_sequence_no, rsp.center_kp, rsp.yard_start_kp,
                   rsp.yard_end_kp, rsp.regional_org, rsp.is_baseline_anchor, rsp.match_note,
                   s.station_code, s.name AS station_name, s.lat, s.lon,
                   s.station_role, s.station_type
            FROM rail_route_station_points rsp
            JOIN rail_stations s ON s.id = rsp.station_id
            WHERE rsp.id = :id
        """),
        {"id": point_id},
    ).mappings().first()
    result = dict(updated)
    result["is_baseline_anchor"] = bool(result["is_baseline_anchor"])
    return result


@router.get("/routes/{rail_route_id}/facilities")
def list_rail_facilities(
    rail_route_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    _ensure_rail_route(db, rail_route_id)
    rows = (
        db.execute(
            text(
                """
                SELECT
                    rf.id,
                    rf.rail_route_id,
                    rr.name AS rail_route_name,
                    rr.korail_route_code,
                    rf.facility_code,
                    rf.name,
                    rf.classification_id,
                    c.code AS classification_code,
                    c.major_category,
                    c.sub_category,
                    c.detail_category,
                    c.tertiary_category,
                    c.geometry_type,
                    rf.kp_start,
                    rf.kp_end,
                    rf.lat,
                    rf.lon,
                    rf.lat_end,
                    rf.lon_end,
                    rf.direction,
                    rf.section_from,
                    rf.section_to,
                    rf.address,
                    rf.road_width_m,
                    rf.is_paved,
                    rf.bus_accessible,
                    rf.entrance_passage_type,
                    rf.entrance_lock_type,
                    rf.nearest_station_id,
                    ns.name AS nearest_station_name,
                    rf.management_office_id,
                    mo.office_name AS management_office_name,
                    rf.bore_type,
                    rf.use_as_baseline_anchor,
                    rf.is_active,
                    rf.note,
                    rf.created_at,
                    rf.updated_at
                FROM rail_facilities rf
                JOIN rail_routes rr ON rr.id = rf.rail_route_id
                JOIN rail_facility_classifications c ON c.id = rf.classification_id
                LEFT JOIN rail_stations ns ON ns.id = rf.nearest_station_id
                LEFT JOIN rail_facility_management_offices mo ON mo.id = rf.management_office_id
                WHERE rf.rail_route_id = :rail_route_id
                ORDER BY
                    CASE WHEN rf.kp_start IS NULL THEN 1 ELSE 0 END,
                    rf.kp_start,
                    rf.kp_end,
                    rf.name
                """
            ),
            {"rail_route_id": rail_route_id},
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows:
        item = dict(row)
        item["bore_type"] = item.get("bore_type") or "복선"
        item["use_as_baseline_anchor"] = bool(item["use_as_baseline_anchor"])
        item["is_active"] = bool(item["is_active"])
        if item["is_paved"] is not None:
            item["is_paved"] = bool(item["is_paved"])
        if item["bus_accessible"] is not None:
            item["bus_accessible"] = bool(item["bus_accessible"])
        items.append(item)
    return items


@router.post("/routes/{rail_route_id}/facilities", status_code=status.HTTP_201_CREATED)
def create_rail_facility(
    rail_route_id: int,
    body: RailFacilityCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    _ensure_rail_route(db, rail_route_id)
    data = _validate_facility_data(db, body.model_dump())
    data["rail_route_id"] = rail_route_id
    new_id = int(
        db.execute(
            text(
                """
            INSERT INTO rail_facilities (
                rail_route_id,
                facility_code,
                name,
                classification_id,
                kp_start,
                kp_end,
                lat,
                lon,
                lat_end,
                lon_end,
                direction,
                section_from,
                section_to,
                address,
                road_width_m,
                is_paved,
                bus_accessible,
                entrance_passage_type,
                entrance_lock_type,
                nearest_station_id,
                management_office_id,
                bore_type,
                use_as_baseline_anchor,
                is_active,
                note,
                updated_at
            )
            VALUES (
                :rail_route_id,
                :facility_code,
                :name,
                :classification_id,
                :kp_start,
                :kp_end,
                :lat,
                :lon,
                :lat_end,
                :lon_end,
                :direction,
                :section_from,
                :section_to,
                :address,
                :road_width_m,
                :is_paved,
                :bus_accessible,
                :entrance_passage_type,
                :entrance_lock_type,
                :nearest_station_id,
                :management_office_id,
                :bore_type,
                :use_as_baseline_anchor,
                :is_active,
                :note,
                CURRENT_TIMESTAMP
            )
            RETURNING id
            """
            ),
            data,
        ).scalar_one()
    )
    _sync_facility_baseline_points(db, new_id)
    _rebuild_computed_geometry_route(db, rail_route_id)
    db.commit()
    return _facility_response(db, new_id)


@router.put("/facilities/{facility_id}")
def update_rail_facility(
    facility_id: int,
    body: RailFacilityUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    existing = _facility_response(db, facility_id)
    data = body.model_dump(exclude_unset=True)
    if not data:
        return existing
    data = _validate_facility_data(db, data, existing=existing)
    set_clauses = ", ".join(f"{key} = :{key}" for key in data)
    db.execute(
        text(
            f"""
            UPDATE rail_facilities
            SET {set_clauses},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :facility_id
            """
        ),
        {**data, "facility_id": facility_id},
    )
    _sync_facility_baseline_points(db, facility_id)
    _rebuild_computed_geometry_route(db, int(existing["rail_route_id"]))
    db.commit()
    return _facility_response(db, facility_id)


@router.delete("/facilities/{facility_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rail_facility(
    facility_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    existing = _facility_response(db, facility_id)
    rail_route_id = int(existing["rail_route_id"])
    db.execute(text("DELETE FROM rail_baseline_points WHERE rail_facility_id = :facility_id"), {"facility_id": facility_id})
    db.execute(text("DELETE FROM rail_facilities WHERE id = :facility_id"), {"facility_id": facility_id})
    _rebuild_computed_geometry_route(db, rail_route_id)
    db.commit()


@router.get("/routes/{rail_route_id}/facilities/template", response_class=PlainTextResponse)
def download_facility_template(
    rail_route_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """시설물 CSV 등록 양식 다운로드 (분류 코드 참고표 포함)"""
    _ensure_rail_route(db, rail_route_id)

    route = db.execute(
        text("SELECT korail_route_code, name FROM rail_routes WHERE id = :id"),
        {"id": rail_route_id},
    ).mappings().first()

    classifications = db.execute(
        text("""
            SELECT code, major_category, sub_category, detail_category, tertiary_category, geometry_type
            FROM rail_facility_classifications
            WHERE is_active = TRUE
            ORDER BY sort_order
        """)
    ).mappings().all()

    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")

    writer.writerow(["# 시설물 등록 양식 — " + route["name"] + " (" + route["korail_route_code"] + ")"])
    writer.writerow(["# classification_code: 아래 분류 코드표에서 code 값을 입력하세요"])
    writer.writerow(["# geometry_type=linear 인 시설물은 kp_end 필수, point 는 생략 가능"])
    writer.writerow(["# direction: UP / DOWN / BOTH 중 하나 (생략 가능)"])
    writer.writerow(["# is_paved / bus_accessible / use_as_baseline_anchor / is_active: 1=예, 0=아니오 (생략 시 기본값: anchor=0, active=1)"])
    writer.writerow(["# 이 파일을 열고 데이터 행을 추가한 뒤 저장하여 업로드하세요 (#으로 시작하는 행은 무시됩니다)"])
    writer.writerow([])

    writer.writerow([
        "classification_code", "name", "facility_code",
        "kp_start", "kp_end", "lat", "lon", "lat_end", "lon_end", "direction",
        "section_from", "section_to", "address",
        "road_width_m", "is_paved", "bus_accessible", "entrance_passage_type", "entrance_lock_type",
        "use_as_baseline_anchor", "is_active", "note",
    ])
    writer.writerow([
        "STRUCTURE_BRIDGE", "예시 교량", "",
        "100.000", "102.500", "37.123456", "127.123456", "37.234567", "127.234567", "UP",
        "오송역", "천안아산역", "",
        "", "", "", "", "",
        "0", "1", "비고 예시",
    ])
    writer.writerow([
        "STRUCTURE_GATE_UP", "예시 출입문", "",
        "150.000", "", "37.200000", "127.200000", "", "", "UP",
        "오송역", "청주공항역", "충청북도 청주시 ○○구 ○○동 123",
        "6.0", "1", "0", "직선통로", "번호키",
        "1", "1", "",
    ])

    writer.writerow([])
    writer.writerow(["# ===== 분류 코드 참고표 (아래 행은 데이터로 입력하지 마세요) ====="])
    writer.writerow(["# code", "대분류", "1차분류", "2차분류", "3차분류", "형태(point/linear)"])
    for c in classifications:
        writer.writerow([
            "# " + c["code"],
            c["major_category"],
            c["sub_category"],
            c["detail_category"] or "",
            c["tertiary_category"] or "",
            c["geometry_type"],
        ])

    content = output.getvalue().encode("utf-8-sig").decode("utf-8-sig")
    route_code = route["korail_route_code"]
    headers = {"Content-Disposition": f'attachment; filename="facilities_{route_code}.csv"'}
    return PlainTextResponse(content=content, media_type="text/csv; charset=utf-8", headers=headers)


@router.post("/routes/{rail_route_id}/facilities/bulk")
async def bulk_upload_facilities(
    rail_route_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """시설물 CSV 일괄 업로드 — 기존 데이터에 추가 (덮어쓰기 아님)"""
    _ensure_rail_route(db, rail_route_id)

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV 파일만 업로드할 수 있습니다")

    content = await file.read()
    try:
        text_data = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text_data = content.decode("cp949", errors="replace")

    class_rows = db.execute(
        text("SELECT id, code, geometry_type, is_active FROM rail_facility_classifications")
    ).mappings().all()
    class_map = {r["code"]: r for r in class_rows}

    reader = csv.DictReader(
        line for line in text_data.splitlines() if not line.lstrip().startswith("#")
    )

    success_count = 0
    errors: list[str] = []

    for row_num, row in enumerate(reader, start=2):
        code = (row.get("classification_code") or "").strip()
        if not code:
            continue

        cls = class_map.get(code)
        if not cls:
            errors.append(f"행 {row_num}: 분류코드 '{code}'를 찾을 수 없습니다")
            continue
        if not bool(cls["is_active"]):
            errors.append(f"행 {row_num}: 분류코드 '{code}'는 비활성입니다")
            continue

        name = (row.get("name") or "").strip()
        if not name:
            errors.append(f"행 {row_num}: 시설물명이 없습니다")
            continue

        def parse_float(val: str | None) -> float | None:
            v = (val or "").strip()
            if not v:
                return None
            try:
                return float(v)
            except ValueError:
                return None

        kp_start = parse_float(row.get("kp_start"))
        if kp_start is None:
            errors.append(f"행 {row_num}: 시작 KP가 없거나 형식이 잘못되었습니다")
            continue

        kp_end = parse_float(row.get("kp_end"))
        if cls["geometry_type"] == "linear" and kp_end is None:
            errors.append(f"행 {row_num}: 구간형 시설물은 종료 KP가 필요합니다")
            continue

        direction = (row.get("direction") or "").strip() or None
        if direction and direction not in VALID_DIRECTIONS:
            errors.append(f"행 {row_num}: 방향은 UP/DOWN/BOTH 중 하나여야 합니다")
            continue

        lat = parse_float(row.get("lat"))
        lon = parse_float(row.get("lon"))
        lat_end = parse_float(row.get("lat_end"))
        lon_end = parse_float(row.get("lon_end"))

        if (lat is None) != (lon is None):
            errors.append(f"행 {row_num}: 위도와 경도는 함께 입력해야 합니다")
            continue
        if (lat_end is None) != (lon_end is None):
            errors.append(f"행 {row_num}: 종료 위도와 종료 경도는 함께 입력해야 합니다")
            continue

        def parse_bool(val: str | None) -> bool | None:
            v = (val or "").strip()
            if not v:
                return None
            return v in ("1", "true", "True", "TRUE", "예", "Y", "y")

        anchor_raw = (row.get("use_as_baseline_anchor") or "").strip()
        use_as_baseline_anchor = anchor_raw in ("1", "true", "True", "TRUE", "예", "Y", "y")

        active_raw = (row.get("is_active") or "").strip()
        is_active = (active_raw not in ("0", "false", "False", "FALSE", "아니오", "N", "n")) if active_raw else True

        try:
            db.execute(
                text("""
                    INSERT INTO rail_facilities (
                        rail_route_id, facility_code, name, classification_id,
                        kp_start, kp_end, lat, lon, lat_end, lon_end,
                        direction, section_from, section_to, address,
                        road_width_m, is_paved, bus_accessible,
                        entrance_passage_type, entrance_lock_type,
                        bore_type, use_as_baseline_anchor, is_active, note, updated_at
                    ) VALUES (
                        :rail_route_id, :facility_code, :name, :classification_id,
                        :kp_start, :kp_end, :lat, :lon, :lat_end, :lon_end,
                        :direction, :section_from, :section_to, :address,
                        :road_width_m, :is_paved, :bus_accessible,
                        :entrance_passage_type, :entrance_lock_type,
                        :bore_type, :use_as_baseline_anchor, :is_active, :note, CURRENT_TIMESTAMP
                    )
                    RETURNING id
                """),
                {
                    "rail_route_id": rail_route_id,
                    "facility_code": (row.get("facility_code") or "").strip() or None,
                    "name": name,
                    "classification_id": cls["id"],
                    "kp_start": kp_start,
                    "kp_end": kp_end,
                    "lat": lat,
                    "lon": lon,
                    "lat_end": lat_end,
                    "lon_end": lon_end,
                    "direction": direction,
                    "section_from": (row.get("section_from") or "").strip() or None,
                    "section_to": (row.get("section_to") or "").strip() or None,
                    "address": (row.get("address") or "").strip() or None,
                    "road_width_m": parse_float(row.get("road_width_m")),
                    "is_paved": parse_bool(row.get("is_paved")),
                    "bus_accessible": parse_bool(row.get("bus_accessible")),
                    "entrance_passage_type": (row.get("entrance_passage_type") or "").strip() or None,
                    "entrance_lock_type": (row.get("entrance_lock_type") or "").strip() or None,
                    "bore_type": (row.get("bore_type") or "복선").strip() or "복선",
                    "use_as_baseline_anchor": use_as_baseline_anchor,
                    "is_active": is_active,
                    "note": (row.get("note") or "").strip() or None,
                },
            ).scalar_one()
            facility_id = int(facility_id)
            if use_as_baseline_anchor and is_active and lat is not None:
                _sync_facility_baseline_points(db, facility_id)
            success_count += 1
        except Exception as exc:
            errors.append(f"행 {row_num}: DB 저장 오류 — {exc}")

    db.commit()
    if success_count > 0:
        _rebuild_computed_geometry_route(db, rail_route_id)
        db.commit()
    return {"success": success_count, "errors": errors}


# ── 노선 선로수·전차선 유무 (rail_track_sections) CRUD ────────────────────────

VALID_TRACK_COUNTS = {1, 2, 4, 6}


class TrackSectionCreate(BaseModel):
    start_kp:      float
    end_kp:        float
    track_count:   int   = 2   # 1/2/4/6
    has_catenary:  bool  = True
    note:          str | None = None


class TrackSectionUpdate(BaseModel):
    start_kp:      float | None = None
    end_kp:        float | None = None
    track_count:   int   | None = None
    has_catenary:  bool  | None = None
    note:          str   | None = None


class RouteDefaultUpdate(BaseModel):
    default_track_count:   int  | None = None   # 1/2/4/6
    default_has_catenary:  bool | None = None


def _get_route_defaults(db: Session, rail_route_id: int) -> dict:
    row = db.execute(
        text("SELECT default_track_count, default_has_catenary FROM rail_routes WHERE id = :id"),
        {"id": rail_route_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="노선을 찾을 수 없습니다")
    return dict(row)


def get_effective_track_info(
    db: Session, rail_route_id: int, kp_start: float | None, kp_end: float | None
) -> tuple[int, bool]:
    """특정 KP 구간의 유효 선로 수·전차선 유무를 반환.

    rail_track_sections에 해당 구간이 있으면 그 값을 사용하고,
    없으면 rail_routes 기본값을 반환한다.
    여러 구간에 걸쳐 있으면 가장 엄격한 값(최소 track_count, has_catenary AND)을 반환.
    """
    defaults = _get_route_defaults(db, rail_route_id)

    if kp_start is None or kp_end is None:
        return defaults["default_track_count"], bool(defaults["default_has_catenary"])

    lo, hi = min(kp_start, kp_end), max(kp_start, kp_end)
    sections = db.execute(
        text("""
            SELECT track_count, has_catenary
            FROM rail_track_sections
            WHERE rail_route_id = :rid
              AND start_kp < :hi AND end_kp > :lo
        """),
        {"rid": rail_route_id, "lo": lo, "hi": hi},
    ).fetchall()

    if not sections:
        return defaults["default_track_count"], bool(defaults["default_has_catenary"])

    min_track = min(s.track_count for s in sections)
    all_catenary = all(bool(s.has_catenary) for s in sections)
    return min_track, all_catenary


@router.get("/routes/{rail_route_id}/defaults")
def get_route_defaults(
    rail_route_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """노선 기본 선로수·전차선 유무 조회"""
    _ensure_rail_route(db, rail_route_id)
    defaults = _get_route_defaults(db, rail_route_id)
    return {
        "rail_route_id":       rail_route_id,
        "default_track_count": defaults["default_track_count"],
        "default_has_catenary": bool(defaults["default_has_catenary"]),
    }


@router.patch("/routes/{rail_route_id}/defaults")
def update_route_defaults(
    rail_route_id: int,
    body: RouteDefaultUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """노선 기본 선로수·전차선 유무 수정"""
    _ensure_rail_route(db, rail_route_id)
    updates = body.model_dump(exclude_none=True)
    if not updates:
        return _get_route_defaults(db, rail_route_id)
    if "default_track_count" in updates and updates["default_track_count"] not in VALID_TRACK_COUNTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="선로 수는 1, 2, 4, 6 중 하나여야 합니다",
        )
    set_clauses = ", ".join(f"{k} = :{k}" for k in updates)
    db.execute(
        text(f"UPDATE rail_routes SET {set_clauses} WHERE id = :rail_route_id"),
        {**updates, "rail_route_id": rail_route_id},
    )
    db.commit()
    return _get_route_defaults(db, rail_route_id)


@router.get("/routes/{rail_route_id}/track-sections")
def list_track_sections(
    rail_route_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """노선 구간별 선로수·전차선 예외 목록"""
    _ensure_rail_route(db, rail_route_id)
    rows = db.execute(
        text("""
            SELECT id, rail_route_id, start_kp, end_kp,
                   track_count, has_catenary, note, created_at, updated_at
            FROM rail_track_sections
            WHERE rail_route_id = :rid
            ORDER BY start_kp
        """),
        {"rid": rail_route_id},
    ).mappings().all()
    return [
        {**dict(r), "has_catenary": bool(r["has_catenary"])}
        for r in rows
    ]


@router.post("/routes/{rail_route_id}/track-sections", status_code=status.HTTP_201_CREATED)
def create_track_section(
    rail_route_id: int,
    body: TrackSectionCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """노선 구간별 선로수·전차선 예외 등록"""
    _ensure_rail_route(db, rail_route_id)
    if body.track_count not in VALID_TRACK_COUNTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="선로 수는 1, 2, 4, 6 중 하나여야 합니다",
        )
    if body.end_kp <= body.start_kp:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="종료 KP는 시작 KP보다 커야 합니다",
        )
    db.execute(
        text("""
            INSERT INTO rail_track_sections
                (rail_route_id, start_kp, end_kp, track_count, has_catenary, note, updated_at)
            VALUES
                (:rail_route_id, :start_kp, :end_kp, :track_count, :has_catenary, :note, CURRENT_TIMESTAMP)
            RETURNING id
        """),
        {
            "rail_route_id": rail_route_id,
            "start_kp":      body.start_kp,
            "end_kp":        body.end_kp,
            "track_count":   body.track_count,
            "has_catenary":  body.has_catenary,
            "note":          body.note,
        },
    ).scalar_one()
    new_id = int(new_id)
    db.commit()
    row = db.execute(
        text("SELECT * FROM rail_track_sections WHERE id = :id"), {"id": new_id}
    ).mappings().first()
    return {**dict(row), "has_catenary": bool(row["has_catenary"])}


@router.put("/track-sections/{section_id}")
def update_track_section(
    section_id: int,
    body: TrackSectionUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """구간별 선로수·전차선 예외 수정"""
    existing = db.execute(
        text("SELECT * FROM rail_track_sections WHERE id = :id"), {"id": section_id}
    ).mappings().first()
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="구간 정보를 찾을 수 없습니다")

    updates = body.model_dump(exclude_none=True)
    if not updates:
        return {**dict(existing), "has_catenary": bool(existing["has_catenary"])}

    if "track_count" in updates and updates["track_count"] not in VALID_TRACK_COUNTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="선로 수는 1, 2, 4, 6 중 하나여야 합니다",
        )
    new_start = updates.get("start_kp", existing["start_kp"])
    new_end   = updates.get("end_kp",   existing["end_kp"])
    if new_end <= new_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="종료 KP는 시작 KP보다 커야 합니다",
        )
    set_clauses = ", ".join(f"{k} = :{k}" for k in updates) + ", updated_at = CURRENT_TIMESTAMP"
    db.execute(
        text(f"UPDATE rail_track_sections SET {set_clauses} WHERE id = :id"),
        {**updates, "id": section_id},
    )
    db.commit()
    row = db.execute(
        text("SELECT * FROM rail_track_sections WHERE id = :id"), {"id": section_id}
    ).mappings().first()
    return {**dict(row), "has_catenary": bool(row["has_catenary"])}


@router.delete("/track-sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_track_section(
    section_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """구간별 선로수·전차선 예외 삭제"""
    existing = db.execute(
        text("SELECT id FROM rail_track_sections WHERE id = :id"), {"id": section_id}
    ).first()
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="구간 정보를 찾을 수 없습니다")
    db.execute(text("DELETE FROM rail_track_sections WHERE id = :id"), {"id": section_id})
    db.commit()
