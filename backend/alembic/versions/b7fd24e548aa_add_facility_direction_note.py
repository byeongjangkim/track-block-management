"""add_facility_direction_note

Revision ID: b7fd24e548aa
Revises: d3e4f5a6b7c8
Create Date: 2026-04-11 15:46:25.123870

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7fd24e548aa'
down_revision: Union[str, Sequence[str], None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # facilities 테이블에 direction, note 컬럼 추가
    op.add_column('facilities', sa.Column('direction', sa.String(length=4), nullable=True))
    op.add_column('facilities', sa.Column('note', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('facilities', 'note')
    op.drop_column('facilities', 'direction')
