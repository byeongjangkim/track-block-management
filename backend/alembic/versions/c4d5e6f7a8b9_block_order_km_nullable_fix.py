"""block_order_km_nullable_fix

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-04-18 10:00:00.000000

변경 내용:
  - block_orders.start_km → nullable (전차선 단전 케이스: km 없음)
  - block_orders.end_km   → nullable (전차선 단전 케이스: km 없음)

SQLite는 ALTER COLUMN을 직접 지원하지 않으므로
Alembic batch_alter_table 모드(테이블 재생성)를 사용한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('block_orders', schema=None) as batch_op:
        batch_op.alter_column(
            'start_km',
            existing_type=sa.Float(),
            nullable=True,
        )
        batch_op.alter_column(
            'end_km',
            existing_type=sa.Float(),
            nullable=True,
        )


def downgrade() -> None:
    # NULL 값이 존재하면 downgrade 불가 — 사전에 NULL 제거 필요
    with op.batch_alter_table('block_orders', schema=None) as batch_op:
        batch_op.alter_column(
            'start_km',
            existing_type=sa.Float(),
            nullable=False,
        )
        batch_op.alter_column(
            'end_km',
            existing_type=sa.Float(),
            nullable=False,
        )
