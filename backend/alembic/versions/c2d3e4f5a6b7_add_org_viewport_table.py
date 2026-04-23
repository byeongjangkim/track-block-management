"""add org_viewport table

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-04-07

"""
from alembic import op
import sqlalchemy as sa

revision = 'c2d3e4f5a6b7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'org_viewport',
        sa.Column('id',              sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('center_lat',      sa.Float(),   nullable=False),
        sa.Column('center_lon',      sa.Float(),   nullable=False),
        sa.Column('zoom_level',      sa.Float(),   nullable=False, server_default='5.0'),
        sa.UniqueConstraint('organization_id', name='uq_org_viewport_org'),
    )


def downgrade() -> None:
    op.drop_table('org_viewport')
