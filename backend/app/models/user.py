from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # 역할: 'system_superuser' | 'org_admin' | 'user'
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="user")

    # 담당 분야: None/'all' → 모든 분야, '시설'/'전기'/'건축' → 해당 분야만
    field: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # 소속 조직 — system_superuser는 NULL, org_admin/user는 반드시 설정
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=True
    )

    organization: Mapped["Organization | None"] = relationship(back_populates="users")
    block_orders: Mapped[list["BlockOrder"]] = relationship(back_populates="created_by_user")
