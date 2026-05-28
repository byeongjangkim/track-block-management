import csv
import io
from itertools import groupby as _groupby

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_org_admin
from app.models.user import User

router = APIRouter(prefix="/rail-reference", tags=["기준정보"])

VALID_DIRECTIONS = {"UP", "DOWN", "BOTH"}


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

    direction = merged.get("direction")
    if direction not in (None, "") and direction not in VALID_DIRECTIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="방향은 UP, DOWN, BOTH 중 하나여야 합니다")
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
                    mo.region_name AS management_region_name,
                    mo.office_name AS management_office_name,
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
              AND is_interpolation_anchor = 1
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
                    rf.use_as_baseline_anchor,
                    rf.is_active,
                    c.geometry_type
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
                    "note": "철도시설물 종료점 기준선 앵커",
                }
            )
    elif row["kp_start"] is not None and row["lat"] is not None and row["lon"] is not None:
        point_rows.append(
            {
                "point_type": "facility_point",
                "kp": row["kp_start"],
                "lat": row["lat"],
                "lon": row["lon"],
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
                    1,
                    1,
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
                    SUM(CASE WHEN is_render_anchor = 1 THEN 1 ELSE 0 END) AS render_anchor_count,
                    SUM(CASE WHEN is_interpolation_anchor = 1 THEN 1 ELSE 0 END) AS interpolation_anchor_count
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
                            WHERE is_render_anchor = 1
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
                        SUM(CASE WHEN is_render_anchor = 1 THEN 1 ELSE 0 END) AS render_anchor_count,
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
        item["is_active"] = bool(item["is_active"])
        items.append(item)
    return items


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
                    mo.region_name AS management_region_name,
                    mo.office_name AS management_office_name,
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
                :use_as_baseline_anchor,
                :is_active,
                :note,
                CURRENT_TIMESTAMP
            )
            """
        ),
        data,
    )
    facility_id = int(db.execute(text("SELECT last_insert_rowid()")).scalar_one())
    _sync_facility_baseline_points(db, facility_id)
    _rebuild_computed_geometry_route(db, rail_route_id)
    db.commit()
    return _facility_response(db, facility_id)


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
            WHERE is_active = 1
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
                        use_as_baseline_anchor, is_active, note, updated_at
                    ) VALUES (
                        :rail_route_id, :facility_code, :name, :classification_id,
                        :kp_start, :kp_end, :lat, :lon, :lat_end, :lon_end,
                        :direction, :section_from, :section_to, :address,
                        :road_width_m, :is_paved, :bus_accessible,
                        :entrance_passage_type, :entrance_lock_type,
                        :use_as_baseline_anchor, :is_active, :note, CURRENT_TIMESTAMP
                    )
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
                    "use_as_baseline_anchor": use_as_baseline_anchor,
                    "is_active": is_active,
                    "note": (row.get("note") or "").strip() or None,
                },
            )
            success_count += 1
        except Exception as exc:
            errors.append(f"행 {row_num}: DB 저장 오류 — {exc}")

    db.commit()
    return {"success": success_count, "errors": errors}
