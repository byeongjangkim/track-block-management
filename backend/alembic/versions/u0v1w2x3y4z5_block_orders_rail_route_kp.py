"""connect block orders to rail routes and KP

Revision ID: u0v1w2x3y4z5
Revises: t9u0v1w2x3y4
Create Date: 2026-05-04
"""
from alembic import op
import sqlalchemy as sa


revision = "u0v1w2x3y4z5"
down_revision = "t9u0v1w2x3y4"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("block_orders") as batch_op:
        batch_op.alter_column("route_id", existing_type=sa.Integer(), nullable=True)
        batch_op.add_column(sa.Column("rail_route_id", sa.Integer(), sa.ForeignKey("rail_routes.id"), nullable=True))
        batch_op.add_column(sa.Column("start_kp", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("end_kp", sa.Float(), nullable=True))
        batch_op.create_index("idx_bo_rail_route_kp", ["rail_route_id", "start_kp", "end_kp"])

    conn = op.get_bind()

    # 철도 km과 KP는 같은 의미로 사용한다. 기존 start_km/end_km 값을 KP 컬럼으로 승계한다.
    conn.execute(sa.text("UPDATE block_orders SET start_kp = start_km WHERE start_kp IS NULL"))
    conn.execute(sa.text("UPDATE block_orders SET end_kp = end_km WHERE end_kp IS NULL"))

    # 기존 legacy routes.name과 최종 rail_routes.name이 같은 경우 우선 매핑한다.
    conn.execute(
        sa.text(
            """
            UPDATE block_orders
            SET rail_route_id = (
                SELECT rr.id
                FROM routes r
                JOIN rail_routes rr ON rr.name = r.name
                WHERE r.id = block_orders.route_id
                LIMIT 1
            )
            WHERE rail_route_id IS NULL
              AND route_id IS NOT NULL
            """
        )
    )

    # legacy 노선명과 최종 노선명이 조금 다른 대표 고속선 명칭 보정.
    conn.execute(
        sa.text(
            """
            UPDATE block_orders
            SET rail_route_id = (
                SELECT rr.id
                FROM routes r
                JOIN rail_routes rr
                  ON rr.name = REPLACE(r.name, ' (KTX)', '')
                WHERE r.id = block_orders.route_id
                LIMIT 1
            )
            WHERE rail_route_id IS NULL
              AND route_id IS NOT NULL
            """
        )
    )

    conn.execute(
        sa.text(
            """
            UPDATE block_orders
            SET rail_route_id = (
                SELECT rr.id
                FROM routes r
                JOIN rail_routes rr
                  ON rr.name = REPLACE(r.name, '고속선', '선')
                WHERE r.id = block_orders.route_id
                LIMIT 1
            )
            WHERE rail_route_id IS NULL
              AND route_id IS NOT NULL
            """
        )
    )


def downgrade():
    with op.batch_alter_table("block_orders") as batch_op:
        batch_op.drop_index("idx_bo_rail_route_kp")
        batch_op.drop_column("end_kp")
        batch_op.drop_column("start_kp")
        batch_op.drop_column("rail_route_id")
        batch_op.alter_column("route_id", existing_type=sa.Integer(), nullable=False)
