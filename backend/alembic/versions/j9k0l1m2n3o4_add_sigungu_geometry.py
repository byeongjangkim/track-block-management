"""add sigungu_geometry table

Revision ID: j9k0l1m2n3o4
Revises: i8j9k0l1m2n3
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa

revision = 'j9k0l1m2n3o4'
down_revision = 'i8j9k0l1m2n3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'sigungu_geometry',
        sa.Column('id',          sa.Integer,     primary_key=True, autoincrement=True),
        sa.Column('sig_cd',      sa.String(10),  nullable=False),
        sa.Column('name',        sa.String(50),  nullable=False),
        sa.Column('full_name',   sa.String(100), nullable=False),
        sa.Column('lod',         sa.String(4),   nullable=False),
        sa.Column('polygon_idx', sa.Integer,     nullable=False, server_default='0'),
        sa.Column('ring_idx',    sa.Integer,     nullable=False, server_default='0'),
        sa.Column('seq',         sa.Integer,     nullable=False),
        sa.Column('lat',         sa.Float,       nullable=False),
        sa.Column('lon',         sa.Float,       nullable=False),
    )
    op.create_index('idx_sg_code_lod', 'sigungu_geometry', ['sig_cd', 'lod'])
    op.create_index('idx_sg_lod',      'sigungu_geometry', ['lod'])


def downgrade() -> None:
    op.drop_index('idx_sg_lod',      table_name='sigungu_geometry')
    op.drop_index('idx_sg_code_lod', table_name='sigungu_geometry')
    op.drop_table('sigungu_geometry')
