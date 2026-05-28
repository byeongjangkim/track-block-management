"""add track_name to block_orders

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-05-28

기지(차량기지·보수기지) 내 선로번호/구역명 저장 컬럼.
  track_name TEXT  — 예: "유치선1", "검수선A", "전체"
  본선 작업 시 NULL.
"""
import sqlalchemy as sa
from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("block_orders", sa.Column("track_name", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("block_orders", "track_name")
