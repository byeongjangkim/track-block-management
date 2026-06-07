"""tc12: block_orders 시작역·종료역 컬럼 추가

- block_orders.start_station_name  — 차단구간 시작역/지점명 (예: "안양", "금천구청")
- block_orders.end_station_name    — 차단구간 종료역/지점명 (예: "의왕", "가산디지털단지")

  전차선 단전 구간명은 section_note(기존)에 "청도SP~밀양SS" 형식으로 유지.
  일반 선로차단의 역간 구간 정보는 이 두 컬럼에 분리 저장한다.

Revision ID: tc12_block_order_stations
Revises: tc11_block_order_documents
Create Date: 2026-06-07
"""

from alembic import op
import sqlalchemy as sa

revision = "tc12_block_order_stations"
down_revision = "tc11_block_order_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "block_orders",
        sa.Column("start_station_name", sa.String(100), nullable=True,
                  comment="차단구간 시작역/지점명"),
    )
    op.add_column(
        "block_orders",
        sa.Column("end_station_name", sa.String(100), nullable=True,
                  comment="차단구간 종료역/지점명"),
    )


def downgrade() -> None:
    op.drop_column("block_orders", "end_station_name")
    op.drop_column("block_orders", "start_station_name")
