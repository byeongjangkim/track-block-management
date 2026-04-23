"""add_facility_boundary

Revision ID: 88d9d28e77b6
Revises: b7fd24e548aa
Create Date: 2026-04-11 18:17:50.895084

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '88d9d28e77b6'
down_revision: Union[str, Sequence[str], None] = 'b7fd24e548aa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # facilities.boundary: 소속경계 구분 (본부/시설/전기/건축) — NULL = 경계 아님
    op.add_column('facilities', sa.Column('boundary', sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column('facilities', 'boundary')
