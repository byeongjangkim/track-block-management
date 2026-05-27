from sqlalchemy import Boolean, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

# type (대분류)
# 역       : 관리역·보통역·무인역·신호장·신호소  — station_type으로 세분류
# 변전소   : ss·sp·ssp·atp·pp               — station_type으로 세분류
# 구조물   : 터널·교량·과선교·건널목·분기      — station_type으로 세분류, km_end로 구간 표시
# 소속경계 : 지역본부·사업소                  — station_type으로 세분류

# station_type (소분류)
# 역 소분류   : 관리역 | 보통역 | 무인역 | 신호장 | 신호소
# 변전소 소분류: ss | sp | ssp | atp | pp
# 구조물 소분류: 터널 | 교량 | 과선교 | 건널목 | 분기
# 소속경계 소분류: 지역본부 | 사업소


class Facility(Base):
    __tablename__ = "facilities"

    id:              Mapped[int]        = mapped_column(primary_key=True)
    route_id:        Mapped[int]        = mapped_column(ForeignKey("routes.id"), nullable=False)
    type:            Mapped[str]        = mapped_column(String(20), nullable=False)
    name:            Mapped[str]        = mapped_column(String(100), nullable=False)
    km:              Mapped[float]      = mapped_column(Float, nullable=False)
    km_end:          Mapped[float|None] = mapped_column(Float, nullable=True)
    lat:             Mapped[float|None] = mapped_column(Float, nullable=True)
    lon:             Mapped[float|None] = mapped_column(Float, nullable=True)
    direction:       Mapped[str|None]   = mapped_column(String(4), nullable=True)
    has_station_map: Mapped[bool]       = mapped_column(Boolean, default=False, nullable=False)
    station_type:    Mapped[str|None]   = mapped_column(String(10), nullable=True)   # 관리역|보통역|신호장|신호소
    note:            Mapped[str|None]   = mapped_column(Text, nullable=True)

    route: Mapped["Route"] = relationship(back_populates="facilities")
