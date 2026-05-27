"""sigungu_geometry: admin_level 제거, 순수 시군구 255개만 저장

Revision ID: l1m2n3o4p5q6
Revises: k0l1m2n3o4p5
Create Date: 2026-04-26

변경 내용:
  - admin_level 컬럼 제거 (dissolve로 생성하던 시도 경계 폐기)
  - 255개 시군구 직접 저장 방식으로 단순화
"""
from alembic import op
import sqlalchemy as sa

revision = 'l1m2n3o4p5q6'
down_revision = 'k0l1m2n3o4p5'
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
        sa.Column('polygon_idx', sa.Integer,      nullable=False),
        sa.Column('ring_idx',    sa.Integer,      nullable=False),
        sa.Column('seq',         sa.Integer,      nullable=False),
        sa.Column('lon',         sa.Float,        nullable=False),
        sa.Column('lat',         sa.Float,        nullable=False),
    )
    op.create_index('idx_sg_code',     'sigungu_geometry', ['sig_cd'])
    op.create_index('idx_sg_code_seq', 'sigungu_geometry', ['sig_cd', 'polygon_idx', 'ring_idx', 'seq'])


def downgrade() -> None:
    op.drop_index('idx_sg_code_seq', table_name='sigungu_geometry')
    op.drop_index('idx_sg_code',     table_name='sigungu_geometry')
    op.drop_table('sigungu_geometry')
