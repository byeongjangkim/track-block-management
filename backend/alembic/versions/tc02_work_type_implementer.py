"""block_orders: work_type, implementer 추가 + is_external 데이터 마이그레이션

- work_type VARCHAR(10) NULL : 인력 | 장비 | 기계
- implementer VARCHAR(20) NOT NULL DEFAULT '철도공사' : 철도공사 | 철도공단 | 외부
- 기존 is_external=True 데이터 → implementer='외부' 로 마이그레이션
- is_external 컬럼은 하위호환성을 위해 유지 (이후 Deprecated)

Revision ID: tc02_work_type_implementer
Revises: tc01_rail_track_sections
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = 'tc02_work_type_implementer'
down_revision = 'tc01_rail_track_sections'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 작업 형태: 인력 | 장비 | 기계
    op.add_column(
        'block_orders',
        sa.Column('work_type', sa.String(10), nullable=True),
    )
    # 시행 주체: 철도공사 | 철도공단 | 외부
    op.add_column(
        'block_orders',
        sa.Column('implementer', sa.String(20), nullable=False, server_default='철도공사'),
    )
    # 기존 is_external=True → implementer='외부' 마이그레이션
    op.execute("UPDATE block_orders SET implementer = '외부' WHERE is_external = 1")


def downgrade() -> None:
    op.drop_column('block_orders', 'implementer')
    op.drop_column('block_orders', 'work_type')
