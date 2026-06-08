"""tc16: 개발 환경 기본 계정 비밀번호 통일 (korail7788!)

- admin@korail.com (system_superuser) 비밀번호 → korail7788!
- block_manager    (block_manager)    비밀번호 → korail7788!

※ 프로덕션 배포 전 반드시 변경할 것.

Revision ID: tc16_dev_accounts_pw
Revises: tc15_block_manager_role
Create Date: 2026-06-08
"""

from alembic import op

revision = "tc16_dev_accounts_pw"
down_revision = "tc15_block_manager_role"
branch_labels = None
depends_on = None

# bcrypt 12 rounds, password: korail7788!
_ADMIN_HASH        = "$2b$12$.8/LbQOZDS8CMEOAD7KEe.qH7grYAQvbQxWFL1l7/xHGVWluR.LAu"
_BLOCK_MGR_HASH    = "$2b$12$WxbPdj7OMaKrw8tZ3F/wbOXlb.ybY7kFhtL9AReeYPJ3l4MR9NIji"


def upgrade() -> None:
    op.execute(f"""
        UPDATE users SET hashed_password = '{_ADMIN_HASH}'
        WHERE username = 'admin@korail.com' AND role = 'system_superuser'
    """)
    op.execute(f"""
        UPDATE users SET hashed_password = '{_BLOCK_MGR_HASH}'
        WHERE username = 'block_manager' AND role = 'block_manager'
    """)


def downgrade() -> None:
    # 이전 해시 복원 불가 (비가역) — 수동 재설정 필요
    pass
