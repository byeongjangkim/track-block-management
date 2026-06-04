"""tc09: block_orders — 대표명령 계층 구조 (parent_id) + 고속선 관련 필드

- parent_id: 대표명령 자기참조 FK (NULL = 대표명령, NOT NULL = 하위작업)
- equipment_name: 투입장비(작업차량) 명칭
- speed_restriction: 열차서행 제한속도(km/h)
- speed_restriction_note: 열차서행 구간/비고

Revision ID: tc09_block_order_parent
Revises: tc08_block_order_protection_fields
Create Date: 2026-06-04
"""

revision = 'tc09_block_order_parent'
down_revision = 'tc08_block_order_protection_fields'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing = {c['name'] for c in inspector.get_columns('block_orders')}

    # parent_id는 SQLite에서 이전 실패 시도로 이미 추가됐을 수 있으므로 존재 확인 후 추가
    if 'parent_id' not in existing:
        op.add_column('block_orders', sa.Column('parent_id', sa.Integer(), nullable=True))
    if 'equipment_name' not in existing:
        op.add_column('block_orders',
            sa.Column('equipment_name', sa.String(100), nullable=True))
    if 'speed_restriction' not in existing:
        op.add_column('block_orders',
            sa.Column('speed_restriction', sa.Integer(), nullable=True))
    if 'speed_restriction_note' not in existing:
        op.add_column('block_orders',
            sa.Column('speed_restriction_note', sa.String(200), nullable=True))


def downgrade():
    op.drop_column('block_orders', 'speed_restriction_note')
    op.drop_column('block_orders', 'speed_restriction')
    op.drop_column('block_orders', 'equipment_name')
    op.drop_column('block_orders', 'parent_id')
