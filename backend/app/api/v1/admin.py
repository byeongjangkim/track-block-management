"""
admin.py — 관리자 전용 API
  - 시설물 CRUD (노선별)
  - 시설물 CSV 업로드 → DB 저장
  - rail_computed_geometry 재계산 (system_superuser 전용)
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
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
            f.station_type or "",
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


# ── rail_computed_geometry 재계산 ─────────────────────────────────────────

class RebuildComputedRequest(BaseModel):
    route_ids: list[int] | None = None  # None이면 전체 노선 재계산


@router.post("/rail-routes/rebuild-computed")
def rebuild_computed_geometry(
    body: RebuildComputedRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """rail_baseline_points → rail_computed_geometry 보간 재계산 — system_superuser 전용"""
    from itertools import groupby as _groupby

    LOD_INTERVALS = {"high": 0.5, "mid": 2.0, "low": 10.0}

    def _interpolated_points(anchors: list, interval: float):
        points = []
        for i in range(len(anchors) - 1):
            kp1, lat1, lon1 = anchors[i]["kp"], anchors[i]["lat"], anchors[i]["lon"]
            kp2, lat2, lon2 = anchors[i + 1]["kp"], anchors[i + 1]["lat"], anchors[i + 1]["lon"]
            if kp2 <= kp1 + 1e-6:
                continue
            points.append((kp1, lat1, lon1))
            kp = kp1 + interval
            while kp < kp2 - 1e-6:
                t = (kp - kp1) / (kp2 - kp1)
                points.append((kp, lat1 + t * (lat2 - lat1), lon1 + t * (lon2 - lon1)))
                kp += interval
        if anchors:
            last = anchors[-1]
            points.append((last["kp"], last["lat"], last["lon"]))
        return points

    if body.route_ids:
        placeholders = ",".join(f":id{i}" for i in range(len(body.route_ids)))
        routes = db.execute(
            text(f"SELECT id, name, line_type FROM rail_routes WHERE id IN ({placeholders})"),
            {f"id{i}": v for i, v in enumerate(body.route_ids)},
        ).fetchall()
    else:
        routes = db.execute(
            text("SELECT id, name, line_type FROM rail_routes ORDER BY name")
        ).fetchall()

    results = []
    for route in routes:
        anchors_all = db.execute(
            text("""
                SELECT segment_no, kp, lat, lon
                FROM rail_baseline_points
                WHERE rail_route_id = :rid AND is_interpolation_anchor = 1
                ORDER BY segment_no, kp
            """),
            {"rid": route.id},
        ).fetchall()

        if not anchors_all:
            results.append({"route_id": route.id, "name": route.name, "status": "skipped", "points": 0})
            continue

        segments: dict[int, list] = {}
        for seg_no, pts in _groupby(anchors_all, key=lambda r: r.segment_no):
            pts_list = [{"kp": r.kp, "lat": r.lat, "lon": r.lon} for r in pts]
            if len(pts_list) >= 2:
                segments[seg_no] = pts_list

        if not segments:
            results.append({"route_id": route.id, "name": route.name, "status": "skipped", "points": 0})
            continue

        total = 0
        for lod, interval in LOD_INTERVALS.items():
            db.execute(
                text("DELETE FROM rail_computed_geometry WHERE rail_route_id = :rid AND lod = :lod"),
                {"rid": route.id, "lod": lod},
            )
            seq = 0
            for seg_no in sorted(segments):
                for kp, lat, lon in _interpolated_points(segments[seg_no], interval):
                    db.execute(
                        text("""
                            INSERT INTO rail_computed_geometry
                                (rail_route_id, line_type, kp, lat, lon, source, lod, seq)
                            VALUES (:rid, :lt, :kp, :lat, :lon, 'interpolated', :lod, :seq)
                        """),
                        {"rid": route.id, "lt": route.line_type,
                         "kp": round(kp, 3), "lat": round(lat, 6), "lon": round(lon, 6),
                         "lod": lod, "seq": seq},
                    )
                    seq += 1
            total += seq

        results.append({"route_id": route.id, "name": route.name, "status": "done", "points": total})

    db.commit()
    done = sum(1 for r in results if r["status"] == "done")
    return {"ok": True, "total": len(results), "done": done, "results": results}
