"""add_station_names_to_routes

Revision ID: g6h7i8j9k0l1
Revises: c4d5e6f7a8b9
Create Date: 2026-04-20 10:00:00.000000

변경 내용:
  - routes.start_station: 시점역명 추가 (nullable, 예: '부산진역')
  - routes.end_station:   종점역명 추가 (nullable, 예: '삼척역')

각 노선의 km 기준이 되는 시점역과 종점역을 명시적으로 저장한다.
같은 물리적 역이 여러 노선의 시점/종점이 될 수 있으며,
각 노선 기준 km=0.0인 역이 start_station이다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'g6h7i8j9k0l1'
down_revision: Union[str, Sequence[str], None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("routes") as batch_op:
        batch_op.add_column(sa.Column("start_station", sa.String(50), nullable=True))
        batch_op.add_column(sa.Column("end_station",   sa.String(50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("routes") as batch_op:
        batch_op.drop_column("end_station")
        batch_op.drop_column("start_station")
