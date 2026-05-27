"""add facility management offices

Revision ID: s8t9u0v1w2x3
Revises: r7s8t9u0v1w2
Create Date: 2026-05-03
"""
from alembic import op
import sqlalchemy as sa


revision = "s8t9u0v1w2x3"
down_revision = "r7s8t9u0v1w2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rail_facility_management_offices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("region_name", sa.String(100), nullable=False),
        sa.Column("office_name", sa.String(100), nullable=False),
        sa.Column("office_type", sa.String(30), nullable=False, server_default="사업소"),
        sa.Column("field", sa.String(20), nullable=False, server_default="all"),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("source_row", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "organization_id",
            "office_name",
            "field",
            name="uq_rfmo_org_office_field",
        ),
    )
    op.create_index("idx_rfmo_org", "rail_facility_management_offices", ["organization_id"])
    op.create_index("idx_rfmo_region", "rail_facility_management_offices", ["region_name"])

    op.add_column("rail_facility_affiliations", sa.Column("management_office_id", sa.Integer(), nullable=True))
    op.create_index("idx_rfa_management_office", "rail_facility_affiliations", ["management_office_id"])


def downgrade():
    op.drop_index("idx_rfa_management_office", table_name="rail_facility_affiliations")
    op.drop_column("rail_facility_affiliations", "management_office_id")

    op.drop_index("idx_rfmo_region", table_name="rail_facility_management_offices")
    op.drop_index("idx_rfmo_org", table_name="rail_facility_management_offices")
    op.drop_table("rail_facility_management_offices")
