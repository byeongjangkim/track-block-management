"""
초기 superuser 생성

실행: cd backend && python scripts/seed/03_initial_user.py
환경변수 ADMIN_PASSWORD 설정 시 해당 값 사용 (미설정 시 기본값 사용)
"""
import sys, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import bcrypt
from sqlalchemy import text
from app.core.database import SessionLocal

ADMIN_USERNAME = 'admin@korail.com'
ADMIN_FULLNAME = '시스템 관리자'
DEFAULT_PASSWORD = 'korail7788!'  # 최초 배포 후 반드시 변경


def run():
    password = os.environ.get('ADMIN_PASSWORD', DEFAULT_PASSWORD)
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT id FROM users WHERE username = :u"),
            {"u": ADMIN_USERNAME}
        ).fetchone()

        if existing:
            db.execute(
                text("UPDATE users SET hashed_password=:h, role='system_superuser', is_active=TRUE WHERE username=:u"),
                {"h": hashed, "u": ADMIN_USERNAME}
            )
            print(f"superuser 업데이트: {ADMIN_USERNAME}")
        else:
            db.execute(
                text("""
                    INSERT INTO users (username, hashed_password, full_name, role, is_active)
                    VALUES (:u, :h, :n, 'system_superuser', TRUE)
                """),
                {"u": ADMIN_USERNAME, "h": hashed, "n": ADMIN_FULLNAME}
            )
            print(f"superuser 생성: {ADMIN_USERNAME}")

        db.commit()
        if password == DEFAULT_PASSWORD:
            print(f"⚠️  기본 비밀번호 사용 중 — 배포 후 즉시 변경 필요: {DEFAULT_PASSWORD}")
    finally:
        db.close()


if __name__ == "__main__":
    run()
