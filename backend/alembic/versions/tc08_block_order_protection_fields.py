"""tc08: block_orders — 전차선 보호장치·관제사/작업자 보호조치·작업자 수 필드 추가

추가 컬럼:
  catenary_protection  VARCHAR(20)  — 전차선 보호장치 (양단접지/단접지 등)
  zep                  VARCHAR(30)  — 관제사 보호조치 ZEP 코드 (고속선)
  zcp                  VARCHAR(30)  — 관제사 보호조치 ZCP 코드 (고속선)
  cpt                  VARCHAR(30)  — 작업자 보호조치 CPT 코드 (고속선)
  tzep                 VARCHAR(30)  — 작업자 보호조치 TZEP 코드 (고속선)
  worker_count         INTEGER      — 작업자 수

Revision ID: tc08_block_order_protection_fields
Revises: tc07_org_sort_order
Create Date: 2026-06-04
"""

revision = 'tc08_block_order_protection_fields'
down_revision = 'tc07_org_sort_order'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    op.add_column('block_orders', sa.Column('catenary_protection', sa.String(20), nullable=True))
    op.add_column('block_orders', sa.Column('zep',  sa.String(30), nullable=True))
    op.add_column('block_orders', sa.Column('zcp',  sa.String(30), nullable=True))
    op.add_column('block_orders', sa.Column('cpt',  sa.String(30), nullable=True))
    op.add_column('block_orders', sa.Column('tzep', sa.String(30), nullable=True))
    op.add_column('block_orders', sa.Column('worker_count', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('block_orders', 'worker_count')
    op.drop_column('block_orders', 'tzep')
    op.drop_column('block_orders', 'cpt')
    op.drop_column('block_orders', 'zcp')
    op.drop_column('block_orders', 'zep')
    op.drop_column('block_orders', 'catenary_protection')
