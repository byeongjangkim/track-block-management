"""refine rail routes and facilities

Revision ID: t9u0v1w2x3y4
Revises: s8t9u0v1w2x3
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa


revision = "t9u0v1w2x3y4"
down_revision = "s8t9u0v1w2x3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("rail_routes", sa.Column("route_category", sa.String(50), nullable=True))
    op.add_column("rail_routes", sa.Column("start_lat", sa.Float(), nullable=True))
    op.add_column("rail_routes", sa.Column("start_lon", sa.Float(), nullable=True))
    op.add_column("rail_routes", sa.Column("end_lat", sa.Float(), nullable=True))
    op.add_column("rail_routes", sa.Column("end_lon", sa.Float(), nullable=True))
    op.add_column("rail_routes", sa.Column("length_kp", sa.Float(), nullable=True))
    op.add_column("rail_routes", sa.Column("calculation_basis", sa.String(255), nullable=True))
    op.add_column("rail_routes", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")))
    op.create_index("idx_rr_active", "rail_routes", ["is_active"])

    op.add_column(
        "rail_facilities",
        sa.Column("geometry_type", sa.String(20), nullable=False, server_default="point"),
    )
    op.add_column("rail_facilities", sa.Column("facility_detail_type", sa.String(30), nullable=True))
    op.add_column("rail_facilities", sa.Column("management_office_id", sa.Integer(), nullable=True))
    op.create_index("idx_rf_geometry_type", "rail_facilities", ["geometry_type"])
    op.create_index(
        "idx_rf_classification",
        "rail_facilities",
        ["facility_type", "facility_subtype", "facility_detail_type"],
    )
    op.create_index("idx_rf_management_office", "rail_facilities", ["management_office_id"])

    op.drop_index("idx_rfa_management_office", table_name="rail_facility_affiliations")
    op.drop_index("idx_rfa_manager_station", table_name="rail_facility_affiliations")
    op.drop_index("idx_rfa_group", table_name="rail_facility_affiliations")
    op.drop_index("idx_rfa_org", table_name="rail_facility_affiliations")
    op.drop_index("idx_rfa_facility", table_name="rail_facility_affiliations")
    op.drop_table("rail_facility_affiliations")


def downgrade():
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
        sa.Column("management_office_id", sa.Integer(), nullable=True),
    )
    op.create_index("idx_rfa_facility", "rail_facility_affiliations", ["rail_facility_id"])
    op.create_index("idx_rfa_org", "rail_facility_affiliations", ["organization_id"])
    op.create_index("idx_rfa_group", "rail_facility_affiliations", ["management_group_id"])
    op.create_index("idx_rfa_manager_station", "rail_facility_affiliations", ["manager_station_id"])
    op.create_index("idx_rfa_management_office", "rail_facility_affiliations", ["management_office_id"])

    op.drop_index("idx_rf_management_office", table_name="rail_facilities")
    op.drop_index("idx_rf_classification", table_name="rail_facilities")
    op.drop_index("idx_rf_geometry_type", table_name="rail_facilities")
    op.drop_column("rail_facilities", "management_office_id")
    op.drop_column("rail_facilities", "facility_detail_type")
    op.drop_column("rail_facilities", "geometry_type")

    op.drop_index("idx_rr_active", table_name="rail_routes")
    op.drop_column("rail_routes", "is_active")
    op.drop_column("rail_routes", "calculation_basis")
    op.drop_column("rail_routes", "length_kp")
    op.drop_column("rail_routes", "end_lon")
    op.drop_column("rail_routes", "end_lat")
    op.drop_column("rail_routes", "start_lon")
    op.drop_column("rail_routes", "start_lat")
    op.drop_column("rail_routes", "route_category")
