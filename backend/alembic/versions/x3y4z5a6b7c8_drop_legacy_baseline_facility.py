"""drop legacy baseline facility reference

Revision ID: x3y4z5a6b7c8
Revises: w2x3y4z5a6b7
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa


revision = "x3y4z5a6b7c8"
down_revision = "w2x3y4z5a6b7"
branch_labels = None
depends_on = None


def _has_rail_facility_fk() -> bool:
    conn = op.get_bind()
    rows = conn.exec_driver_sql("PRAGMA foreign_key_list(rail_baseline_points)").fetchall()
    return any(row[2] == "rail_facilities" and row[3] == "rail_facility_id" for row in rows)


def upgrade():
    op.drop_index("idx_rbp_facility", table_name="rail_baseline_points")
    with op.batch_alter_table("rail_baseline_points", recreate="always") as batch_op:
        batch_op.drop_column("facility_id")
        if not _has_rail_facility_fk():
            batch_op.create_foreign_key(
                "fk_rail_baseline_points_rail_facility_id",
                "rail_facilities",
                ["rail_facility_id"],
                ["id"],
            )


def downgrade():
    with op.batch_alter_table("rail_baseline_points", recreate="always") as batch_op:
        if _has_rail_facility_fk():
            batch_op.drop_constraint(
                "fk_rail_baseline_points_rail_facility_id",
                type_="foreignkey",
            )
        batch_op.add_column(sa.Column("facility_id", sa.Integer(), nullable=True))
    op.create_index("idx_rbp_facility", "rail_baseline_points", ["facility_id"])
