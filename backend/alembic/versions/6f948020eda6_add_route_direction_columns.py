"""add route direction columns

Revision ID: 6f948020eda6
Revises: a1b2c3d4e5f6
Create Date: 2026-04-04 14:46:34.067902

SQLite 제약:
  - ALTER COLUMN, CREATE/DROP FOREIGN KEY 미지원 → 생략
  - 컬럼 추가(add_column)만 수행
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '6f948020eda6'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('routes', sa.Column('up_direction',   sa.String(50), nullable=True))
    op.add_column('routes', sa.Column('down_direction', sa.String(50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('routes') as batch_op:
        batch_op.drop_column('down_direction')
        batch_op.drop_column('up_direction')
