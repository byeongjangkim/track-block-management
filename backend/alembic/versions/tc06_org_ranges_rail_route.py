"""tc06: organization_route_ranges — route_id(legacy) → rail_route_id(rail_routes)

기존 53개 legacy routes 테이블 참조를 155개 rail_routes 테이블 참조로 전환.
이름 기준 자동 매핑 후 테이블 재구성.

Revision ID: tc06_org_ranges_rail_route
Revises: tc05_tracks_field
Create Date: 2026-06-04
"""

revision = 'tc06_org_ranges_rail_route'
down_revision = 'tc05_tracks_field'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    conn = op.get_bind()
    dialect = conn.dialect.name

    if dialect == 'postgresql':
        # PostgreSQL: 컬럼 추가 → 데이터 채우기 → 제약 변경 → 구 컬럼 삭제
        op.add_column('organization_route_ranges',
            sa.Column('rail_route_id', sa.Integer(), nullable=True))
        op.execute("""
            UPDATE organization_route_ranges orr
            SET rail_route_id = (
                SELECT rr.id FROM routes r
                JOIN rail_routes rr ON rr.name = r.name AND rr.is_active = TRUE
                WHERE r.id = orr.route_id
            )
        """)
        op.alter_column('organization_route_ranges', 'rail_route_id', nullable=False)
        op.drop_constraint('uq_org_route_field', 'organization_route_ranges', type_='unique')
        op.drop_column('organization_route_ranges', 'route_id')
        op.create_unique_constraint(
            'uq_org_railroute_field', 'organization_route_ranges',
            ['organization_id', 'rail_route_id', 'field'])
        op.create_foreign_key(
            'fk_orr_rail_route', 'organization_route_ranges', 'rail_routes',
            ['rail_route_id'], ['id'])
    else:
        # SQLite: 테이블 재구성 방식
        op.execute("""
            CREATE TABLE organization_route_ranges_new (
                id        INTEGER NOT NULL PRIMARY KEY,
                organization_id INTEGER NOT NULL,
                rail_route_id   INTEGER NOT NULL,
                field     VARCHAR(20) NOT NULL DEFAULT 'all',
                start_km  FLOAT NOT NULL,
                end_km    FLOAT NOT NULL,
                FOREIGN KEY(organization_id) REFERENCES organizations(id),
                FOREIGN KEY(rail_route_id)   REFERENCES rail_routes(id),
                CONSTRAINT uq_org_railroute_field
                    UNIQUE (organization_id, rail_route_id, field)
            )
        """)
        op.execute("""
            INSERT INTO organization_route_ranges_new
                (id, organization_id, rail_route_id, field, start_km, end_km)
            SELECT orr.id, orr.organization_id, rr.id,
                   orr.field, orr.start_km, orr.end_km
            FROM organization_route_ranges orr
            JOIN routes r   ON r.id  = orr.route_id
            JOIN rail_routes rr ON rr.name = r.name AND rr.is_active = 1
        """)
        op.execute("DROP TABLE organization_route_ranges")
        op.execute("ALTER TABLE organization_route_ranges_new RENAME TO organization_route_ranges")


def downgrade():
    op.execute("""
        CREATE TABLE organization_route_ranges_old (
            id        INTEGER NOT NULL PRIMARY KEY,
            organization_id INTEGER NOT NULL,
            route_id  INTEGER NOT NULL,
            field     VARCHAR(20) NOT NULL DEFAULT 'all',
            start_km  FLOAT NOT NULL,
            end_km    FLOAT NOT NULL,
            FOREIGN KEY(organization_id) REFERENCES organizations(id),
            FOREIGN KEY(route_id)        REFERENCES routes(id),
            CONSTRAINT uq_org_route_field
                UNIQUE (organization_id, route_id, field)
        )
    """)

    op.execute("""
        INSERT INTO organization_route_ranges_old
            (id, organization_id, route_id, field, start_km, end_km)
        SELECT
            orr.id,
            orr.organization_id,
            r.id AS route_id,
            orr.field,
            orr.start_km,
            orr.end_km
        FROM organization_route_ranges orr
        JOIN rail_routes rr ON rr.id = orr.rail_route_id
        JOIN routes r ON r.name = rr.name
    """)

    op.execute("DROP TABLE organization_route_ranges")
    op.execute("ALTER TABLE organization_route_ranges_old RENAME TO organization_route_ranges")
