from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel

VALID_PROJECT_TYPES = {"공사", "유지보수", "외부", "기타"}
VALID_IMPLEMENTERS  = {"철도공사", "철도공단", "외부"}
VALID_STATUSES      = {"계획", "진행중", "완료", "중지"}
VALID_FIELDS        = {"시설", "전기", "건축", "all"}


class ProjectCreate(BaseModel):
    name: str
    project_type: str = "공사"
    organization_id: Optional[int] = None
    rail_route_id: Optional[int] = None
    field: Optional[str] = None
    implementer: str = "철도공사"
    contractor: Optional[str] = None
    contract_number: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: str = "진행중"
    description: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    project_type: Optional[str] = None
    organization_id: Optional[int] = None
    rail_route_id: Optional[int] = None
    field: Optional[str] = None
    implementer: Optional[str] = None
    contractor: Optional[str] = None
    contract_number: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = None
    description: Optional[str] = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    project_type: str
    organization_id: Optional[int]
    rail_route_id: Optional[int]
    field: Optional[str]
    implementer: str
    contractor: Optional[str]
    contract_number: Optional[str]
    start_date: Optional[date]
    end_date: Optional[date]
    status: str
    description: Optional[str]
    created_by: Optional[int]
    created_at: datetime
    # 집계 (선택적 — list 조회 시 포함)
    block_order_count: Optional[int] = None

    model_config = {"from_attributes": True}
