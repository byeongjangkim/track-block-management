from datetime import date, time

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class BlockOrder(Base):
    __tablename__ = "block_orders"

    id: Mapped[int] = mapped_column(primary_key=True)

    # 등록 조직
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id"), nullable=False
    )

    # 노선·위치
    route_id: Mapped[int | None] = mapped_column(ForeignKey("routes.id"), nullable=True)
    rail_route_id: Mapped[int | None] = mapped_column(ForeignKey("rail_routes.id"), nullable=True)
    # 차단 선로 목록 (JSON 배열 텍스트)
    # 복선(2):  ["상선"] | ["하선"] | ["상선","하선"]
    # 2복선(4): ["상1"] | ["상2"] | ["하1"] | ["하2"] | 조합
    # 3복선(6): ["상1"] | ["상2"] | ["상3"] | ["하1"] | ["하2"] | ["하3"] | 조합
    tracks: Mapped[str] = mapped_column(Text, nullable=False, default='["상선"]')
    # 철도 km과 KP는 같은 의미로 사용한다. start_km/end_km은 legacy 호환 컬럼이고,
    # 신규 렌더링/보간은 start_kp/end_kp를 기준으로 한다.
    start_km: Mapped[float | None] = mapped_column(Float, nullable=True)  # 전차선 단전 등 km 없는 경우 NULL
    end_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_kp: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_kp: Mapped[float | None] = mapped_column(Float, nullable=True)
    section_note: Mapped[str | None] = mapped_column(String(200))         # 단전구간명 등 (예: "청도SP~밀양SS")

    # 전차선 단전 변전소 FK — OLD facilities.id (레거시)
    start_facility_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("facilities.id"), nullable=True
    )
    end_facility_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("facilities.id"), nullable=True
    )
    # 전차선 단전 변전소 FK — NEW rail_facilities.id (KP 기반 GPS 사용)
    start_rail_facility_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("rail_facilities.id"), nullable=True
    )
    end_rail_facility_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("rail_facilities.id"), nullable=True
    )

    # 일시
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    # 분류
    field: Mapped[str] = mapped_column(String(30), nullable=False)       # 분야: '시설' | '전기' | '건축'
    block_type: Mapped[str] = mapped_column(String(30), nullable=False)  # 차단종류
    # 작업형태: '인력'(밀차 등 인력·공기구류) | '장비'(보선장비·전철장비 등 철도차량) | '기계'(건설기계관리법 상 건설기계)
    work_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    has_equipment: Mapped[bool] = mapped_column(Boolean, default=False)  # (레거시) 장비작업 여부
    has_labor: Mapped[bool] = mapped_column(Boolean, default=True)       # (레거시) 인력작업 여부
    # 시행주체: '철도공사' | '철도공단' | '외부'
    implementer: Mapped[str] = mapped_column(String(20), nullable=False, default='철도공사')
    is_external: Mapped[bool] = mapped_column(Boolean, default=False)    # (레거시) 외부 여부 — implementer='외부' 로 대체

    # 문서
    doc_no: Mapped[str | None] = mapped_column(String(30))         # 문서번호 (작업관리센터TF-XXXXXX)

    # 담당자 및 연락처
    dept_head: Mapped[str | None] = mapped_column(String(50))               # 시행부서장
    dept_head_phone: Mapped[str | None] = mapped_column(String(20))         # 시행부서장 연락처
    work_supervisor: Mapped[str] = mapped_column(String(50), nullable=False) # 작업책임자
    work_supervisor_phone: Mapped[str | None] = mapped_column(String(20))   # 작업책임자 연락처
    safety_manager: Mapped[str] = mapped_column(String(50), nullable=False)  # 철도운행안전관리자
    safety_manager_phone: Mapped[str | None] = mapped_column(String(20))    # 철도운행안전관리자 연락처
    electric_safety_manager: Mapped[str | None] = mapped_column(String(50))  # 전기철도안전관리자
    electric_safety_manager_phone: Mapped[str | None] = mapped_column(String(20))  # 전기철도안전관리자 연락처
    contractor: Mapped[str | None] = mapped_column(String(100))              # 시공사
    train_watcher: Mapped[str | None] = mapped_column(String(50))            # 열차감시원
    train_watcher_phone: Mapped[str | None] = mapped_column(String(20))     # 열차감시원 연락처

    # 작업 내용
    reason: Mapped[str | None] = mapped_column(Text)              # 사유/시행사항
    safety_items: Mapped[str | None] = mapped_column(Text)        # 안전관리항목 (줄바꿈 구분)
    document_path: Mapped[str | None] = mapped_column(String(255))  # PDF 상대경로

    # 기지 내 선로/구역 (기지 노선 작업 시 사용, 본선 작업 시 NULL)
    track_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 위험등급: 'A'(위험) / 'B'(주의) / 'C'(일반) / NULL(미지정)
    danger_level: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # 메타
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    organization: Mapped["Organization"] = relationship(back_populates="block_orders")
    route: Mapped["Route"] = relationship(back_populates="block_orders")
    rail_route: Mapped["RailRoute"] = relationship("RailRoute")
    created_by_user: Mapped["User"] = relationship(back_populates="block_orders")
