"""sigungu_geometry: admin_level 재추가 (1=시도, 2=시군구)

Revision ID: m2n3o4p5q6r7
Revises: l1m2n3o4p5q6
Create Date: 2026-04-26

변경 내용:
  - admin_level 컬럼 재추가 (1=시도 17개, 2=시군구 255개)
  - 시도(level1)는 dissolve 외부 링만 저장하여 ring 아티팩트 방지
"""
from alembic import op
import sqlalchemy as sa

revision = 'm2n3o4p5q6r7'
down_revision = 'l1m2n3o4p5q6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table('sigungu_geometry')

    op.create_table(
        'sigungu_geometry',
        sa.Column('id',          sa.Integer,      primary_key=True, autoincrement=True),
        sa.Column('sig_cd',      sa.String(10),   nullable=False),
        sa.Column('name',        sa.String(50),   nullable=False),
        sa.Column('full_name',   sa.String(100),  nullable=False),
        sa.Column('admin_level', sa.Integer,      nullable=False),
        sa.Column('polygon_idx', sa.Integer,      nullable=False),
        sa.Column('ring_idx',    sa.Integer,      nullable=False),
        sa.Column('seq',         sa.Integer,      nullable=False),
        sa.Column('lon',         sa.Float,        nullable=False),
        sa.Column('lat',         sa.Float,        nullable=False),
    )
    op.create_index('idx_sg_level',        'sigungu_geometry', ['admin_level'])
    op.create_index('idx_sg_code',         'sigungu_geometry', ['sig_cd'])
    op.create_index('idx_sg_level_code',   'sigungu_geometry', ['admin_level', 'sig_cd'])
    op.create_index('idx_sg_code_seq',     'sigungu_geometry', ['sig_cd', 'polygon_idx', 'ring_idx', 'seq'])


def downgrade() -> None:
    op.drop_index('idx_sg_code_seq',   table_name='sigungu_geometry')
    op.drop_index('idx_sg_level_code', table_name='sigungu_geometry')
    op.drop_index('idx_sg_code',       table_name='sigungu_geometry')
    op.drop_index('idx_sg_level',      table_name='sigungu_geometry')
    op.drop_table('sigungu_geometry')
