"""redesign sigungu_geometry: lod → admin_level

Revision ID: k0l1m2n3o4p5
Revises: j9k0l1m2n3o4
Create Date: 2026-04-26

변경 내용:
  - lod(low/mid/high) 컬럼 제거
  - admin_level(1=시도, 2=시군, 3=구) 컬럼 추가
  - 인덱스 재구성
"""
from alembic import op
import sqlalchemy as sa

revision = 'k0l1m2n3o4p5'
down_revision = 'j9k0l1m2n3o4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index('idx_sg_lod',      table_name='sigungu_geometry')
    op.drop_index('idx_sg_code_lod', table_name='sigungu_geometry')
    op.drop_table('sigungu_geometry')

    op.create_table(
        'sigungu_geometry',
        sa.Column('id',          sa.Integer,     primary_key=True, autoincrement=True),
        sa.Column('sig_cd',      sa.String(10),  nullable=False),
        sa.Column('name',        sa.String(50),  nullable=False),
        sa.Column('full_name',   sa.String(100), nullable=False),
        sa.Column('admin_level', sa.Integer,     nullable=False),
        sa.Column('polygon_idx', sa.Integer,     nullable=False, server_default='0'),
        sa.Column('ring_idx',    sa.Integer,     nullable=False, server_default='0'),
        sa.Column('seq',         sa.Integer,     nullable=False),
        sa.Column('lon',         sa.Float,       nullable=False),
        sa.Column('lat',         sa.Float,       nullable=False),
    )
    op.create_index('idx_sg_level',      'sigungu_geometry', ['admin_level'])
    op.create_index('idx_sg_code_level', 'sigungu_geometry', ['sig_cd', 'admin_level'])


def downgrade() -> None:
    op.drop_index('idx_sg_code_level', table_name='sigungu_geometry')
    op.drop_index('idx_sg_level',      table_name='sigungu_geometry')
    op.drop_table('sigungu_geometry')

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
