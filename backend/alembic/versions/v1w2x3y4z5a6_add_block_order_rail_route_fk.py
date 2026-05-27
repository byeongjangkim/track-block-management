"""add block order rail route foreign key

Revision ID: v1w2x3y4z5a6
Revises: u0v1w2x3y4z5
Create Date: 2026-05-04
"""
from alembic import op


revision = "v1w2x3y4z5a6"
down_revision = "u0v1w2x3y4z5"
branch_labels = None
depends_on = None


def _has_rail_route_fk() -> bool:
    conn = op.get_bind()
    rows = conn.exec_driver_sql("PRAGMA foreign_key_list(block_orders)").fetchall()
    return any(row[2] == "rail_routes" and row[3] == "rail_route_id" for row in rows)


def upgrade():
    if _has_rail_route_fk():
        return
    with op.batch_alter_table("block_orders") as batch_op:
        batch_op.create_foreign_key(
            "fk_block_orders_rail_route_id",
            "rail_routes",
            ["rail_route_id"],
            ["id"],
        )


def downgrade():
    if not _has_rail_route_fk():
        return
    with op.batch_alter_table("block_orders") as batch_op:
        batch_op.drop_constraint("fk_block_orders_rail_route_id", type_="foreignkey")
