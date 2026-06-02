"""rail_track_sections: 노선 구간별 선로수·전차선 정보

rail_routes에 기본값 컬럼 2개 추가:
  - default_track_count : 노선 전체 기본 선로 수 (default=2, 복선)
  - default_has_catenary: 노선 전체 기본 전차선 유무 (default=1, 있음)

신규 테이블 rail_track_sections:
  특정 KP 구간에서 기본값과 다른 선로수·전차선 정보를 정의한다.
  조회 시 rail_track_sections를 먼저 확인하고, 해당 구간이 없으면 rail_routes 기본값 사용.

Revision ID: tc01_rail_track_sections
Revises: z5a6b7c8d9e0
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = 'tc01_rail_track_sections'
down_revision = 'b8c9d0e1f2a3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── rail_routes: 노선 전체 기본값 컬럼 추가 ──────────────────────────
    op.add_column(
        'rail_routes',
        sa.Column('default_track_count', sa.Integer(), nullable=False, server_default='2'),
    )
    op.add_column(
        'rail_routes',
        sa.Column('default_has_catenary', sa.Boolean(), nullable=False, server_default='1'),
    )

    # ── rail_track_sections: 구간별 선로수·전차선 예외 정의 ──────────────
    op.create_table(
        'rail_track_sections',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('rail_route_id', sa.Integer(),
                  sa.ForeignKey('rail_routes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('start_kp', sa.Float(), nullable=False),
        sa.Column('end_kp',   sa.Float(), nullable=False),
        # 선로 수: 1=단선 | 2=복선 | 4=복복선 | 6=삼복선
        sa.Column('track_count', sa.Integer(), nullable=False, server_default='2'),
        # 전차선 유무: 1=있음 | 0=없음(비전철)
        sa.Column('has_catenary', sa.Boolean(), nullable=False, server_default='1'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.current_timestamp()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.current_timestamp()),
    )
    op.create_index('ix_rail_track_sections_route', 'rail_track_sections', ['rail_route_id'])


def downgrade() -> None:
    op.drop_index('ix_rail_track_sections_route', 'rail_track_sections')
    op.drop_table('rail_track_sections')
    op.drop_column('rail_routes', 'default_has_catenary')
    op.drop_column('rail_routes', 'default_track_count')
