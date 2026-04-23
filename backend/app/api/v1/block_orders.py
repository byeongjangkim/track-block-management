from datetime import date, time as time_type

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_org_admin
from app.models.block_order import BlockOrder
from app.models.route import Route
from app.models.user import User
from app.schemas.block_order import BlockOrderCreate, BlockOrderResponse, BlockOrderUpdate
from app.services.auth_service import can_register_block_order, is_owner_or_superuser

router = APIRouter(prefix="/block-orders", tags=["차단명령"])


@router.get("", response_model=list[BlockOrderResponse])
def list_block_orders(
    route_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    organization_id: int | None = None,
    field: str | None = None,
    start_km_from: float | None = None,
    end_km_to: float | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """전국 차단명령 목록 — 모든 로그인 사용자 조회 가능"""
    q = db.query(BlockOrder)
    if route_id is not None:
        q = q.filter(BlockOrder.route_id == route_id)
    if date_from is not None:
        q = q.filter(BlockOrder.work_date >= date_from)
    if date_to is not None:
        q = q.filter(BlockOrder.work_date <= date_to)
    if organization_id is not None:
        q = q.filter(BlockOrder.organization_id == organization_id)
    if field is not None:
        q = q.filter(BlockOrder.field == field)
    if start_km_from is not None:
        q = q.filter(BlockOrder.start_km >= start_km_from)
    if end_km_to is not None:
        q = q.filter(BlockOrder.end_km <= end_km_to)
    return q.order_by(BlockOrder.work_date, BlockOrder.start_time).all()


@router.post("", response_model=BlockOrderResponse, status_code=status.HTTP_201_CREATED)
def create_block_order(
    body: BlockOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """차단명령 등록 — org_admin 이상, 조직+분야+구간 검증"""
    allowed, reason = can_register_block_order(
        user=current_user,
        route_id=body.route_id,
        start_km=body.start_km,
        end_km=body.end_km,
        request_field=body.field,
        db=db,
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)

    # organization_id: system_superuser는 body에서, org_admin은 자기 조직
    org_id = (
        body.organization_id
        if current_user.role == "system_superuser" and body.organization_id is not None
        else current_user.organization_id
    )

    order = BlockOrder(
        **{k: v for k, v in body.model_dump().items() if k != "organization_id"},
        organization_id=org_id,
        created_by=current_user.id,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


@router.get("/{order_id}", response_model=BlockOrderResponse)
def get_block_order(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    order = db.query(BlockOrder).filter(BlockOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="차단명령을 찾을 수 없습니다")
    return order


@router.put("/{order_id}", response_model=BlockOrderResponse)
def update_block_order(
    order_id: int,
    body: BlockOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """수정 — 등록한 조직의 org_admin 또는 system_superuser"""
    order = db.query(BlockOrder).filter(BlockOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="차단명령을 찾을 수 없습니다")

    if not is_owner_or_superuser(current_user, order.organization_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="수정 권한이 없습니다")

    # km·분야가 변경될 경우 재검증
    new_start = body.start_km if body.start_km is not None else order.start_km
    new_end   = body.end_km   if body.end_km   is not None else order.end_km
    new_field = body.field    if body.field     is not None else order.field

    if body.start_km is not None or body.end_km is not None or body.field is not None:
        allowed, reason = can_register_block_order(
            user=current_user,
            route_id=order.route_id,
            start_km=new_start,
            end_km=new_end,
            request_field=new_field,
            db=db,
        )
        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)

    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(order, key, value)
    db.commit()
    db.refresh(order)
    return order


class BulkBlockOrderItem(BaseModel):
    route_id: int
    organization_id: int | None = None
    direction: str
    start_km: float | None = None   # 전차선 단전 등 km 없는 경우 None
    end_km: float | None = None
    section_note: str | None = None # 단전구간명 (예: "청도SP~밀양SS")
    work_date: date                 # Pydantic이 "YYYY-MM-DD" → date 자동 변환
    start_time: str                 # "HH:MM"
    end_time: str                   # "HH:MM"
    field: str
    block_type: str
    has_equipment: bool = False
    has_labor: bool = True
    is_external: bool = False
    doc_no: str | None = None
    dept_head: str | None = None
    dept_head_phone: str | None = None
    work_supervisor: str = ''
    work_supervisor_phone: str | None = None
    safety_manager: str = ''
    safety_manager_phone: str | None = None
    electric_safety_manager: str | None = None
    electric_safety_manager_phone: str | None = None
    contractor: str | None = None
    train_watcher: str | None = None
    train_watcher_phone: str | None = None
    reason: str | None = None
    note: str | None = None


class BulkBlockOrderResult(BaseModel):
    saved: int
    failed: int
    errors: list[str]


@router.post("/bulk", response_model=BulkBlockOrderResult, status_code=status.HTTP_201_CREATED)
def bulk_create_block_orders(
    body: list[BulkBlockOrderItem],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """
    PDF에서 파싱된 차단명령 목록을 일괄 저장.
    각 행마다 권한 검증을 수행하며, 실패한 행은 건너뛰고 에러 목록에 기록.
    """
    if not body:
        raise HTTPException(status_code=400, detail="저장할 항목이 없습니다")

    saved = 0
    failed = 0
    errors: list[str] = []

    for idx, item in enumerate(body, 1):
        row_label = f"행 {idx} ({item.work_date} {item.start_time})"
        try:
            allowed, reason = can_register_block_order(
                user=current_user,
                route_id=item.route_id,
                start_km=item.start_km,
                end_km=item.end_km,
                request_field=item.field,
                db=db,
            )
            if not allowed:
                failed += 1
                errors.append(f"{row_label}: {reason}")
                continue

            org_id = (
                item.organization_id
                if current_user.role == "system_superuser" and item.organization_id is not None
                else current_user.organization_id
            )

            # "HH:MM" → time 객체 변환
            def _to_time(s: str) -> time_type:
                parts = s.split(':')
                return time_type(int(parts[0]), int(parts[1]))

            order = BlockOrder(
                route_id=item.route_id,
                organization_id=org_id,
                direction=item.direction,
                start_km=item.start_km,
                end_km=item.end_km,
                section_note=item.section_note,
                work_date=item.work_date,
                start_time=_to_time(item.start_time),
                end_time=_to_time(item.end_time),
                field=item.field,
                block_type=item.block_type,
                has_equipment=item.has_equipment,
                has_labor=item.has_labor,
                is_external=item.is_external,
                doc_no=item.doc_no,
                dept_head=item.dept_head,
                dept_head_phone=item.dept_head_phone,
                work_supervisor=item.work_supervisor,
                work_supervisor_phone=item.work_supervisor_phone,
                safety_manager=item.safety_manager,
                safety_manager_phone=item.safety_manager_phone,
                electric_safety_manager=item.electric_safety_manager,
                electric_safety_manager_phone=item.electric_safety_manager_phone,
                contractor=item.contractor,
                train_watcher=item.train_watcher,
                train_watcher_phone=item.train_watcher_phone,
                reason=item.reason,
                note=item.note,
                created_by=current_user.id,
            )
            db.add(order)
            saved += 1
        except Exception as exc:
            failed += 1
            errors.append(f"{row_label}: {exc}")

    if saved > 0:
        db.commit()

    return BulkBlockOrderResult(saved=saved, failed=failed, errors=errors)


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_block_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """삭제 — 등록한 조직의 org_admin 또는 system_superuser"""
    order = db.query(BlockOrder).filter(BlockOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="차단명령을 찾을 수 없습니다")

    if not is_owner_or_superuser(current_user, order.organization_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="삭제 권한이 없습니다")

    db.delete(order)
    db.commit()
