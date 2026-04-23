#!/usr/bin/env python3
"""
organizations.py — 전국 14개 조직 초기 데이터 입력

실행 방법:
    cd backend
    source .venv/bin/activate
    python ../database/seeds/organizations.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))

from app.core.database import SessionLocal
from app.models.organization import Organization

ORGANIZATIONS = [
    # ── 지역본부 12개 ──────────────────────────────────────────────────────
    {"code": "seoul",             "name": "서울본부",       "org_type": "regional"},
    {"code": "chungbuk",          "name": "충북본부",       "org_type": "regional"},
    {"code": "daejeon",           "name": "대전충남본부",   "org_type": "regional"},
    {"code": "jeonbuk",           "name": "전북본부",       "org_type": "regional"},
    {"code": "gwangju",           "name": "광주본부",       "org_type": "regional"},
    {"code": "jeonnam",           "name": "전남본부",       "org_type": "regional"},
    {"code": "gyeongbuk",         "name": "경북본부",       "org_type": "regional"},
    {"code": "daegu",             "name": "대구본부",       "org_type": "regional"},
    {"code": "busan",             "name": "부산경남본부",   "org_type": "regional"},
    {"code": "gangwon",           "name": "강원본부",       "org_type": "regional"},
    {"code": "metro_east",        "name": "수도권동부본부", "org_type": "regional"},
    {"code": "metro_west",        "name": "수도권서부본부", "org_type": "regional"},
    # ── 사업단 2개 ────────────────────────────────────────────────────────
    {"code": "highspeed_facility","name": "고속시설사업단", "org_type": "special"},
    {"code": "highspeed_electric","name": "고속전기사업단", "org_type": "special"},
]


def seed():
    db = SessionLocal()
    try:
        added = 0
        for data in ORGANIZATIONS:
            if db.query(Organization).filter(Organization.code == data["code"]).first():
                print(f"  이미 존재: {data['name']}")
                continue
            db.add(Organization(**data))
            added += 1
            tag = "[사업단]" if data["org_type"] == "special" else "[지역본부]"
            print(f"  ✓ {tag} {data['name']}  ({data['code']})")
        db.commit()
        print(f"\n  {added}개 조직 추가 완료")
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 50)
    print("  전국 14개 조직 초기 데이터 입력")
    print("=" * 50)
    seed()
