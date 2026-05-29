"""add rail_facility FK to block_orders

Revision ID: a7b8c9d0e1f2
Revises: c3d4e5f6a7b8
Create Date: 2026-05-29
"""

from alembic import op
import sqlalchemy as sa

revision = "a7b8c9d0e1f2"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("block_orders", sa.Column("start_rail_facility_id", sa.Integer(), nullable=True))
    op.add_column("block_orders", sa.Column("end_rail_facility_id", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("block_orders", "end_rail_facility_id")
    op.drop_column("block_orders", "start_rail_facility_id")
