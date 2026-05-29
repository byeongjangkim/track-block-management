"""add danger_level to block_orders

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-05-29

위험등급: A(위험) / B(주의) / C(일반) / NULL(미지정)
"""

from alembic import op
import sqlalchemy as sa

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("block_orders", sa.Column("danger_level", sa.String(10), nullable=True))


def downgrade() -> None:
    op.drop_column("block_orders", "danger_level")
