"""add segment column to route_geometry

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-04-09

route_geometry 테이블에 segment 컬럼 추가.
OSM way 조각들을 linemerge로 이어붙이면 연결되지 않는 구간(상선/하선 등)이
별도 segment로 분리되어 저장된다.
"""
from alembic import op
import sqlalchemy as sa

revision = 'd3e4f5a6b7c8'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite는 컬럼 변경이 제한적이므로 테이블 재생성 방식 사용
    op.execute("DROP INDEX IF EXISTS idx_rg_route_lod")
    op.execute("DROP TABLE IF EXISTS route_geometry_old")
    op.execute("ALTER TABLE route_geometry RENAME TO route_geometry_old")

    op.execute("""
        CREATE TABLE route_geometry (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            route_code TEXT    NOT NULL,
            lod        TEXT    NOT NULL,
            segment    INTEGER NOT NULL DEFAULT 0,
            seq        INTEGER NOT NULL,
            lat        REAL    NOT NULL,
            lon        REAL    NOT NULL,
            km         REAL,
            UNIQUE (route_code, lod, segment, seq)
        )
    """)
    op.execute("""
        CREATE INDEX idx_rg_route_lod ON route_geometry (route_code, lod)
    """)

    # 기존 데이터 이전 (segment=0으로 일괄 이전)
    op.execute("""
        INSERT INTO route_geometry (id, route_code, lod, segment, seq, lat, lon, km)
        SELECT id, route_code, lod, 0, seq, lat, lon, km
        FROM route_geometry_old
    """)
    op.execute("DROP TABLE route_geometry_old")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_rg_route_lod")
    op.execute("DROP TABLE IF EXISTS route_geometry_old")
    op.execute("ALTER TABLE route_geometry RENAME TO route_geometry_old")

    op.execute("""
        CREATE TABLE route_geometry (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            route_code TEXT    NOT NULL,
            lod        TEXT    NOT NULL,
            seq        INTEGER NOT NULL,
            lat        REAL    NOT NULL,
            lon        REAL    NOT NULL,
            km         REAL,
            UNIQUE (route_code, lod, seq)
        )
    """)
    op.execute("""
        CREATE INDEX idx_rg_route_lod ON route_geometry (route_code, lod)
    """)
    op.execute("""
        INSERT INTO route_geometry (id, route_code, lod, seq, lat, lon, km)
        SELECT id, route_code, lod, seq, lat, lon, km
        FROM route_geometry_old
    """)
    op.execute("DROP TABLE route_geometry_old")
