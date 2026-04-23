"""add source column to route_geometry

Revision ID: f5a6b7c8d9e0
Revises: 6f112792a0fb
Create Date: 2026-04-13

route_geometry 테이블에 source 컬럼 추가.
  source='shp'  : 국가기본도 SHP 참조 데이터 (km=NULL, 점선 표시)
  source='user' : 관리자 CSV 직접 업로드 (km=채워짐, 실선 표시)
UNIQUE 제약 조건 변경: (route_code, source, lod, segment, seq)
"""
from alembic import op

revision = 'f5a6b7c8d9e0'
down_revision = '6f112792a0fb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite는 ALTER TABLE로 UNIQUE 변경 불가 → 테이블 재생성
    op.execute("DROP INDEX IF EXISTS idx_rg_route_lod")
    op.execute("DROP TABLE IF EXISTS route_geometry_old")
    op.execute("ALTER TABLE route_geometry RENAME TO route_geometry_old")

    op.execute("""
        CREATE TABLE route_geometry (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            route_code TEXT    NOT NULL,
            source     TEXT    NOT NULL DEFAULT 'shp',
            lod        TEXT    NOT NULL,
            segment    INTEGER NOT NULL DEFAULT 0,
            seq        INTEGER NOT NULL,
            lat        REAL    NOT NULL,
            lon        REAL    NOT NULL,
            km         REAL,
            UNIQUE (route_code, source, lod, segment, seq)
        )
    """)
    op.execute("CREATE INDEX idx_rg_route_lod ON route_geometry (route_code, lod)")
    op.execute("CREATE INDEX idx_rg_route_source ON route_geometry (route_code, source)")

    # 기존 데이터 이전: source='shp' 으로 일괄 설정
    op.execute("""
        INSERT INTO route_geometry (id, route_code, source, lod, segment, seq, lat, lon, km)
        SELECT id, route_code, 'shp', lod, segment, seq, lat, lon, km
        FROM route_geometry_old
    """)
    op.execute("DROP TABLE route_geometry_old")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_rg_route_lod")
    op.execute("DROP INDEX IF EXISTS idx_rg_route_source")
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
    op.execute("CREATE INDEX idx_rg_route_lod ON route_geometry (route_code, lod)")

    # source='user' 데이터만 남김 (shp은 다시 합산 불가)
    op.execute("""
        INSERT INTO route_geometry (id, route_code, lod, segment, seq, lat, lon, km)
        SELECT id, route_code, lod, segment, seq, lat, lon, km
        FROM route_geometry_old
        WHERE source = 'shp'
    """)
    op.execute("DROP TABLE route_geometry_old")
