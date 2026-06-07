"""tc13: projects 공사/사업 테이블 + block_orders.project_id FK

Revision ID: tc13_projects
Revises: tc12_block_order_stations
Create Date: 2026-06-07
"""

from alembic import op
import sqlalchemy as sa

revision = "tc13_projects"
down_revision = "tc12_block_order_stations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=True),
        sa.Column("rail_route_id", sa.Integer(), sa.ForeignKey("rail_routes.id"), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        # 유형: 공사 | 유지보수 | 외부 | 기타
        sa.Column("project_type", sa.String(20), nullable=False, server_default="공사"),
        # 분야: 시설 | 전기 | 건축 | all
        sa.Column("field", sa.String(10), nullable=True),
        # 시행주체: 철도공사 | 철도공단 | 외부
        sa.Column("implementer", sa.String(20), nullable=False, server_default="철도공사"),
        sa.Column("contractor", sa.String(100), nullable=True),
        sa.Column("contract_number", sa.String(100), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        # 상태: 계획 | 진행중 | 완료 | 중지
        sa.Column("status", sa.String(20), nullable=False, server_default="진행중"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
    )

    op.add_column(
        "block_orders",
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
    )
    # reason 컬럼은 v1_initial_schema 에서 이미 생성됨 — 여기서 중복 생성 없음


def downgrade() -> None:
    op.drop_column("block_orders", "project_id")
    op.drop_table("projects")
