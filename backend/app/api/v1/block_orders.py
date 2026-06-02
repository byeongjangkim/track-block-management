from datetime import date, time as time_type

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_org_admin
from app.models.block_order import BlockOrder
from app.models.rail_baseline import RailRoute
from app.models.route import Route
from app.models.user import User
from app.schemas.block_order import BlockOrderCreate, BlockOrderResponse, BlockOrderUpdate
from app.services.auth_service import can_register_block_order, is_owner_or_superuser
from app.api.v1.rail_reference import get_effective_track_info

POWER_CUT_BLOCK_TYPE = "전차선단전"

router = APIRouter(prefix="/block-orders", tags=["차단명령"])


def _rail_route_id_from_legacy_route(db: Session, route_id: int | None) -> int | None:
    if route_id is None:
        return None
    route = db.query(Route).filter(Route.id == route_id).first()
    if not route:
        return None
    candidates = [
        route.name,
        route.name.replace(" (KTX)", ""),
        route.name.replace("고속선", "선"),
    ]
    return (
        db.query(RailRoute.id)
        .filter(RailRoute.name.in_(candidates))
        .order_by(RailRoute.id)
        .scalar()
    )


def _legacy_route_id_from_rail_route(db: Session, rail_route_id: int | None) -> int | None:
    if rail_route_id is None:
        return None
    rail_route = db.query(RailRoute).filter(RailRoute.id == rail_route_id).first()
    if not rail_route:
        return None
    candidates = [
        rail_route.name,
        f"{rail_route.name} (KTX)",
        rail_route.name.replace("선", "고속선"),
    ]
    return (
        db.query(Route.id)
        .filter(Route.name.in_(candidates))
        .order_by(Route.id)
        .scalar()
    )


VALID_WORK_TYPES   = {'인력', '장비', '기계'}
VALID_IMPLEMENTERS = {'철도공사', '철도공단', '외부'}


def _prepare_block_order_data(data: dict, db: Session) -> dict:
    """
    철도 km과 KP는 같은 의미다.
    legacy km 입력은 KP로, 신규 KP 입력은 legacy km으로 복사해 기존 화면과 새 baseline 렌더링을 함께 살린다.
    implementer 에서 is_external 을 자동 동기화한다.
    """
    route_id = data.get("route_id")
    rail_route_id = data.get("rail_route_id")

    if rail_route_id is None:
        rail_route_id = _rail_route_id_from_legacy_route(db, route_id)
        data["rail_route_id"] = rail_route_id
    if route_id is None:
        route_id = _legacy_route_id_from_rail_route(db, rail_route_id)
        data["route_id"] = route_id

    if data.get("start_kp") is None and data.get("start_km") is not None:
        data["start_kp"] = data["start_km"]
    if data.get("end_kp") is None and data.get("end_km") is not None:
        data["end_kp"] = data["end_km"]
    if data.get("start_km") is None and data.get("start_kp") is not None:
        data["start_km"] = data["start_kp"]
    if data.get("end_km") is None and data.get("end_kp") is not None:
        data["end_km"] = data["end_kp"]

    if data.get("rail_route_id") is None and data.get("route_id") is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="노선을 찾을 수 없습니다")

    # implementer → is_external 자동 동기화 (레거시 호환)
    implementer = data.get("implementer")
    if implementer is not None:
        data["is_external"] = (implementer == "외부")

    # tracks: list → JSON 텍스트 직렬화 (DB TEXT 컬럼)
    import json as _json
    tracks = data.get("tracks")
    if isinstance(tracks, list):
        data["tracks"] = _json.dumps(tracks, ensure_ascii=False)

    return data


def _assert_catenary(
    db: Session,
    rail_route_id: int | None,
    block_type: str,
    start_kp: float | None,
    end_kp: float | None,
) -> None:
    """전차선단전 작업은 전차선이 있는 구간에만 등록 가능."""
    if block_type != POWER_CUT_BLOCK_TYPE:
        return
    if rail_route_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="전차선단전 작업은 rail_route_id가 필요합니다",
        )
    _, has_catenary = get_effective_track_info(db, rail_route_id, start_kp, end_kp)
    if not has_catenary:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="비전철 구간(전차선 없음)에는 전차선단전 작업을 등록할 수 없습니다",
        )


