"""tc15: block_manager 역할 도입 및 기본 차단명령 관리자 계정 생성

역할 체계 확정:
  system_superuser → 시스템 관리자 (설정·사용자 관리 전용)
  block_manager    → 차단명령 관리자 (전국 어디든 등록, 조직 제한 없음) [신규]
  org_admin        → 소속 관리자 (소속 조직 관할 구간 + 소속 사용자 관리)
  user             → 소속 사용자 (can_register 여부)

Revision ID: tc15_block_manager_role
Revises: tc14_can_register
Create Date: 2026-06-08
"""

from alembic import op

revision = "tc15_block_manager_role"
down_revision = "tc14_can_register"
branch_labels = None
depends_on = None

# 기본 차단명령 관리자 계정 정보
# 비밀번호: Korail2024!  (최초 로그인 후 반드시 변경)
_BLOCK_MANAGER_HASH = "$2b$12$KTAZI/AnpKc/Hn148RnqIOhqVk1ZozGi.fdhIci3ssxOKfBWcQxsm"


def upgrade() -> None:
    # block_manager 사용자 생성 (organization_id=NULL, can_register=TRUE)
    op.execute(f"""
        INSERT INTO users (username, hashed_password, full_name, role, field, organization_id, is_active, can_register)
        VALUES ('block_manager', '{_BLOCK_MANAGER_HASH}', '차단명령 관리자', 'block_manager', NULL, NULL, TRUE, TRUE)
        ON CONFLICT (username) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM users WHERE username = 'block_manager' AND role = 'block_manager'")
