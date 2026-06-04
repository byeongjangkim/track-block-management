"""drop route_geometry table

route_geometry(50개 노선, source='user'/'shp')를 rail_computed_geometry(77개 노선, KP 보간)로
완전 전환한 이후 사용하지 않는 테이블 제거.

Revision ID: a0b1c2d3e4f5
Revises: z5a6b7c8d9e0
Create Date: 2026-05-27
"""
from alembic import op

revision = "a0b1c2d3e4f5"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("route_geometry")


def downgrade() -> None:
    op.execute("""
        CREATE TABLE route_geometry (
            id         SERIAL PRIMARY KEY,
            route_code TEXT    NOT NULL,
            source     TEXT    NOT NULL DEFAULT 'user',
            lod        TEXT    NOT NULL DEFAULT 'high',
            segment    INTEGER NOT NULL DEFAULT 0,
            seq        INTEGER NOT NULL,
            lat        REAL    NOT NULL,
            lon        REAL    NOT NULL,
            km         REAL
        )
    """)
    op.execute("CREATE INDEX ix_route_geometry_route_code ON route_geometry (route_code)")
    op.execute("CREATE INDEX ix_route_geometry_source ON route_geometry (source)")
    op.execute("CREATE INDEX ix_route_geometry_lod ON route_geometry (lod)")
