"""block_order_km_nullable_section_note

Revision ID: 6285ade4c20e
Revises: a9b1c2d3e4f5
Create Date: 2026-04-17 11:45:35.408967

변경 내용:
  - block_orders.start_km / end_km → nullable (전차선 단전 등 km 없는 경우)
  - block_orders.section_note (VARCHAR 200) 컬럼 추가 (단전구간명)

SQLite는 ALTER COLUMN을 지원하지 않으므로
section_note 추가만 DDL로 처리하고,
nullable 변경은 SQLite에서 실제 강제되지 않으므로 스킵.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '6285ade4c20e'
down_revision: Union[str, Sequence[str], None] = 'a9b1c2d3e4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # section_note 컬럼 추가
    op.add_column('block_orders', sa.Column('section_note', sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column('block_orders', 'section_note')
