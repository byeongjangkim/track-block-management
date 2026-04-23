"""add organizations and role system

Revision ID: a1b2c3d4e5f6
Revises: 28d00d81f482
Create Date: 2026-04-04 12:00:00.000000

변경 내용:
  - organizations 테이블 신규 생성
  - organization_route_ranges 테이블 신규 생성
  - users: is_admin 제거, role/field/organization_id 추가
  - block_orders: organization_id 추가
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "28d00d81f482"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. organizations 테이블 ──────────────────────────────────────────
    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(30), unique=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("org_type", sa.String(20), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
    )

    # ── 2. organization_route_ranges 테이블 ──────────────────────────────
    op.create_table(
        "organization_route_ranges",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("route_id", sa.Integer(), sa.ForeignKey("routes.id"), nullable=False),
        sa.Column("field", sa.String(20), nullable=False, server_default="all"),
        sa.Column("start_km", sa.Float(), nullable=False),
        sa.Column("end_km", sa.Float(), nullable=False),
        sa.UniqueConstraint("organization_id", "route_id", "field", name="uq_org_route_field"),
    )

    # ── 3. users 테이블 변경 ─────────────────────────────────────────────
    # SQLite batch 모드: FK는 Integer 컬럼으로만 추가 (SQLite는 FK 강제 미적용)
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column("role", sa.String(30), nullable=False, server_default="user")
        )
        batch_op.add_column(
            sa.Column("field", sa.String(20), nullable=True)
        )
        batch_op.add_column(
            sa.Column("organization_id", sa.Integer(), nullable=True)
        )
        batch_op.drop_column("is_admin")

    # ── 4. block_orders 테이블 변경 ──────────────────────────────────────
    with op.batch_alter_table("block_orders") as batch_op:
        batch_op.add_column(
            sa.Column("organization_id", sa.Integer(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("block_orders") as batch_op:
        batch_op.drop_column("organization_id")

    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="0")
        )
        batch_op.drop_column("organization_id")
        batch_op.drop_column("field")
        batch_op.drop_column("role")

    op.drop_table("organization_route_ranges")
    op.drop_table("organizations")
