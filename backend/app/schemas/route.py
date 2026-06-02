from pydantic import BaseModel


class RouteResponse(BaseModel):
    id: int
    code: str
    name: str
    start_km: float
    end_km: float
    start_station: str | None = None   # 시점역명 (km=0.0 기준역)
    end_station: str | None = None     # 종점역명
    up_direction: str | None = None    # 상선 방향 표시 (예: "서울 방향")
    down_direction: str | None = None  # 하선 방향 표시 (예: "부산 방향")
    default_track_count: int = 2       # 선로 수: 1=단선, 2=복선, 4=2복선, 6=3복선

    model_config = {"from_attributes": True}
