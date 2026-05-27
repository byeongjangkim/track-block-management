"""
admin.py — 관리자 전용 API
  - 시설물 CRUD (노선별)
  - 시설물 CSV 업로드 → DB 저장
  - 노선도 geometry 관리 (SHP import / user CSV 업로드 / SHP 삭제)
"""

import io

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_org_admin, require_superuser
from app.models.facility import Facility
from app.models.route import Route
from app.models.user import User
from app.schemas.facility import FacilityCreate, FacilityResponse, FacilityUpdate
from app.services.facility_service import (
    CSV_TEMPLATE_COMMENTS,
    CSV_TEMPLATE_HEADER,
    parse_csv_text,
    save_facilities_to_db,
)
from app.services.shp_service import (
    import_routes as shp_import_routes,
    list_shp_routes,
    shp_available,
)
from app.services.geometry_service import (
    parse_geometry_csv,
    save_geometry,
)

router = APIRouter(prefix="/admin", tags=["관리자"])


def _get_route(route_code: str, db: Session) -> Route:
    route = db.query(Route).filter(Route.code == route_code).first()
    if not route:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"노선 '{route_code}' 없음")
    return route


# ── CSV 템플릿 다운로드 ───────────────────────────────────────────────────

@router.get("/routes/{route_code}/csv-template", response_class=PlainTextResponse)
def download_csv_template(
    route_code: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """노선별 시설물 CSV 입력 템플릿 다운로드 (기존 데이터 포함)"""
    route = _get_route(route_code, db)
    existing = (
        db.query(Facility)
        .filter(Facility.route_id == route.id)
        .order_by(Facility.km)
        .all()
    )

    lines = [CSV_TEMPLATE_COMMENTS, CSV_TEMPLATE_HEADER]
    for f in existing:
        cols = [
            f.type,
            f.name,
            str(f.km),
            str(f.km_end)  if f.km_end is not None else "",
            str(f.lat)     if f.lat    is not None else "",
            str(f.lon)     if f.lon    is not None else "",
            f.direction or "",
            "1" if f.has_station_map else "0",
            f.note or "",
        ]
        lines.append(",".join(cols))

    content = "\n".join(lines) + "\n"
    filename = f"{route_code}_facilities.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return PlainTextResponse(content=content, media_type="text/csv; charset=utf-8", headers=headers)


# ── 시설물 목록 조회 ──────────────────────────────────────────────────────

@router.get("/routes/{route_code}/facilities", response_model=list[FacilityResponse])
def list_facilities(
    route_code: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    route = _get_route(route_code, db)
    return (
        db.query(Facility)
        .filter(Facility.route_id == route.id)
        .order_by(Facility.km)
        .all()
    )


# ── 시설물 단건 추가 ──────────────────────────────────────────────────────

@router.post(
    "/routes/{route_code}/facilities",
    response_model=FacilityResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_facility(
    route_code: str,
    body: FacilityCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    route = _get_route(route_code, db)
    f = Facility(route_id=route.id, **body.model_dump())
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


# ── 시설물 수정 ───────────────────────────────────────────────────────────

@router.put("/facilities/{facility_id}", response_model=FacilityResponse)
def update_facility(
    facility_id: int,
    body: FacilityUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    f = db.query(Facility).filter(Facility.id == facility_id).first()
    if not f:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시설물 없음")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(f, field, value)
    db.commit()
    db.refresh(f)
    return f


# ── 시설물 삭제 ───────────────────────────────────────────────────────────

@router.delete("/facilities/{facility_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_facility(
    facility_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    f = db.query(Facility).filter(Facility.id == facility_id).first()
    if not f:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="시설물 없음")
    db.delete(f)
    db.commit()


# ── 시설물 CSV 업로드 ─────────────────────────────────────────────────────

@router.post("/routes/{route_code}/upload-csv")
async def upload_csv(
    route_code: str,
    file: UploadFile,
    db: Session = Depends(get_db),
    _: User = Depends(require_org_admin),
):
    """시설물 CSV 업로드 → facilities 테이블 저장 (기존 데이터 교체)"""
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV 파일만 허용됩니다")

    route = _get_route(route_code, db)
    content = await file.read()
    try:
        text_data = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text_data = content.decode("cp949", errors="replace")

    rows, errors = parse_csv_text(text_data)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "유효한 행 없음", "errors": errors},
        )

    saved = save_facilities_to_db(db, route, rows, replace=True)

    return {
        "route_code": route_code,
        "row_count":  len(saved),
        "errors":     errors,
    }


# ── SHP 노선 목록 ─────────────────────────────────────────────────────────

class ShpImportRequest(BaseModel):
    route_codes: list[str]


@router.get("/shp/routes")
def get_shp_routes(
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """SHP 파일 내 import 가능한 노선 목록 반환 (system_superuser 전용)"""
    if not shp_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SHP 파일이 서버에 없습니다. maps/raw/railway_line/TN_RLROAD_CTLN.shp 를 확인하세요.",
        )
    routes = list_shp_routes(db)
    return {"shp_available": True, "routes": routes}


# ── 노선도 geometry 현황 ──────────────────────────────────────────────────

@router.get("/routes/geometry-status")
def get_geometry_status(
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """전 노선 geometry 현황 — system_superuser 전용"""
    routes = db.execute(text("SELECT id, code, name FROM routes ORDER BY id")).fetchall()
    result = []
    for route_id, code, name in routes:
        shp = db.execute(text("""
            SELECT COUNT(DISTINCT segment) AS segs, COUNT(*) AS pts
            FROM route_geometry WHERE route_code=:code AND source='shp' AND lod='high'
        """), {"code": code}).fetchone()
        user = db.execute(text("""
            SELECT COUNT(DISTINCT segment) AS segs, COUNT(*) AS pts,
                   MIN(km) AS km_min, MAX(km) AS km_max
            FROM route_geometry WHERE route_code=:code AND source='user' AND lod='high'
        """), {"code": code}).fetchone()
        result.append({
            "route_code": code,
            "route_name": name,
            "shp":  {"exists": (shp.pts or 0) > 0,  "segments": shp.segs or 0,  "points": shp.pts or 0},
            "user": {"exists": (user.pts or 0) > 0, "segments": user.segs or 0, "points": user.pts or 0,
                     "km_min": user.km_min, "km_max": user.km_max},
        })
    return result


# ── 노선도 geometry 포인트 스키마 ─────────────────────────────────────────

class GeometryPointCreate(BaseModel):
    segment: int = 0
    lat: float
    lon: float
    km: float | None = None

class GeometryPointUpdate(BaseModel):
    segment: int | None = None
    lat: float | None = None
    lon: float | None = None
    km: float | None = None


# ── 노선도 geometry CSV 다운로드 (현재 user geometry) ─────────────────────

@router.get("/routes/{route_code}/geometry-download", response_class=PlainTextResponse)
def download_geometry_user(
    route_code: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """등록된 user geometry CSV 다운로드 — system_superuser 전용"""
    _get_route(route_code, db)
    rows = db.execute(text("""
        SELECT segment, seq, lat, lon, km FROM route_geometry
        WHERE route_code=:code AND source='user' AND lod='high'
        ORDER BY segment, seq
    """), {"code": route_code}).fetchall()

    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"'{route_code}' user geometry 없음")

    lines = [
        "# segment: 선분 번호 (0=본선 중앙선)",
        "# lat, lon: WGS84 좌표",
        "# km: KORAIL 공식 거리정 (없으면 빈값)",
        "segment,lat,lon,km",
    ]
    for r in rows:
        km_str = f"{r.km:.3f}" if r.km is not None else ""
        lines.append(f"{r.segment},{r.lat},{r.lon},{km_str}")

    content = "\n".join(lines) + "\n"
    headers = {"Content-Disposition": f'attachment; filename="{route_code}_geometry.csv"'}
    return PlainTextResponse(content=content, media_type="text/csv; charset=utf-8", headers=headers)


# ── 노선도 geometry CSV 템플릿 다운로드 (SHP 기반 또는 빈 양식) ──────────

@router.get("/routes/{route_code}/geometry-template", response_class=PlainTextResponse)
def download_geometry_template(
    route_code: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """
    노선도 CSV 템플릿 다운로드.
    우선순위: ① USER geometry → ② SHP geometry → ③ 역 앵커만 → ④ 빈 양식
    """
    route = _get_route(route_code, db)
    stations = (
        db.query(Facility)
        .filter(Facility.route_id == route.id, Facility.type == "역")
        .order_by(Facility.km)
        .all()
    )
    header = [
        "# 노선: " + route.name,
        "# ── 관리역 km 기준값 ──",
        *[f"# {f.name}: km={f.km}" + (f", lat={f.lat:.5f}, lon={f.lon:.5f}" if f.lat else "") for f in stations],
        "#",
        "# segment: 선분 번호 (0=본선 중앙선)",
        "# km: KORAIL 공식 거리정 (없으면 빈값, 나중에 입력 가능)",
        "#",
        "segment,lat,lon,km",
    ]

    # ① USER 있으면 그대로
    user_rows = db.execute(text("""
        SELECT segment, seq, lat, lon, km FROM route_geometry
        WHERE route_code=:code AND source='user' AND lod='high' ORDER BY segment, seq
    """), {"code": route_code}).fetchall()
    if user_rows:
        lines = header + [f"{r.segment},{r.lat},{r.lon},{r.km:.3f}" if r.km is not None else f"{r.segment},{r.lat},{r.lon}," for r in user_rows]
        content = "\n".join(lines) + "\n"
        headers = {"Content-Disposition": f'attachment; filename="{route_code}_geometry.csv"'}
        return PlainTextResponse(content=content, media_type="text/csv; charset=utf-8", headers=headers)

    # ② SHP 있으면 그대로 (km=빈값)
    shp_rows = db.execute(text("""
        SELECT segment, seq, lat, lon FROM route_geometry
        WHERE route_code=:code AND source='shp' AND lod='high' ORDER BY segment, seq
    """), {"code": route_code}).fetchall()
    if shp_rows:
        lines = ["# SHP 기반 형태 데이터 — km 값을 KORAIL 거리정으로 입력하세요"] + header + [f"{r.segment},{r.lat},{r.lon}," for r in shp_rows]
        content = "\n".join(lines) + "\n"
        headers = {"Content-Disposition": f'attachment; filename="{route_code}_geometry.csv"'}
        return PlainTextResponse(content=content, media_type="text/csv; charset=utf-8", headers=headers)

    # ③ 역 앵커만
    anchor_stations = [f for f in stations if f.lat is not None]
    if anchor_stations:
        lines = header + [f"0,{f.lat:.6f},{f.lon:.6f},{f.km:.3f}" for f in anchor_stations]
        content = "\n".join(lines) + "\n"
        headers = {"Content-Disposition": f'attachment; filename="{route_code}_geometry.csv"'}
        return PlainTextResponse(content=content, media_type="text/csv; charset=utf-8", headers=headers)

    # ④ 빈 양식
    content = "\n".join(header) + "\n"
    headers = {"Content-Disposition": f'attachment; filename="{route_code}_geometry.csv"'}
    return PlainTextResponse(content=content, media_type="text/csv; charset=utf-8", headers=headers)


# ── 노선도 geometry CSV 업로드 ────────────────────────────────────────────

@router.post("/routes/{route_code}/geometry-upload")
async def upload_geometry(
    route_code: str,
    file: UploadFile,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """노선도 CSV 업로드 → user geometry 저장 — system_superuser 전용"""
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV 파일만 허용됩니다")

    route = _get_route(route_code, db)
    raw = await file.read()
    try:
        text_data = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text_data = raw.decode("cp949", errors="replace")

    rows, errors = parse_geometry_csv(text_data)
    if not rows:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"message": "유효한 행 없음", "errors": errors})

    saved = save_geometry(db, route_code, rows)
    return {"route_code": route_code, "route_name": route.name, "rows_saved": saved, "errors": errors}


# ── 노선도 geometry 포인트 목록 (페이지네이션) ────────────────────────────

@router.get("/routes/{route_code}/geometry-points")
def list_geometry_points(
    route_code: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=10, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    _get_route(route_code, db)
    offset = (page - 1) * per_page
    total = db.execute(
        text("SELECT COUNT(*) FROM route_geometry WHERE route_code=:code AND source='user' AND lod='high'"),
        {"code": route_code},
    ).scalar() or 0
    rows = db.execute(text("""
        SELECT id, segment, seq, lat, lon, km FROM route_geometry
        WHERE route_code=:code AND source='user' AND lod='high'
        ORDER BY segment, seq LIMIT :lim OFFSET :off
    """), {"code": route_code, "lim": per_page, "off": offset}).fetchall()
    return {
        "total": total, "page": page, "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
        "items": [{"id": r.id, "segment": r.segment, "seq": r.seq,
                   "lat": r.lat, "lon": r.lon, "km": r.km} for r in rows],
    }


# ── 노선도 geometry 포인트 추가 ───────────────────────────────────────────

@router.post("/routes/{route_code}/geometry-points", status_code=status.HTTP_201_CREATED)
def create_geometry_point(
    route_code: str,
    body: GeometryPointCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    _get_route(route_code, db)
    max_seq = db.execute(text("""
        SELECT COALESCE(MAX(seq), -1) FROM route_geometry
        WHERE route_code=:code AND source='user' AND lod='high' AND segment=:seg
    """), {"code": route_code, "seg": body.segment}).scalar()
    new_seq = max_seq + 1
    db.execute(text("""
        INSERT INTO route_geometry (route_code, source, lod, segment, seq, lat, lon, km)
        VALUES (:code, 'user', 'high', :seg, :seq, :lat, :lon, :km)
    """), {"code": route_code, "seg": body.segment, "seq": new_seq,
          "lat": body.lat, "lon": body.lon, "km": body.km})
    new_id = db.execute(text("SELECT last_insert_rowid()")).scalar()
    db.commit()
    return {"id": new_id, "segment": body.segment, "seq": new_seq,
            "lat": body.lat, "lon": body.lon, "km": body.km}


# ── 노선도 geometry 포인트 수정 ───────────────────────────────────────────

@router.put("/routes/{route_code}/geometry-points/{point_id}")
def update_geometry_point(
    route_code: str,
    point_id: int,
    body: GeometryPointUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    row = db.execute(text("""
        SELECT id, segment, seq, lat, lon, km FROM route_geometry
        WHERE id=:id AND route_code=:code AND source='user' AND lod='high'
    """), {"id": point_id, "code": route_code}).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="포인트 없음")
    updates = body.model_dump(exclude_unset=True)
    if updates:
        set_clauses = ", ".join(f"{k}=:{k}" for k in updates)
        db.execute(text(f"UPDATE route_geometry SET {set_clauses} WHERE id=:id"),
                   {"id": point_id, **updates})
        db.commit()
        row = db.execute(text("SELECT id, segment, seq, lat, lon, km FROM route_geometry WHERE id=:id"),
                         {"id": point_id}).fetchone()
    return {"id": row.id, "segment": row.segment, "seq": row.seq,
            "lat": row.lat, "lon": row.lon, "km": row.km}


# ── 노선도 geometry 포인트 삭제 ───────────────────────────────────────────

@router.delete("/routes/{route_code}/geometry-points/{point_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_geometry_point(
    route_code: str,
    point_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    row = db.execute(text("""
        SELECT id FROM route_geometry
        WHERE id=:id AND route_code=:code AND source='user' AND lod='high'
    """), {"id": point_id, "code": route_code}).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="포인트 없음")
    db.execute(text("DELETE FROM route_geometry WHERE id=:id"), {"id": point_id})
    db.commit()


# ── SHP import ────────────────────────────────────────────────────────────

@router.post("/shp/import")
def import_shp(
    body: ShpImportRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """선택한 노선을 SHP에서 읽어 route_geometry(source='shp')에 저장 — system_superuser 전용"""
    if not shp_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SHP 파일이 서버에 없습니다.",
        )
    if not body.route_codes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="route_codes가 비어있습니다.")

    try:
        results = shp_import_routes(body.route_codes, db)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    success = sum(1 for r in results if r["status"] == "완료")
    return {
        "ok":      True,
        "total":   len(results),
        "success": success,
        "results": results,
    }


# ── SHP 파일 업로드 → user geometry 저장 ─────────────────────────────────

@router.post("/routes/{route_code}/import-shp")
async def import_shp_upload(
    route_code: str,
    shp_file: UploadFile,
    dbf_file: UploadFile,
    prj_file: UploadFile | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """
    SHP 파일 업로드 → EPSG:5179→WGS84 변환 → user geometry 저장
    필수: .shp, .dbf / 선택: .prj
    system_superuser 전용
    """
    import tempfile, os, shapefile, pyproj
    from shapely.geometry import shape

    route = _get_route(route_code, db)

    transformer = pyproj.Transformer.from_crs("EPSG:5179", "EPSG:4326", always_xy=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        shp_path = os.path.join(tmpdir, "upload.shp")
        dbf_path = os.path.join(tmpdir, "upload.dbf")

        with open(shp_path, "wb") as f:
            f.write(await shp_file.read())
        with open(dbf_path, "wb") as f:
            f.write(await dbf_file.read())

        if prj_file:
            prj_path = os.path.join(tmpdir, "upload.prj")
            with open(prj_path, "wb") as f:
                f.write(await prj_file.read())

        try:
            sf = shapefile.Reader(shp_path)
            records = sf.shapeRecords()
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"SHP 파싱 실패: {e}")

    rows: list[dict] = []
    for seg_idx, sr in enumerate(records):
        geom = shape(sr.shape.__geo_interface__)
        if geom.geom_type == "LineString":
            lines = [geom]
        elif geom.geom_type == "MultiLineString":
            lines = list(geom.geoms)
        else:
            continue

        for line in lines:
            for seq, (x, y) in enumerate(line.coords):
                lon, lat = transformer.transform(x, y)
                rows.append({"segment": seg_idx, "seq": seq, "lat": lat, "lon": lon, "km": None})

    if not rows:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="변환된 좌표가 없습니다.")

    saved = save_geometry(db, route_code, rows)
    return {
        "route_code": route_code,
        "route_name": route.name,
        "rows_saved": saved,
    }
