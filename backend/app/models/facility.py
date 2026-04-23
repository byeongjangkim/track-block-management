from sqlalchemy import Boolean, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# 시설물 종류(type) 코드
# STATION         : 관리역 (지역본부·사업소의 관리 단위역)
# GENERAL_STATION : 일반역 (관리역 산하 소속역)
# TUNNEL          : 터널      (km ~ km_end 구간)
# BRIDGE          : 교량      (km ~ km_end 구간)
# OVERPASS        : 과선교    (km ~ km_end 구간)
# CROSSING        : 철도건널목
# SUBSTATION      : 철도변전소
# JUNCTION        : 분기점 (부본선·측선 시작/종료)
# 향후 추가 예정: SIGNAL_STATION(신호장), SIGNAL_BOX(신호소), UNMANNED(무인역)


class Facility(Base):
    __tablename__ = "facilities"

    id:              Mapped[int]        = mapped_column(primary_key=True)
    route_id:        Mapped[int]        = mapped_column(ForeignKey("routes.id"), nullable=False)
    type:            Mapped[str]        = mapped_column(String(20), nullable=False)
    name:            Mapped[str]        = mapped_column(String(100), nullable=False)
    km:              Mapped[float]      = mapped_column(Float, nullable=False)       # KORAIL 공식 시작 거리정
    km_end:          Mapped[float|None] = mapped_column(Float, nullable=True)        # 종료 거리정 (TUNNEL·BRIDGE·OVERPASS)
    lat:             Mapped[float|None] = mapped_column(Float, nullable=True)        # 시작 위도 (WGS84) — NULL이면 km 보간
    lon:             Mapped[float|None] = mapped_column(Float, nullable=True)        # 시작 경도 (WGS84) — NULL이면 km 보간
    direction:       Mapped[str|None]   = mapped_column(String(4), nullable=True)    # UP | DOWN | BOTH | NULL
    has_station_map: Mapped[bool]       = mapped_column(Boolean, default=False, nullable=False)
    note:            Mapped[str|None]   = mapped_column(Text, nullable=True)

    route: Mapped["Route"] = relationship(back_populates="facilities")
