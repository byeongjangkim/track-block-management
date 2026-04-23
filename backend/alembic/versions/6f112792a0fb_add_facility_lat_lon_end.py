"""add_facility_lat_lon_end

Revision ID: 6f112792a0fb
Revises: 88d9d28e77b6
Create Date: 2026-04-11 19:24:58.871927

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6f112792a0fb'
down_revision: Union[str, Sequence[str], None] = '88d9d28e77b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 종료 좌표 추가 (터널·교량·과선교의 종점 WGS84 좌표)
    op.add_column('facilities', sa.Column('lat_end', sa.Float(), nullable=True))
    op.add_column('facilities', sa.Column('lon_end', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('facilities', 'lon_end')
    op.drop_column('facilities', 'lat_end')
