from sqlalchemy import Float, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RouteGeometry(Base):
    __tablename__ = "route_geometry"

    id:         Mapped[int]           = mapped_column(Integer, primary_key=True, autoincrement=True)
    route_code: Mapped[str]           = mapped_column(String, nullable=False)
    source:     Mapped[str]           = mapped_column(String, nullable=False, default="shp")  # 'shp' | 'user'
    lod:        Mapped[str]           = mapped_column(String, nullable=False)   # 'high' | 'mid' | 'low'
    segment:    Mapped[int]           = mapped_column(Integer, nullable=False, default=0)  # 연결된 구간 번호
    seq:        Mapped[int]           = mapped_column(Integer, nullable=False)
    lat:        Mapped[float]         = mapped_column(Float, nullable=False)
    lon:        Mapped[float]         = mapped_column(Float, nullable=False)
    km:         Mapped[float | None]  = mapped_column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("route_code", "source", "lod", "segment", "seq", name="uq_rg_route_source_lod_seg_seq"),
        Index("idx_rg_route_lod", "route_code", "lod"),
        Index("idx_rg_route_source", "route_code", "source"),
    )
