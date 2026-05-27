"""sigungu_geometry 테이블 삭제 — 정적 GeoJSON 파일로 대체

Revision ID: n3o4p5q6r7s8
Revises: m2n3o4p5q6r7
Create Date: 2026-04-27

변경 내용:
  - sigungu_geometry 테이블 삭제
  - 시도/시군구 경계는 maps/data/korea_map_level1.geojson, korea_map_level2.geojson 파일로 대체
"""
from alembic import op
import sqlalchemy as sa

revision = 'n3o4p5q6r7s8'
down_revision = 'm2n3o4p5q6r7'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table('sigungu_geometry')


def downgrade():
    op.create_table(
        'sigungu_geometry',
        sa.Column('id',          sa.Integer,     primary_key=True),
        sa.Column('sig_cd',      sa.String(10),  nullable=False),
        sa.Column('name',        sa.String(100), nullable=False),
        sa.Column('full_name',   sa.String(200)),
        sa.Column('admin_level', sa.Integer,     nullable=False),
        sa.Column('polygon_idx', sa.Integer,     nullable=False),
        sa.Column('ring_idx',    sa.Integer,     nullable=False),
        sa.Column('seq',         sa.Integer,     nullable=False),
        sa.Column('lon',         sa.Float,       nullable=False),
        sa.Column('lat',         sa.Float,       nullable=False),
    )
