from datetime import date, time

from pydantic import BaseModel, field_validator, model_validator

# 선로 이름 유효 값
VALID_TRACKS = {'상선', '하선', '상1', '상2', '상3', '하1', '하2', '하3'}

# 유효한 block_type 목록
VALID_BLOCK_TYPES = {
    '선로차단',       # 노선 위 직접 표시 (장비/인력/기계 모두)
    '전차선단전',     # 변전소간 전차선 단전 (녹색, 노선 위)
    '작업구간설정',   # 차단 없는 인력/기계 이격 표시 (최외방 +0.5×gap)
    '보호지구작업',   # 선로 30m 이내 작업 (최외방 +1.0×gap, 사각형 해칭)
    '임시완속',
    '속도제한',
}

# block_type 중 선로차단 및 전차선단전에 해당하는 것들
TRACK_BLOCK_TYPES = {'선로차단', '전차선단전'}


class BlockOrderCreate(BaseModel):
    route_id: int | None = None              # legacy routes.id
    rail_route_id: int | None = None         # 최종 rail_routes.id
    organization_id: int | None = None  # system_superuser가 타 조직 대신 등록 시 지정
    # 차단 선로 목록: ['상선'] | ['하선'] | ['상선','하선'] | ['상1','하1'] 등
    tracks: list[str]
    # 철도 km과 KP는 같은 의미로 사용한다. km 필드는 legacy 입력 호환용,
    # KP 필드는 최종 rail_baseline_points 보간 기준이다.
    start_km: float | None = None       # 전차선 단전 등 km 없는 경우
    end_km: float | None = None
    start_kp: float | None = None
    end_kp: float | None = None
    section_note: str | None = None     # 단전구간명 (예: "청도SP~밀양SS")
    start_facility_id: int | None = None       # 전차선 단전 시작 변전소 — OLD facilities.id
    end_facility_id: int | None = None         # 전차선 단전 종료 변전소 — OLD facilities.id
    start_rail_facility_id: int | None = None  # 전차선 단전 시작 변전소 — NEW rail_facilities.id
    end_rail_facility_id: int | None = None    # 전차선 단전 종료 변전소 — NEW rail_facilities.id
    work_date: date
    start_time: time
    end_time: time
    field: str
    block_type: str
    # 작업형태: '인력' | '장비' | '기계'
    work_type: str | None = None
    has_equipment: bool = False
    has_labor: bool = True
    # 시행주체: '철도공사' | '철도공단' | '외부'
    implementer: str = '철도공사'
    is_external: bool = False

    @field_validator("tracks")
    @classmethod
    def validate_tracks(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("tracks는 최소 1개의 선로를 지정해야 합니다")
        invalid = [t for t in v if t not in VALID_TRACKS]
        if invalid:
            raise ValueError(f"유효하지 않은 선로명: {invalid}. 허용값: {sorted(VALID_TRACKS)}")
        if len(set(v)) != len(v):
            raise ValueError("tracks에 중복된 선로가 있습니다")
        return v

    @field_validator("work_type")
    @classmethod
    def validate_work_type(cls, v: str | None) -> str | None:
        if v is not None and v not in ('인력', '장비', '기계'):
            raise ValueError("work_type은 '인력', '장비', '기계' 중 하나여야 합니다")
        return v

    @field_validator("implementer")
    @classmethod
    def validate_implementer(cls, v: str) -> str:
        if v not in ('철도공사', '철도공단', '외부'):
            raise ValueError("implementer는 '철도공사', '철도공단', '외부' 중 하나여야 합니다")
        return v

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
    track_name: str | None = None
    danger_level: str | None = None  # 'A'(위험) / 'B'(주의) / 'C'(일반) / None
    note: str | None = None


class BlockOrderUpdate(BaseModel):
    route_id: int | None = None
    rail_route_id: int | None = None
    tracks: list[str] | None = None
    start_km: float | None = None
    end_km: float | None = None
    start_kp: float | None = None
    end_kp: float | None = None
    section_note: str | None = None
    start_facility_id: int | None = None
    end_facility_id: int | None = None
    start_rail_facility_id: int | None = None
    end_rail_facility_id: int | None = None
    work_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    field: str | None = None
    block_type: str | None = None
    work_type: str | None = None
    has_equipment: bool | None = None
    has_labor: bool | None = None
    implementer: str | None = None
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
    track_name: str | None = None
    danger_level: str | None = None
    note: str | None = None

    @field_validator("tracks")
    @classmethod
    def validate_tracks(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if not v:
            raise ValueError("tracks는 최소 1개의 선로를 지정해야 합니다")
        invalid = [t for t in v if t not in VALID_TRACKS]
        if invalid:
            raise ValueError(f"유효하지 않은 선로명: {invalid}")
        return v


class BlockOrderResponse(BaseModel):
    id: int
    organization_id: int | None
    route_id: int | None
    rail_route_id: int | None
    route_name: str | None = None   # 조인 조회 결과 (rail_route.name 우선, route.name fallback)
    tracks: list[str]
    start_km: float | None
    end_km: float | None
    start_kp: float | None
    end_kp: float | None
    section_note: str | None
    start_facility_id: int | None
    end_facility_id: int | None
    start_rail_facility_id: int | None
    end_rail_facility_id: int | None
    work_date: date
    start_time: time
    end_time: time
    field: str
    block_type: str
    work_type: str | None
    has_equipment: bool
    has_labor: bool
    implementer: str
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
    track_name: str | None
    danger_level: str | None
    document_path: str | None
    note: str | None
    created_by: int

    @field_validator("tracks", mode="before")
    @classmethod
    def parse_tracks(cls, v):
        """DB에 저장된 JSON 텍스트를 리스트로 파싱."""
        import json
        if isinstance(v, str):
            return json.loads(v)
        return v


    model_config = {"from_attributes": True}
