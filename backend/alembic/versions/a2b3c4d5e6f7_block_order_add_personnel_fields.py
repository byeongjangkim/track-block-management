"""block_order_add_personnel_fields

Revision ID: a2b3c4d5e6f7
Revises: 6285ade4c20e
Create Date: 2026-04-17 15:00:00.000000

변경 내용:
  - block_orders.doc_no (VARCHAR 30) 추가 — 문서번호
  - block_orders.reason (TEXT) 추가 — 사유/시행사항
  - block_orders.dept_head (VARCHAR 50) 추가 — 시행부서장
  - block_orders.electric_safety_manager (VARCHAR 50) 추가 — 전기철도안전관리자
  - block_orders.contractor (VARCHAR 100) 추가 — 시공사
  - block_orders.train_safety_coordinator 삭제 — 철도운행안전관리자(safety_manager)와 중복
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = '6285ade4c20e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('block_orders', sa.Column('doc_no', sa.String(length=30), nullable=True))
    op.add_column('block_orders', sa.Column('reason', sa.Text(), nullable=True))
    op.add_column('block_orders', sa.Column('dept_head', sa.String(length=50), nullable=True))
    op.add_column('block_orders', sa.Column('electric_safety_manager', sa.String(length=50), nullable=True))
    op.add_column('block_orders', sa.Column('contractor', sa.String(length=100), nullable=True))
    # train_safety_coordinator 삭제 (safety_manager = 철도운행안전관리자로 통일)
    op.drop_column('block_orders', 'train_safety_coordinator')


def downgrade() -> None:
    op.add_column('block_orders', sa.Column('train_safety_coordinator', sa.String(length=50), nullable=True))
    op.drop_column('block_orders', 'contractor')
    op.drop_column('block_orders', 'electric_safety_manager')
    op.drop_column('block_orders', 'dept_head')
    op.drop_column('block_orders', 'reason')
    op.drop_column('block_orders', 'doc_no')