def _assert_can_register(
    current_user: User,
    route_id: int | None,
    start_kp: float | None,
    end_kp: float | None,
    field: str,
    db: Session,
    rail_route_id: int | None = None,
    block_type: str = "",
) -> None:
    # 전차선단전: 전차선 유무 사전 검증
    _assert_catenary(db, rail_route_id, block_type, start_kp, end_kp)

    # 기지 노선(line_type='기지')은 legacy route 매핑이 없으므로 별도 처리:
    # org_admin 이상이면 자기 조직의 기지 작업으로 허용한다.
    if route_id is None and rail_route_id is not None:
        depot = db.query(RailRoute).filter(
            RailRoute.id == rail_route_id, RailRoute.line_type == "기지"
        ).first()
        if depot:
            return  # 기지 작업은 KP 관할구간 검증 생략, org_admin 권한만으로 허용
    if route_id is None and current_user.role != "system_superuser":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관할구간 검증용 legacy route가 없어 등록할 수 없습니다",
        )
    allowed, reason = can_register_block_order(
        user=current_user,
        route_id=route_id or 0,
        start_km=start_kp,
        end_km=end_kp,
        request_field=field,
        db=db,
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)


@router.get("", response_model=list[BlockOrderResponse])
def list_block_orders(
    route_id: int | None = None,
    rail_route_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    organization_id: int | None = None,
    field: str | None = None,
    work_type: str | None = None,         # 작업형태: 인력 | 장비 | 기계
    implementer: str | None = None,       # 시행주체: 철도공사 | 철도공단 | 외부
    is_external: bool | None = None,      # 레거시 (implementer='외부'로 대체)
    start_km_from: float | None = None,
    end_km_to: float | None = None,
    start_kp_from: float | None = None,
    end_kp_to: float | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """전국 차단명령 목록 — 모든 로그인 사용자 조회 가능"""
    q = db.query(BlockOrder)
    if route_id is not None:
        q = q.filter(BlockOrder.route_id == route_id)
    if rail_route_id is not None:
        q = q.filter(BlockOrder.rail_route_id == rail_route_id)
    if date_from is not None:
        q = q.filter(BlockOrder.work_date >= date_from)
    if date_to is not None:
        q = q.filter(BlockOrder.work_date <= date_to)
    if organization_id is not None:
        q = q.filter(BlockOrder.organization_id == organization_id)
    if field is not None:
        q = q.filter(BlockOrder.field == field)
    if work_type is not None:
        q = q.filter(BlockOrder.work_type == work_type)
    if implementer is not None:
        q = q.filter(BlockOrder.implementer == implementer)
    elif is_external is not None:
        # 레거시 파라미터: is_external → implementer='외부'/'철도공사' 로 변환
        q = q.filter(BlockOrder.implementer == ("외부" if is_external else "철도공사"))
    if start_km_from is not None:
        q = q.filter(BlockOrder.start_kp >= start_km_from)
    if end_km_to is not None:
        q = q.filter(BlockOrder.end_kp <= end_km_to)
    if start_kp_from is not None:
        q = q.filter(BlockOrder.start_kp >= start_kp_from)
    if end_kp_to is not None:
        q = q.filter(BlockOrder.end_kp <= end_kp_to)
    return q.order_by(BlockOrder.work_date, BlockOrder.start_time).all()


@router.post("", response_model=BlockOrderResponse, status_code=status.HTTP_201_CREATED)
def create_block_order(
    body: BlockOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """차단명령 등록 — org_admin 이상, 조직+분야+구간+전차선 검증"""
    data = _prepare_block_order_data(body.model_dump(), db)
    _assert_can_register(
        current_user=current_user,
        route_id=data.get("route_id"),
        start_kp=data.get("start_kp"),
        end_kp=data.get("end_kp"),
        field=data["field"],
        db=db,
        rail_route_id=data.get("rail_route_id"),
        block_type=data.get("block_type", ""),
    )

    # organization_id: system_superuser는 body에서, org_admin은 자기 조직
    org_id = (
        body.organization_id
        if current_user.role == "system_superuser" and body.organization_id is not None
        else current_user.organization_id
    )

    order = BlockOrder(
        **{k: v for k, v in data.items() if k != "organization_id"},
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
    body_data = body.model_dump(exclude_unset=True)
    data = _prepare_block_order_data(
        {
            "route_id": order.route_id,
            "rail_route_id": order.rail_route_id,
            "start_km": order.start_km,
            "end_km": order.end_km,
            "start_kp": order.start_kp,
            "end_kp": order.end_kp,
            **body_data,
        },
        db,
    )
    new_start = data.get("start_kp")
    new_end = data.get("end_kp")
    new_field = body.field    if body.field     is not None else order.field

    if {"route_id", "rail_route_id", "start_km", "end_km", "start_kp", "end_kp", "field", "block_type"} & body_data.keys():
        new_block_type = body.block_type if body.block_type is not None else order.block_type
        _assert_can_register(
            current_user=current_user,
            route_id=data.get("route_id"),
            start_kp=new_start,
            end_kp=new_end,
            field=new_field,
            db=db,
            rail_route_id=data.get("rail_route_id"),
            block_type=new_block_type,
        )

    for key, value in data.items():
        setattr(order, key, value)
    db.commit()
    db.refresh(order)
    return order


class BulkBlockOrderItem(BaseModel):
    route_id: int | None = None
    rail_route_id: int | None = None
    organization_id: int | None = None
    tracks: list[str]
    start_km: float | None = None   # 전차선 단전 등 km 없는 경우 None
    end_km: float | None = None
    start_kp: float | None = None
    end_kp: float | None = None
    section_note: str | None = None # 단전구간명 (예: "청도SP~밀양SS")
    work_date: date                 # Pydantic이 "YYYY-MM-DD" → date 자동 변환
    start_time: str                 # "HH:MM"
    end_time: str                   # "HH:MM"
    field: str
    block_type: str
    work_type: str | None = None      # 인력 | 장비 | 기계
    has_equipment: bool = False
    has_labor: bool = True
    implementer: str = '철도공사'     # 철도공사 | 철도공단 | 외부
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
    track_name: str | None = None
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
            data = _prepare_block_order_data(item.model_dump(), db)
            _assert_can_register(
                current_user=current_user,
                route_id=data.get("route_id"),
                start_kp=data.get("start_kp"),
                end_kp=data.get("end_kp"),
                field=data["field"],
                db=db,
                rail_route_id=data.get("rail_route_id"),
                block_type=data.get("block_type", ""),
            )

            org_id = (
                item.organization_id
                if current_user.role == "system_superuser" and item.organization_id is not None
                else current_user.organization_id
            )

            # "HH:MM" → time 객체 변환
            def _to_time(s: str) -> time_type:
                parts = s.split(':')
                return time_type(int(parts[0]), int(parts[1]))

            import json as _json
            order = BlockOrder(
                route_id=data.get("route_id"),
                rail_route_id=data.get("rail_route_id"),
                organization_id=org_id,
                tracks=_json.dumps(data["tracks"], ensure_ascii=False),
                start_km=data.get("start_km"),
                end_km=data.get("end_km"),
                start_kp=data.get("start_kp"),
                end_kp=data.get("end_kp"),
                section_note=data.get("section_note"),
                work_date=item.work_date,
                start_time=_to_time(item.start_time),
                end_time=_to_time(item.end_time),
                field=item.field,
                block_type=item.block_type,
                work_type=item.work_type,
                has_equipment=item.has_equipment,
                has_labor=item.has_labor,
                implementer=item.implementer,
                is_external=(item.implementer == '외부'),
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
