"""add facility classifications and region boundaries

Revision ID: w2x3y4z5a6b7
Revises: v1w2x3y4z5a6
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa


revision = "w2x3y4z5a6b7"
down_revision = "v1w2x3y4z5a6"
branch_labels = None
depends_on = None


FACILITY_CLASSIFICATIONS = [
    ("STRUCTURE_BRIDGE", "구조물", "교량", None, "linear", 10),
    ("STRUCTURE_TUNNEL", "구조물", "터널", None, "linear", 20),
    ("STRUCTURE_OVERPASS", "구조물", "과선교", None, "point", 30),
    ("STRUCTURE_OTHER", "구조물", "기타", None, "point", 40),
    ("TRACK_GATE_UP", "선로 출입문", "상선 방향 출입문", None, "point", 110),
    ("TRACK_GATE_DOWN", "선로 출입문", "하선 방향 출입문", None, "point", 120),
    ("CROSSING_STAFFED_CLASS1", "철도건널목", "유인건널목", "1종", "point", 210),
    ("CROSSING_STAFFED_CLASS2", "철도건널목", "유인건널목", "2종", "point", 220),
    ("CROSSING_STAFFED_CLASS3", "철도건널목", "유인건널목", "3종", "point", 230),
    ("CROSSING_UNSTAFFED_CLASS1", "철도건널목", "무인건널목", "1종", "point", 240),
    ("CROSSING_UNSTAFFED_CLASS2", "철도건널목", "무인건널목", "2종", "point", 250),
    ("CROSSING_UNSTAFFED_CLASS3", "철도건널목", "무인건널목", "3종", "point", 260),
    ("SUBSTATION_SS", "철도변전소", "변전소(SS)", None, "point", 310),
    ("SECTIONING_POST_SP", "철도변전소", "구분소(SP)", None, "point", 320),
    ("SUB_SECTIONING_POST_SSP", "철도변전소", "보조구분소(SSP)", None, "point", 330),
    ("PARALLEL_POST_PP", "철도변전소", "병렬급전구분소(PP)", None, "point", 340),
    ("ATP", "철도변전소", "ATP", None, "point", 350),
]


def upgrade():
    op.create_table(
        "rail_facility_classifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("major_category", sa.String(30), nullable=False),
        sa.Column("sub_category", sa.String(50), nullable=False),
        sa.Column("detail_category", sa.String(30), nullable=True),
        sa.Column("geometry_type", sa.String(20), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("code", name="uq_rfc_code"),
        sa.UniqueConstraint(
            "major_category",
            "sub_category",
            "detail_category",
            name="uq_rfc_categories",
        ),
    )
    op.create_index("idx_rfc_categories", "rail_facility_classifications", ["major_category", "sub_category"])

    classification_table = sa.table(
        "rail_facility_classifications",
        sa.column("code", sa.String),
        sa.column("major_category", sa.String),
        sa.column("sub_category", sa.String),
        sa.column("detail_category", sa.String),
        sa.column("geometry_type", sa.String),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        classification_table,
        [
            {
                "code": code,
                "major_category": major,
                "sub_category": sub,
                "detail_category": detail,
                "geometry_type": geometry,
                "sort_order": sort_order,
            }
            for code, major, sub, detail, geometry, sort_order in FACILITY_CLASSIFICATIONS
        ],
    )

    # 신규 시설물 데이터는 아직 없다는 전제의 최종 구조 정리.
    # 분류 문자열 중복 저장을 제거하고 classification_id만 FK로 보관한다.
    op.execute("DELETE FROM rail_facilities")
    op.drop_index("idx_rf_type", table_name="rail_facilities")
    op.drop_index("idx_rf_geometry_type", table_name="rail_facilities")
    op.drop_index("idx_rf_classification", table_name="rail_facilities")
    with op.batch_alter_table("rail_facilities", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("classification_id", sa.Integer(), nullable=False))
        batch_op.create_foreign_key(
            "fk_rail_facilities_classification",
            "rail_facility_classifications",
            ["classification_id"],
            ["id"],
        )
        batch_op.drop_column("facility_type")
        batch_op.drop_column("facility_subtype")
        batch_op.drop_column("facility_detail_type")
        batch_op.drop_column("geometry_type")
    op.create_index("idx_rf_classification_id", "rail_facilities", ["classification_id"])

    op.create_table(
        "rail_route_region_boundaries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("rail_route_id", sa.Integer(), sa.ForeignKey("rail_routes.id"), nullable=False),
        sa.Column("region_name", sa.String(100), nullable=False),
        sa.Column("boundary_type", sa.String(30), nullable=False, server_default="지역본부"),
        sa.Column("start_kp", sa.Float(), nullable=False),
        sa.Column("end_kp", sa.Float(), nullable=False),
        sa.Column("source_type", sa.String(50), nullable=True),
        sa.Column("source_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "organization_id",
            "rail_route_id",
            "boundary_type",
            "start_kp",
            "end_kp",
            name="uq_rrrb_org_route_range",
        ),
    )
    op.create_index(
        "idx_rrrb_route_kp",
        "rail_route_region_boundaries",
        ["rail_route_id", "start_kp", "end_kp"],
    )
    op.create_index("idx_rrrb_org", "rail_route_region_boundaries", ["organization_id"])

    op.execute(
        """
        INSERT OR IGNORE INTO rail_route_region_boundaries (
            organization_id,
            rail_route_id,
            region_name,
            boundary_type,
            start_kp,
            end_kp,
            source_type,
            source_id,
            note
        )
        SELECT
            o.id,
            rr.id,
            o.name,
            '지역본부',
            orr.start_km,
            orr.end_km,
            'organization_route_ranges',
            orr.id,
            'legacy organization_route_ranges km 값을 KP로 승계'
        FROM organization_route_ranges orr
        JOIN organizations o ON o.id = orr.organization_id
        JOIN routes r ON r.id = orr.route_id
        JOIN rail_routes rr
          ON rr.name = r.name
          OR rr.name = REPLACE(r.name, ' (KTX)', '')
          OR rr.name = REPLACE(r.name, '고속선', '선')
        WHERE o.org_type = 'regional'
          AND orr.field = 'all'
        """
    )


def downgrade():
    op.drop_index("idx_rrrb_org", table_name="rail_route_region_boundaries")
    op.drop_index("idx_rrrb_route_kp", table_name="rail_route_region_boundaries")
    op.drop_table("rail_route_region_boundaries")

    op.drop_index("idx_rf_classification_id", table_name="rail_facilities")
    with op.batch_alter_table("rail_facilities", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("facility_type", sa.String(30), nullable=False, server_default="구조물"))
        batch_op.add_column(sa.Column("geometry_type", sa.String(20), nullable=False, server_default="point"))
        batch_op.add_column(sa.Column("facility_subtype", sa.String(30), nullable=True))
        batch_op.add_column(sa.Column("facility_detail_type", sa.String(30), nullable=True))
        batch_op.drop_constraint("fk_rail_facilities_classification", type_="foreignkey")
        batch_op.drop_column("classification_id")
    op.create_index("idx_rf_type", "rail_facilities", ["facility_type", "facility_subtype"])
    op.create_index("idx_rf_geometry_type", "rail_facilities", ["geometry_type"])
    op.create_index(
        "idx_rf_classification",
        "rail_facilities",
        ["facility_type", "facility_subtype", "facility_detail_type"],
    )

    op.drop_index("idx_rfc_categories", table_name="rail_facility_classifications")
    op.drop_table("rail_facility_classifications")
