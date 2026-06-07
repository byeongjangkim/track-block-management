from datetime import date, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Project(Base):
    """공사/사업 — 차단명령 복수 건의 상위 단위.

    - 철도공단 공사, 외부 공사: 계약 기반 공사 프로젝트
    - 철도공사 일상 유지보수: "시설 분야 시설물 유지보수" 등 상위 분류로 등록
    - 차단명령 승인문서의 '관련사업명' 파싱값과 매핑하여 자동 연결
    """

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)

    # 관할 조직 (nullable — 전사 공유 공사 가능)
    organization_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=True
    )
    # 노선 (nullable — 다노선 공사 또는 유지보수는 미지정)
    rail_route_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("rail_routes.id"), nullable=True
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)

    # 유형: 공사 | 유지보수 | 외부 | 기타
    project_type: Mapped[str] = mapped_column(String(20), nullable=False, default="공사")

    # 분야: 시설 | 전기 | 건축 | all
    field: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # 시행주체: 철도공사 | 철도공단 | 외부
    implementer: Mapped[str] = mapped_column(String(20), nullable=False, default="철도공사")

    contractor: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contract_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    start_date: Mapped[date | None] = mapped_column(nullable=True)
    end_date: Mapped[date | None] = mapped_column(nullable=True)

    # 상태: 계획 | 진행중 | 완료 | 중지
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="진행중")

    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # 역방향: 이 공사에 속한 차단명령 목록
    block_orders: Mapped[list["BlockOrder"]] = relationship(  # noqa: F821
        back_populates="project"
    )
