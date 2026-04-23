#!/usr/bin/env python3
"""
admin_user.py — 초기 관리자 계정 생성

생성 계정:
  - admin : system_superuser (최상위 관리자, 조직·분야 무관)

실행 방법:
    cd backend
    source .venv/bin/activate
    python ../database/seeds/admin_user.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User


def seed():
    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == "admin").first():
            print("  이미 존재: admin")
            return

        admin = User(
            username="admin",
            hashed_password=hash_password("admin1234"),
            full_name="관리자",
            is_active=True,
            role="system_superuser",
            field=None,           # 최상위 관리자 — 분야 무관
            organization_id=None, # 최상위 관리자 — 조직 무관
        )
        db.add(admin)
        db.commit()
        print("  ✓ admin 계정 생성 (비밀번호: admin1234)")
        print("  ※ 운영 환경에서는 반드시 비밀번호를 변경하세요.")
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 50)
    print("  관리자 계정 초기화")
    print("=" * 50)
    seed()
