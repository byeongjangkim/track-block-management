"""
organizations.py — 조직 및 관할 구간 API

  GET    /organizations                              — 전체 조직 목록 (로그인 필요)
  GET    /organizations/{id}                         — 조직 단건 (로그인 필요)
  POST   /organizations                              — 조직 생성 (system_superuser)
  PUT    /organizations/{id}                         — 조직 수정 (system_superuser)
  GET    /organizations/{id}/route-ranges            — 관할 구간 목록 (로그인 필요)
  PUT    /organizations/{id}/route-ranges            — 관할 구간 전체 교체 (system_superuser)
  POST   /organizations/{id}/route-ranges            — 관할 구간 단건 추가 (system_superuser)
  PUT    /organizations/{id}/route-ranges/{range_id} — 관할 구간 단건 수정 (system_superuser)
  DELETE /organizations/{id}/route-ranges/{range_id} — 관할 구간 단건 삭제 (system_superuser)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_superuser
from app.models.organization import Organization, OrganizationRouteRange
from app.models.rail_baseline import RailRoute
from app.models.user import User

router = APIRouter(prefix="/organizations", tags=["조직"])


# ── 스키마 ────────────────────────────────────────────────────────────────────

class OrganizationResponse(BaseModel):
    id: int
    code: str
    name: str
    org_type: str
    is_active: bool
    model_config = {"from_attributes": True}


class OrganizationCreate(BaseModel):
    code: str
    name: str
    org_type: str  # 'regional' | 'special'


class OrganizationUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class RouteRangeItem(BaseModel):
    rail_route_id: int
    field: str = "all"   # 'all' | '시설' | '전기' | '건축'
    start_km: float
    end_km: float


class RouteRangeResponse(RouteRangeItem):
    id: int
    organization_id: int
    route_code: str
    route_name: str
    model_config = {"from_attributes": True}


class RouteRangeUpdate(BaseModel):
    rail_route_id: int | None = None
    field: str | None = None       # 'all' | '시설' | '전기' | '건축'
    start_km: float | None = None
    end_km: float | None = None


# ── 조직 목록 / 단건 ──────────────────────────────────────────────────────────

@router.get("", response_model=list[OrganizationResponse])
def list_organizations(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(Organization).order_by(Organization.sort_order, Organization.id).all()


@router.get("/{org_id}", response_model=OrganizationResponse)
def get_organization(
    org_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="조직을 찾을 수 없습니다")
    return org


# ── 조직 생성 / 수정 (system_superuser) ──────────────────────────────────────

@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
def create_organization(
    body: OrganizationCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    if db.query(Organization).filter(Organization.code == body.code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"코드 '{body.code}' 이미 존재")
    org = Organization(**body.model_dump())
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


@router.put("/{org_id}", response_model=OrganizationResponse)
def update_organization(
    org_id: int,
    body: OrganizationUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="조직을 찾을 수 없습니다")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(org, key, value)
    db.commit()
    db.refresh(org)
    return org


# ── 관할 구간 조회 ────────────────────────────────────────────────────────────

@router.get("/{org_id}/route-ranges", response_model=list[RouteRangeResponse])
def list_route_ranges(
    org_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="조직을 찾을 수 없습니다")

    rows = (
        db.query(OrganizationRouteRange)
        .filter(OrganizationRouteRange.organization_id == org_id)
        .order_by(OrganizationRouteRange.rail_route_id, OrganizationRouteRange.field)
        .all()
    )

    route_map = {r.id: r for r in db.query(RailRoute).all()}
    result = []
    for row in rows:
        route = route_map.get(row.rail_route_id)
        result.append(RouteRangeResponse(
            id=row.id,
            organization_id=row.organization_id,
            rail_route_id=row.rail_route_id,
            route_code=route.korail_route_code if route else "",
            route_name=route.name if route else "",
            field=row.field,
            start_km=row.start_km,
            end_km=row.end_km,
        ))
    return result


# ── 관할 구간 전체 교체 (system_superuser) ───────────────────────────────────

@router.put("/{org_id}/route-ranges", response_model=list[RouteRangeResponse])
def replace_route_ranges(
    org_id: int,
    body: list[RouteRangeItem],
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """기존 관할 구간 전체 삭제 후 새 목록으로 교체"""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="조직을 찾을 수 없습니다")

    # 노선 id 유효성 확인
    rail_route_ids = {item.rail_route_id for item in body}
    valid_ids = {r.id for r in db.query(RailRoute).filter(RailRoute.id.in_(rail_route_ids)).all()}
    invalid = rail_route_ids - valid_ids
    if invalid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"존재하지 않는 노선 id: {invalid}")

    # 기존 삭제 후 재삽입
    db.query(OrganizationRouteRange).filter(
        OrganizationRouteRange.organization_id == org_id
    ).delete()

    route_map = {r.id: r for r in db.query(RailRoute).all()}
    new_rows = []
    for item in body:
        row = OrganizationRouteRange(
            organization_id=org_id,
            rail_route_id=item.rail_route_id,
            field=item.field,
            start_km=item.start_km,
            end_km=item.end_km,
        )
        db.add(row)
        new_rows.append((row, route_map.get(item.rail_route_id)))

    db.commit()

    result = []
    for row, route in new_rows:
        db.refresh(row)
        result.append(RouteRangeResponse(
            id=row.id,
            organization_id=row.organization_id,
            rail_route_id=row.rail_route_id,
            route_code=route.korail_route_code if route else "",
            route_name=route.name if route else "",
            field=row.field,
            start_km=row.start_km,
            end_km=row.end_km,
        ))
    return result


# ── 관할 구간 단건 추가 (system_superuser) ────────────────────────────────────

@router.post("/{org_id}/route-ranges", response_model=RouteRangeResponse, status_code=status.HTTP_201_CREATED)
def add_route_range(
    org_id: int,
    body: RouteRangeItem,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """관할 구간 단건 추가 — (org, route, field) 조합 중복 불가"""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="조직을 찾을 수 없습니다")

    route = db.query(RailRoute).filter(RailRoute.id == body.rail_route_id).first()
    if not route:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="존재하지 않는 노선 id")

    dup = (
        db.query(OrganizationRouteRange)
        .filter(
            OrganizationRouteRange.organization_id == org_id,
            OrganizationRouteRange.rail_route_id == body.rail_route_id,
            OrganizationRouteRange.field == body.field,
        )
        .first()
    )
    if dup:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"이미 등록된 구간입니다 (노선: {route.name}, 분야: {body.field})",
        )

    row = OrganizationRouteRange(
        organization_id=org_id,
        rail_route_id=body.rail_route_id,
        field=body.field,
        start_km=body.start_km,
        end_km=body.end_km,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return RouteRangeResponse(
        id=row.id,
        organization_id=row.organization_id,
        rail_route_id=row.rail_route_id,
        route_code=route.korail_route_code,
        route_name=route.name,
        field=row.field,
        start_km=row.start_km,
        end_km=row.end_km,
    )


# ── 관할 구간 단건 수정 (system_superuser) ────────────────────────────────────

@router.put("/{org_id}/route-ranges/{range_id}", response_model=RouteRangeResponse)
def update_route_range(
    org_id: int,
    range_id: int,
    body: RouteRangeUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """관할 구간 단건 수정 (start_km / end_km / field / route_id 부분 업데이트)"""
    row = (
        db.query(OrganizationRouteRange)
        .filter(
            OrganizationRouteRange.id == range_id,
            OrganizationRouteRange.organization_id == org_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="관할 구간을 찾을 수 없습니다")

    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(row, key, value)

    db.commit()
    db.refresh(row)

    route = db.query(RailRoute).filter(RailRoute.id == row.rail_route_id).first()
    return RouteRangeResponse(
        id=row.id,
        organization_id=row.organization_id,
        rail_route_id=row.rail_route_id,
        route_code=route.korail_route_code if route else "",
        route_name=route.name if route else "",
        field=row.field,
        start_km=row.start_km,
        end_km=row.end_km,
    )


# ── 관할 구간 단건 삭제 (system_superuser) ────────────────────────────────────

@router.delete("/{org_id}/route-ranges/{range_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_route_range(
    org_id: int,
    range_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    """관할 구간 단건 삭제"""
    row = (
        db.query(OrganizationRouteRange)
        .filter(
            OrganizationRouteRange.id == range_id,
            OrganizationRouteRange.organization_id == org_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="관할 구간을 찾을 수 없습니다")

    db.delete(row)
    db.commit()
