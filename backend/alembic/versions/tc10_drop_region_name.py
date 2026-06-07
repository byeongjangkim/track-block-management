"""tc10: rail_facility_management_offices.region_name 컬럼 제거

region_name은 organization_id(지역본부)와 동일한 의미의 중복 컬럼.

Revision ID: tc10_drop_region_name
Revises: v1_initial_schema
Create Date: 2026-06-06
"""

from alembic import op
import sqlalchemy as sa

revision = "tc10_drop_region_name"
down_revision = "v1_initial_schema"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("rail_facility_management_offices", "region_name")


def downgrade():
    op.add_column(
        "rail_facility_management_offices",
        sa.Column("region_name", sa.String(100), nullable=True),
    )
