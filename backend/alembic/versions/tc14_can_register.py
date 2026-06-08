"""tc14: users.can_register 컬럼 추가 — 소속 사용자 차단명령 등록 권한

역할 체계 재설계:
  system_superuser → 시스템 관리자 (설정·사용자 관리 전용, 차단명령 등록 불가)
  org_admin        → 차단명령 관리자 (조직 관할 구간 내 차단명령 CRUD)
  user             → 소속 사용자 (can_register=True면 등록 가능, False면 조회만)

Revision ID: tc14_can_register
Revises: tc13_projects
Create Date: 2026-06-08
"""

from alembic import op
import sqlalchemy as sa

revision = "tc14_can_register"
down_revision = "tc13_projects"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("can_register", sa.Boolean(), nullable=False, server_default="FALSE"),
    )
    # 기존 org_admin 사용자는 차단명령 관리자이므로 can_register=TRUE 설정
    op.execute("UPDATE users SET can_register = TRUE WHERE role = 'org_admin'")


def downgrade() -> None:
    op.drop_column("users", "can_register")
