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
    # parent_id는 이미 존재하는 경우 스킵 (이전 실패 시도에서 추가됨)
    import sqlalchemy as _sa
    from alembic import op as _op
    conn = _op.get_bind()
    cols = [row[1] for row in conn.execute(_sa.text("PRAGMA table_info(block_orders)")).fetchall()]
    if 'parent_id' not in cols:
        op.add_column('block_orders', sa.Column('parent_id', sa.Integer(), nullable=True))
    # 투입장비 명칭 (작업차량)
    op.add_column('block_orders',
        sa.Column('equipment_name', sa.String(100), nullable=True))
    # 열차서행
    op.add_column('block_orders',
        sa.Column('speed_restriction', sa.Integer(), nullable=True))       # km/h
    op.add_column('block_orders',
        sa.Column('speed_restriction_note', sa.String(200), nullable=True))


def downgrade():
    op.drop_column('block_orders', 'speed_restriction_note')
    op.drop_column('block_orders', 'speed_restriction')
    op.drop_column('block_orders', 'equipment_name')
    op.drop_column('block_orders', 'parent_id')
