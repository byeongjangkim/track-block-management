from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class BlockOrderDocument(Base):
    __tablename__ = "block_order_documents"

    id:                Mapped[int]           = mapped_column(primary_key=True)
    doc_no:            Mapped[str | None]    = mapped_column(String(100), nullable=True)
    original_filename: Mapped[str]           = mapped_column(String(255), nullable=False)
    file_data:         Mapped[bytes]         = mapped_column(LargeBinary, nullable=False)
    file_size:         Mapped[int | None]    = mapped_column(Integer, nullable=True)
    content_type:      Mapped[str]           = mapped_column(String(50),
                                                              nullable=False,
                                                              default="application/pdf")
    uploaded_at:       Mapped[datetime]      = mapped_column(
                                                  DateTime(timezone=True),
                                                  server_default=func.now(),
                                                  nullable=False)
    uploaded_by:       Mapped[int | None]    = mapped_column(
                                                  ForeignKey("users.id", ondelete="SET NULL"),
                                                  nullable=True)
    note:              Mapped[str | None]    = mapped_column(Text, nullable=True)


class BlockOrderMonitor(Base):
    __tablename__ = "block_order_monitors"

    id:             Mapped[int]          = mapped_column(primary_key=True)
    block_order_id: Mapped[int]          = mapped_column(
                                              ForeignKey("block_orders.id", ondelete="CASCADE"),
                                              nullable=False)
    name:    Mapped[str]          = mapped_column(String(50), nullable=False)
    phone:   Mapped[str | None]   = mapped_column(String(20), nullable=True)
    company: Mapped[str | None]   = mapped_column(String(100), nullable=True)
