"""rail_facilities: bore_type 추가 (터널·교량 선로 적용 방식)

bore_type VARCHAR(20) DEFAULT '복선':
  '복선'     : 상·하선 모두 한 구조물에 포함 (기본값 — 대부분의 터널·교량)
  '단선_상선': 상선(UP) 전용 단선 터널/교량
  '단선_하선': 하선(DOWN) 전용 단선 터널/교량

지도 렌더링:
  '복선'     → 양쪽 선로를 감싸는 하나의 윤곽선 박스/브래킷
  '단선_상선' → 상선 위치에만 개별 박스/브래킷
  '단선_하선' → 하선 위치에만 개별 박스/브래킷

Revision ID: tc03_bore_type
Revises: tc02_work_type_implementer
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = 'tc03_bore_type'
down_revision = 'tc02_work_type_implementer'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'rail_facilities',
        sa.Column('bore_type', sa.String(20), nullable=False, server_default='복선'),
    )


def downgrade() -> None:
    op.drop_column('rail_facilities', 'bore_type')
