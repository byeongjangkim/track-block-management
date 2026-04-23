from pydantic import BaseModel, field_validator

VALID_TYPES = {"STATION", "TUNNEL", "BRIDGE", "OVERPASS", "CROSSING", "SUBSTATION", "JUNCTION"}
VALID_DIRECTIONS = {"UP", "DOWN", "BOTH"}


class FacilityCreate(BaseModel):
    type: str
    name: str
    km: float
    km_end: float | None = None          # 종료 거리정 (TUNNEL·BRIDGE·OVERPASS)
    lat: float | None = None             # 시작 위도 (NULL이면 route_geometry km 보간)
    lon: float | None = None             # 시작 경도
    direction: str | None = None         # UP | DOWN | BOTH | None
    has_station_map: bool = False
    note: str | None = None

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_TYPES:
            raise ValueError(f"type은 {VALID_TYPES} 중 하나여야 합니다")
        return v

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_DIRECTIONS:
            raise ValueError(f"direction은 {VALID_DIRECTIONS} 중 하나 또는 빈값이어야 합니다")
        return v


class FacilityUpdate(BaseModel):
    type: str | None = None
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
            raise ValueError(f"type은 {VALID_TYPES} 중 하나여야 합니다")
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
    name: str
    km: float
    km_end: float | None
    lat: float | None
    lon: float | None
    direction: str | None
    has_station_map: bool
    note: str | None

    model_config = {"from_attributes": True}
