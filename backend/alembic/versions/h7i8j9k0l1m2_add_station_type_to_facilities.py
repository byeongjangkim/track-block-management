"""add_station_type_to_facilities

Revision ID: h7i8j9k0l1m2
Revises: g6h7i8j9k0l1
Create Date: 2026-04-24 00:00:00.000000

변경 내용:
  - facilities.station_type: 역 종류 추가 (nullable, 관리역|보통역|신호장|신호소)
    type='STATION'인 시설물에만 적용. 직제규정 [별표2] 기준.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'h7i8j9k0l1m2'
down_revision: Union[str, Sequence[str], None] = 'g6h7i8j9k0l1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("facilities") as batch_op:
        batch_op.add_column(sa.Column("station_type", sa.String(10), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("facilities") as batch_op:
        batch_op.drop_column("station_type")
