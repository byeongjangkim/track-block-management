"""add route_geometry table

Revision ID: b1c2d3e4f5a6
Revises: 28d00d81f482
Create Date: 2026-04-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, Sequence[str], None] = '6f948020eda6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'route_geometry',
        sa.Column('id',         sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('route_code', sa.String(),  nullable=False),
        sa.Column('lod',        sa.String(),  nullable=False),
        sa.Column('seq',        sa.Integer(), nullable=False),
        sa.Column('lat',        sa.Float(),   nullable=False),
        sa.Column('lon',        sa.Float(),   nullable=False),
        sa.Column('km',         sa.Float(),   nullable=True),
        sa.UniqueConstraint('route_code', 'lod', 'seq', name='uq_rg_route_lod_seq'),
    )
    op.create_index('idx_rg_route_lod', 'route_geometry', ['route_code', 'lod'])


def downgrade() -> None:
    op.drop_index('idx_rg_route_lod', table_name='route_geometry')
    op.drop_table('route_geometry')
