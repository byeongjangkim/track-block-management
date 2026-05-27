"""add rail facilities

Revision ID: r7s8t9u0v1w2
Revises: q6r7s8t9u0v1
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa


revision = "r7s8t9u0v1w2"
down_revision = "q6r7s8t9u0v1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rail_facilities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rail_route_id", sa.Integer(), sa.ForeignKey("rail_routes.id"), nullable=False),
        sa.Column("facility_code", sa.String(50), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("facility_type", sa.String(30), nullable=False),
        sa.Column("facility_subtype", sa.String(30), nullable=True),
        sa.Column("kp_start", sa.Float(), nullable=True),
        sa.Column("kp_end", sa.Float(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("lat_end", sa.Float(), nullable=True),
        sa.Column("lon_end", sa.Float(), nullable=True),
        sa.Column("direction", sa.String(10), nullable=True),
        sa.Column("nearest_station_id", sa.Integer(), sa.ForeignKey("rail_stations.id"), nullable=True),
        sa.Column("use_as_baseline_anchor", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("source_row", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_rf_route_kp", "rail_facilities", ["rail_route_id", "kp_start", "kp_end"])
    op.create_index("idx_rf_type", "rail_facilities", ["facility_type", "facility_subtype"])
    op.create_index("idx_rf_nearest_station", "rail_facilities", ["nearest_station_id"])

    op.create_table(
        "rail_facility_affiliations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rail_facility_id", sa.Integer(), sa.ForeignKey("rail_facilities.id"), nullable=False),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=True),
        sa.Column(
            "management_group_id",
            sa.Integer(),
            sa.ForeignKey("rail_station_management_groups.id"),
            nullable=True,
        ),
        sa.Column("manager_station_id", sa.Integer(), sa.ForeignKey("rail_stations.id"), nullable=True),
        sa.Column("affiliation_type", sa.String(30), nullable=False, server_default="관리"),
        sa.Column("field", sa.String(20), nullable=False, server_default="all"),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("source_row", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_rfa_facility", "rail_facility_affiliations", ["rail_facility_id"])
    op.create_index("idx_rfa_org", "rail_facility_affiliations", ["organization_id"])
    op.create_index("idx_rfa_group", "rail_facility_affiliations", ["management_group_id"])
    op.create_index("idx_rfa_manager_station", "rail_facility_affiliations", ["manager_station_id"])

    op.add_column("rail_baseline_points", sa.Column("rail_facility_id", sa.Integer(), nullable=True))
    op.create_index("idx_rbp_rail_facility", "rail_baseline_points", ["rail_facility_id"])


def downgrade():
    op.drop_index("idx_rbp_rail_facility", table_name="rail_baseline_points")
    op.drop_column("rail_baseline_points", "rail_facility_id")

    op.drop_index("idx_rfa_manager_station", table_name="rail_facility_affiliations")
    op.drop_index("idx_rfa_group", table_name="rail_facility_affiliations")
    op.drop_index("idx_rfa_org", table_name="rail_facility_affiliations")
    op.drop_index("idx_rfa_facility", table_name="rail_facility_affiliations")
    op.drop_table("rail_facility_affiliations")

    op.drop_index("idx_rf_nearest_station", table_name="rail_facilities")
    op.drop_index("idx_rf_type", table_name="rail_facilities")
    op.drop_index("idx_rf_route_kp", table_name="rail_facilities")
    op.drop_table("rail_facilities")
