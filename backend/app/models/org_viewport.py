from sqlalchemy import Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OrgViewport(Base):
    __tablename__ = "org_viewport"

    id:              Mapped[int]   = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[int]   = mapped_column(Integer, ForeignKey("organizations.id"), nullable=False)
    center_lat:      Mapped[float] = mapped_column(Float, nullable=False)
    center_lon:      Mapped[float] = mapped_column(Float, nullable=False)
    zoom_level:      Mapped[float] = mapped_column(Float, nullable=False, default=5.0)

    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_org_viewport_org"),
    )
