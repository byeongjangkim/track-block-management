"""add station management groups

Revision ID: q6r7s8t9u0v1
Revises: p5q6r7s8t9u0
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa


revision = "q6r7s8t9u0v1"
down_revision = "p5q6r7s8t9u0"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("DROP VIEW IF EXISTS rail_route_baseline_points")
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_rail_stations")

    with op.batch_alter_table("rail_stations") as batch:
        batch.alter_column("lat", existing_type=sa.Float(), nullable=True)
        batch.alter_column("lon", existing_type=sa.Float(), nullable=True)
        batch.add_column(sa.Column("station_role", sa.String(20), nullable=True))
        batch.add_column(sa.Column("station_type", sa.String(20), nullable=True))

    op.execute(
        """
        CREATE VIEW rail_route_baseline_points AS
        SELECT
            p.id AS route_station_point_id,
            r.id AS rail_route_id,
            r.korail_route_code,
            r.name AS route_name,
            s.id AS station_id,
            s.station_code,
            s.name AS station_name,
            p.route_sequence_no,
            p.center_kp,
            p.yard_start_kp,
            p.yard_end_kp,
            s.lat,
            s.lon,
            p.is_baseline_anchor,
            p.match_note
        FROM rail_route_station_points p
        JOIN rail_routes r ON r.id = p.rail_route_id
        JOIN rail_stations s ON s.id = p.station_id
        """
    )

    op.create_table(
        "rail_station_management_groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=True),
        sa.Column("region_name", sa.String(100), nullable=False),
        sa.Column("manager_station_id", sa.Integer(), sa.ForeignKey("rail_stations.id"), nullable=False),
        sa.Column("manager_station_name", sa.String(100), nullable=False),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("source_row", sa.Integer(), nullable=True),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("region_name", "manager_station_name", name="uq_rsmg_region_manager"),
    )

    op.create_table(
        "rail_station_management_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "management_group_id",
            sa.Integer(),
            sa.ForeignKey("rail_station_management_groups.id"),
            nullable=False,
        ),
        sa.Column("station_id", sa.Integer(), sa.ForeignKey("rail_stations.id"), nullable=False),
        sa.Column("station_name", sa.String(100), nullable=False),
        sa.Column("station_role", sa.String(20), nullable=False),  # 관리역 | 소속역
        sa.Column("station_type", sa.String(20), nullable=False),  # 관리역 | 보통역 | 무인역 | 신호장 | 신호소
        sa.Column("match_status", sa.String(30), nullable=False),
        sa.Column("source_order", sa.Integer(), nullable=False),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("source_row", sa.Integer(), nullable=True),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("management_group_id", "station_id", name="uq_rsmm_group_station"),
    )

    op.create_index("idx_rsmg_org", "rail_station_management_groups", ["organization_id"])
    op.create_index("idx_rsmg_manager", "rail_station_management_groups", ["manager_station_id"])
    op.create_index("idx_rsmm_station", "rail_station_management_members", ["station_id"])
    op.create_index("idx_rsmm_group", "rail_station_management_members", ["management_group_id"])
    op.create_index("idx_rail_stations_name", "rail_stations", ["name"])


def downgrade():
    op.drop_index("idx_rail_stations_name", table_name="rail_stations")
    op.drop_index("idx_rsmm_group", table_name="rail_station_management_members")
    op.drop_index("idx_rsmm_station", table_name="rail_station_management_members")
    op.drop_index("idx_rsmg_manager", table_name="rail_station_management_groups")
    op.drop_index("idx_rsmg_org", table_name="rail_station_management_groups")
    op.drop_table("rail_station_management_members")
    op.drop_table("rail_station_management_groups")

    op.execute("DROP VIEW IF EXISTS rail_route_baseline_points")
    with op.batch_alter_table("rail_stations") as batch:
        batch.drop_column("station_type")
        batch.drop_column("station_role")
        batch.alter_column("lon", existing_type=sa.Float(), nullable=False)
        batch.alter_column("lat", existing_type=sa.Float(), nullable=False)

    op.execute(
        """
        CREATE VIEW rail_route_baseline_points AS
        SELECT
            p.id AS route_station_point_id,
            r.id AS rail_route_id,
            r.korail_route_code,
            r.name AS route_name,
            s.id AS station_id,
            s.station_code,
            s.name AS station_name,
            p.route_sequence_no,
            p.center_kp,
            p.yard_start_kp,
            p.yard_end_kp,
            s.lat,
            s.lon,
            p.is_baseline_anchor,
            p.match_note
        FROM rail_route_station_points p
        JOIN rail_routes r ON r.id = p.rail_route_id
        JOIN rail_stations s ON s.id = p.station_id
        """
    )
