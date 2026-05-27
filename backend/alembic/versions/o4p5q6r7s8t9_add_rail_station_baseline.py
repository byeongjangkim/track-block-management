"""add rail station baseline tables

Revision ID: o4p5q6r7s8t9
Revises: n3o4p5q6r7s8
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa


revision = "o4p5q6r7s8t9"
down_revision = "n3o4p5q6r7s8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rail_routes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("korail_route_code", sa.String(20), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("start_station_code", sa.String(30), nullable=True),
        sa.Column("start_station_name", sa.String(100), nullable=True),
        sa.Column("end_station_code", sa.String(30), nullable=True),
        sa.Column("end_station_name", sa.String(100), nullable=True),
        sa.Column("start_kp", sa.Float(), nullable=True),
        sa.Column("end_kp", sa.Float(), nullable=True),
        sa.Column("station_point_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("korail_route_code", name="uq_rail_routes_korail_route_code"),
    )

    op.create_table(
        "rail_stations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("station_code", sa.String(30), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("match_note", sa.String(255), nullable=True),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("station_code", name="uq_rail_stations_station_code"),
    )

    op.create_table(
        "rail_route_station_points",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rail_route_id", sa.Integer(), sa.ForeignKey("rail_routes.id"), nullable=False),
        sa.Column("station_id", sa.Integer(), sa.ForeignKey("rail_stations.id"), nullable=False),
        sa.Column("route_sequence_no", sa.Integer(), nullable=True),
        sa.Column("center_kp", sa.Float(), nullable=True),
        sa.Column("yard_start_kp", sa.Float(), nullable=True),
        sa.Column("yard_end_kp", sa.Float(), nullable=True),
        sa.Column("main_track_speed", sa.Float(), nullable=True),
        sa.Column("side_track_speed", sa.Float(), nullable=True),
        sa.Column("functional_location_no", sa.String(80), nullable=True),
        sa.Column("plant_code", sa.String(30), nullable=True),
        sa.Column("regional_org", sa.String(100), nullable=True),
        sa.Column("distance_from_prev", sa.Float(), nullable=True),
        sa.Column("direction_distance", sa.Float(), nullable=True),
        sa.Column("is_baseline_anchor", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("match_note", sa.String(255), nullable=True),
        sa.Column("source_row", sa.Integer(), nullable=True),
        sa.Column("source_file", sa.String(255), nullable=True),
        sa.Column("imported_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("rail_route_id", "station_id", name="uq_rail_route_station_point"),
    )

    op.create_index("idx_rrsp_route_seq", "rail_route_station_points", ["rail_route_id", "route_sequence_no"])
    op.create_index("idx_rrsp_route_center_kp", "rail_route_station_points", ["rail_route_id", "center_kp"])
    op.create_index("idx_rrsp_station", "rail_route_station_points", ["station_id"])

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


def downgrade():
    op.execute("DROP VIEW IF EXISTS rail_route_baseline_points")
    op.drop_index("idx_rrsp_station", table_name="rail_route_station_points")
    op.drop_index("idx_rrsp_route_center_kp", table_name="rail_route_station_points")
    op.drop_index("idx_rrsp_route_seq", table_name="rail_route_station_points")
    op.drop_table("rail_route_station_points")
    op.drop_table("rail_stations")
    op.drop_table("rail_routes")
