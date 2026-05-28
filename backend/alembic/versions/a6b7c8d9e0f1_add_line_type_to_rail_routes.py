"""add line_type to rail_routes

Revision ID: a6b7c8d9e0f1
Revises: z5a6b7c8d9e0
Create Date: 2026-05-27

변경 내용:
  rail_routes 테이블에 line_type 컬럼 추가
    line_type  TEXT  NOT NULL DEFAULT '일반선'
               CHECK (line_type IN ('고속선', '일반선'))

  고속선 자동 분류:
    - 노선명에 '고속선'이 포함된 경우 → '고속선'
    - 나머지 → '일반선' (DEFAULT)

  목적:
    기존 route_code.endswith('_high') 방식의 취약점을 해소하고
    DB 레벨에서 직접 고속선/일반선 필터·집계가 가능하도록 한다.
"""
import sqlalchemy as sa
from alembic import op

revision = "a6b7c8d9e0f1"
down_revision = "z5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rail_routes") as batch_op:
        batch_op.add_column(
            sa.Column(
                "line_type",
                sa.String(20),
                nullable=False,
                server_default="일반선",
            )
        )

    # 고속선 자동 분류: 노선명에 '고속선' 포함 → '고속선'
    op.execute(
        "UPDATE rail_routes SET line_type = '고속선' WHERE name LIKE '%고속선%'"
    )


def downgrade() -> None:
    with op.batch_alter_table("rail_routes") as batch_op:
        batch_op.drop_column("line_type")
