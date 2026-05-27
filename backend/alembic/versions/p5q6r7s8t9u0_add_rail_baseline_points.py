"""add rail baseline points

Revision ID: p5q6r7s8t9u0
Revises: o4p5q6r7s8t9
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa


revision = "p5q6r7s8t9u0"
down_revision = "o4p5q6r7s8t9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rail_baseline_points",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rail_route_id", sa.Integer(), sa.ForeignKey("rail_routes.id"), nullable=False),
        sa.Column("segment_no", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("kp", sa.Float(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("point_type", sa.String(40), nullable=False),
        sa.Column("source_type", sa.String(40), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=True),
        sa.Column("station_id", sa.Integer(), sa.ForeignKey("rail_stations.id"), nullable=True),
        sa.Column("facility_id", sa.Integer(), sa.ForeignKey("facilities.id"), nullable=True),
        sa.Column("is_interpolation_anchor", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("is_render_anchor", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "rail_route_id",
            "point_type",
            "source_type",
            "source_id",
            name="uq_rail_baseline_source_point",
        ),
    )
    op.create_index("idx_rbp_route_seq", "rail_baseline_points", ["rail_route_id", "segment_no", "seq"])
    op.create_index("idx_rbp_route_kp", "rail_baseline_points", ["rail_route_id", "segment_no", "kp"])
    op.create_index("idx_rbp_source", "rail_baseline_points", ["source_type", "source_id"])
    op.create_index("idx_rbp_station", "rail_baseline_points", ["station_id"])
    op.create_index("idx_rbp_facility", "rail_baseline_points", ["facility_id"])

    op.execute(
        """
        INSERT INTO rail_baseline_points (
            rail_route_id,
            segment_no,
            seq,
            kp,
            lat,
            lon,
            point_type,
            source_type,
            source_id,
            station_id,
            facility_id,
            is_interpolation_anchor,
            is_render_anchor,
            note
        )
        SELECT
            rail_route_id,
            0 AS segment_no,
            ROW_NUMBER() OVER (
                PARTITION BY rail_route_id
                ORDER BY route_sequence_no IS NULL, route_sequence_no, center_kp, point_id
            ) AS seq,
            center_kp AS kp,
            lat,
            lon,
            'station_center' AS point_type,
            'rail_route_station_point' AS source_type,
            point_id AS source_id,
            station_id,
            NULL AS facility_id,
            1 AS is_interpolation_anchor,
            1 AS is_render_anchor,
            NULL AS note
        FROM (
            SELECT
                p.id AS point_id,
                p.rail_route_id,
                p.station_id,
                p.route_sequence_no,
                p.center_kp,
                s.lat,
                s.lon
            FROM rail_route_station_points p
            JOIN rail_stations s ON s.id = p.station_id
            WHERE p.center_kp IS NOT NULL
              AND p.is_baseline_anchor = 1
        ) station_centers
        """
    )


def downgrade():
    op.drop_index("idx_rbp_facility", table_name="rail_baseline_points")
    op.drop_index("idx_rbp_station", table_name="rail_baseline_points")
    op.drop_index("idx_rbp_source", table_name="rail_baseline_points")
    op.drop_index("idx_rbp_route_kp", table_name="rail_baseline_points")
    op.drop_index("idx_rbp_route_seq", table_name="rail_baseline_points")
    op.drop_table("rail_baseline_points")
