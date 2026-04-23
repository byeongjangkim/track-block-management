from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    org_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # 'regional': 지역본부 (12개)
    # 'special' : 사업단 — 고속시설사업단, 고속전기사업단 (2개)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    users: Mapped[list["User"]] = relationship(back_populates="organization")
    route_ranges: Mapped[list["OrganizationRouteRange"]] = relationship(back_populates="organization")
    block_orders: Mapped[list["BlockOrder"]] = relationship(back_populates="organization")


class OrganizationRouteRange(Base):
    """조직별 노선 담당 구간 — 분야(field)별로 경계가 다를 수 있다."""

    __tablename__ = "organization_route_ranges"
    __table_args__ = (
        UniqueConstraint("organization_id", "route_id", "field", name="uq_org_route_field"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=False
    )
    route_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("routes.id"), nullable=False
    )
    field: Mapped[str] = mapped_column(String(20), nullable=False, default="all")
    # 'all'  : 본부 행정 경계 (모든 분야 포함) — 지역본부·사업단 superuser용
    # '시설'  : 시설 분야 담당 경계
    # '전기'  : 전기 분야 담당 경계
    # '건축'  : 건축 분야 담당 경계
    start_km: Mapped[float] = mapped_column(Float, nullable=False)
    end_km: Mapped[float] = mapped_column(Float, nullable=False)

    organization: Mapped["Organization"] = relationship(back_populates="route_ranges")
    route: Mapped["Route"] = relationship()
