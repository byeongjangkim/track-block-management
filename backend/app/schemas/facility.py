from pydantic import BaseModel, field_validator

# 대분류
VALID_TYPES = {"역", "변전소", "구조물", "소속경계"}

# 소분류 (station_type)
VALID_SUBTYPES = {
    "역":       {"관리역", "보통역", "무인역", "신호장", "신호소"},
    "변전소":   {"ss", "sp", "ssp", "atp", "pp"},
    "구조물":   {"터널", "교량", "과선교", "건널목", "분기"},
    "소속경계": {"지역본부", "사업소"},
}

VALID_DIRECTIONS = {"UP", "DOWN", "BOTH"}


class FacilityCreate(BaseModel):
    type: str
    station_type: str | None = None   # 소분류
    name: str
    km: float
    km_end: float | None = None       # 종료 거리정 (구조물 구간)
    lat: float | None = None
    lon: float | None = None
    direction: str | None = None      # UP | DOWN | BOTH | None
    has_station_map: bool = False
    note: str | None = None

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_TYPES:
            raise ValueError(f"type은 {sorted(VALID_TYPES)} 중 하나여야 합니다")
        return v

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_DIRECTIONS:
            raise ValueError(f"direction은 {VALID_DIRECTIONS} 중 하나 또는 빈값이어야 합니다")
        return v


class FacilityUpdate(BaseModel):
    type: str | None = None
    station_type: str | None = None
    name: str | None = None
    km: float | None = None
    km_end: float | None = None
    lat: float | None = None
    lon: float | None = None
    direction: str | None = None
    has_station_map: bool | None = None
    note: str | None = None

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_TYPES:
            raise ValueError(f"type은 {sorted(VALID_TYPES)} 중 하나여야 합니다")
        return v

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_DIRECTIONS:
            raise ValueError(f"direction은 {VALID_DIRECTIONS} 중 하나 또는 빈값이어야 합니다")
        return v


class FacilityResponse(BaseModel):
    id: int
    route_id: int
    type: str
    station_type: str | None
    name: str
    km: float
    km_end: float | None
    lat: float | None
    lon: float | None
    direction: str | None
    has_station_map: bool
    note: str | None

    model_config = {"from_attributes": True}
