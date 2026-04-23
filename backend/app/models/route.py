from sqlalchemy import Float, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Route(Base):
    __tablename__ = "routes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)   # e.g. "gyeongbu"
    name: Mapped[str] = mapped_column(String(50), nullable=False)                 # e.g. "경부선"
    start_km: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    end_km: Mapped[float] = mapped_column(Float, nullable=False)
    up_direction: Mapped[str | None] = mapped_column(String(50), nullable=True)    # e.g. "서울 방향"
    down_direction: Mapped[str | None] = mapped_column(String(50), nullable=True)  # e.g. "부산 방향"
    start_station: Mapped[str | None] = mapped_column(String(50), nullable=True)   # 시점역명 e.g. "부산진역" (km=0.0 기준역)
    end_station: Mapped[str | None] = mapped_column(String(50), nullable=True)     # 종점역명 e.g. "삼척역"

    facilities: Mapped[list["Facility"]] = relationship(back_populates="route")
    block_orders: Mapped[list["BlockOrder"]] = relationship(back_populates="route")
