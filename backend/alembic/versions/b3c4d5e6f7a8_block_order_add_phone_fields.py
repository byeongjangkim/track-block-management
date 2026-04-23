"""block_order_add_phone_fields

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-04-17 16:00:00.000000

변경 내용:
  - block_orders.dept_head_phone (VARCHAR 20) 추가 — 시행부서장 연락처
  - block_orders.work_supervisor_phone (VARCHAR 20) 추가 — 작업책임자 연락처
  - block_orders.safety_manager_phone (VARCHAR 20) 추가 — 철도운행안전관리자 연락처
  - block_orders.electric_safety_manager_phone (VARCHAR 20) 추가 — 전기철도안전관리자 연락처
  - block_orders.train_watcher_phone (VARCHAR 20) 추가 — 열차감시원 연락처
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('block_orders', sa.Column('dept_head_phone', sa.String(length=20), nullable=True))
    op.add_column('block_orders', sa.Column('work_supervisor_phone', sa.String(length=20), nullable=True))
    op.add_column('block_orders', sa.Column('safety_manager_phone', sa.String(length=20), nullable=True))
    op.add_column('block_orders', sa.Column('electric_safety_manager_phone', sa.String(length=20), nullable=True))
    op.add_column('block_orders', sa.Column('train_watcher_phone', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('block_orders', 'train_watcher_phone')
    op.drop_column('block_orders', 'electric_safety_manager_phone')
    op.drop_column('block_orders', 'safety_manager_phone')
    op.drop_column('block_orders', 'work_supervisor_phone')
    op.drop_column('block_orders', 'dept_head_phone')
