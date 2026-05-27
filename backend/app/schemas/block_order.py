from datetime import date, time

from pydantic import BaseModel, field_validator


class BlockOrderCreate(BaseModel):
    route_id: int | None = None              # legacy routes.id
    rail_route_id: int | None = None         # 최종 rail_routes.id
    organization_id: int | None = None  # system_superuser가 타 조직 대신 등록 시 지정
    direction: str
    # 철도 km과 KP는 같은 의미로 사용한다. km 필드는 legacy 입력 호환용,
    # KP 필드는 최종 rail_baseline_points 보간 기준이다.
    start_km: float | None = None       # 전차선 단전 등 km 없는 경우
    end_km: float | None = None
    start_kp: float | None = None
    end_kp: float | None = None
    section_note: str | None = None     # 단전구간명 (예: "청도SP~밀양SS")
    start_facility_id: int | None = None  # 전차선 단전 시작 변전소 (facilities.id)
    end_facility_id: int | None = None    # 전차선 단전 종료 변전소 (facilities.id)
    work_date: date
    start_time: time
    end_time: time
    field: str
    block_type: str
    has_equipment: bool = False
    has_labor: bool = True
    is_external: bool = False
    doc_no: str | None = None
    dept_head: str | None = None
    dept_head_phone: str | None = None
    work_supervisor: str
    work_supervisor_phone: str | None = None
    safety_manager: str
    safety_manager_phone: str | None = None
    electric_safety_manager: str | None = None
    electric_safety_manager_phone: str | None = None
    contractor: str | None = None
    train_watcher: str | None = None
    train_watcher_phone: str | None = None
    reason: str | None = None
    safety_items: str | None = None
    note: str | None = None

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v: str) -> str:
        if v not in ("UP", "DOWN"):
            raise ValueError("direction은 'UP' 또는 'DOWN' 이어야 합니다")
        return v


class BlockOrderUpdate(BaseModel):
    route_id: int | None = None
    rail_route_id: int | None = None
    direction: str | None = None
    start_km: float | None = None
    end_km: float | None = None
    start_kp: float | None = None
    end_kp: float | None = None
    section_note: str | None = None
    start_facility_id: int | None = None
    end_facility_id: int | None = None
    work_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    field: str | None = None
    block_type: str | None = None
    has_equipment: bool | None = None
    has_labor: bool | None = None
    is_external: bool | None = None
    doc_no: str | None = None
    dept_head: str | None = None
    dept_head_phone: str | None = None
    work_supervisor: str | None = None
    work_supervisor_phone: str | None = None
    safety_manager: str | None = None
    safety_manager_phone: str | None = None
    electric_safety_manager: str | None = None
    electric_safety_manager_phone: str | None = None
    contractor: str | None = None
    train_watcher: str | None = None
    train_watcher_phone: str | None = None
    reason: str | None = None
    safety_items: str | None = None
    note: str | None = None


class BlockOrderResponse(BaseModel):
    id: int
    organization_id: int | None
    route_id: int | None
    rail_route_id: int | None
    direction: str
    start_km: float | None
    end_km: float | None
    start_kp: float | None
    end_kp: float | None
    section_note: str | None
    start_facility_id: int | None
    end_facility_id: int | None
    work_date: date
    start_time: time
    end_time: time
    field: str
    block_type: str
    has_equipment: bool
    has_labor: bool
    is_external: bool
    doc_no: str | None
    dept_head: str | None
    dept_head_phone: str | None
    work_supervisor: str
    work_supervisor_phone: str | None
    safety_manager: str
    safety_manager_phone: str | None
    electric_safety_manager: str | None
    electric_safety_manager_phone: str | None
    contractor: str | None
    train_watcher: str | None
    train_watcher_phone: str | None
    reason: str | None
    safety_items: str | None
    document_path: str | None
    note: str | None
    created_by: int

    model_config = {"from_attributes": True}
