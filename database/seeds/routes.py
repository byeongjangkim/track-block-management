#!/usr/bin/env python3
"""
routes.py — 전국 노선 초기 데이터 입력

실행 방법:
    cd backend
    source .venv/bin/activate
    python ../database/seeds/routes.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))

from app.core.database import SessionLocal
from app.models.route import Route

ROUTES = [
    # ── 간선 ──────────────────────────────────────────────────────────────
    {"code": "gyeongbu",      "name": "경부선",         "start_km": 0.0, "end_km": 451.8,
     "up_direction": "서울 방향", "down_direction": "부산 방향"},
    {"code": "honam",         "name": "호남선",         "start_km": 0.0, "end_km": 251.5,
     "up_direction": "대전 방향", "down_direction": "목포 방향"},
    {"code": "jeolla",        "name": "전라선",         "start_km": 0.0, "end_km": 180.4,
     "up_direction": "익산 방향", "down_direction": "여수엑스포 방향"},
    {"code": "gyeongjeon",    "name": "경전선",         "start_km": 0.0, "end_km": 278.8,
     "up_direction": "광주송정 방향", "down_direction": "진주 방향"},
    {"code": "donghae",       "name": "동해선",         "start_km": 0.0, "end_km": 188.6,
     "up_direction": "부전 방향", "down_direction": "포항 방향"},
    {"code": "jungang",       "name": "중앙선",         "start_km": 0.0, "end_km": 395.0,
     "up_direction": "청량리 방향", "down_direction": "경주 방향"},
    {"code": "taebaek",       "name": "태백선",         "start_km": 0.0, "end_km": 93.2,
     "up_direction": "제천 방향", "down_direction": "백산 방향"},
    {"code": "yeongdong",     "name": "영동선",         "start_km": 0.0, "end_km": 192.6,
     "up_direction": "영주 방향", "down_direction": "강릉 방향"},
    {"code": "chungbuk",      "name": "충북선",         "start_km": 0.0, "end_km": 115.0,
     "up_direction": "조치원 방향", "down_direction": "봉양 방향"},
    {"code": "janghang",      "name": "장항선",         "start_km": 0.0, "end_km": 154.7,
     "up_direction": "천안 방향", "down_direction": "익산 방향"},
    # ── 수도권 ────────────────────────────────────────────────────────────
    {"code": "gyeongwon",     "name": "경원선",         "start_km": 0.0, "end_km": 94.5,
     "up_direction": "용산 방향", "down_direction": "백마고지 방향"},
    {"code": "gyeongui",      "name": "경의선",         "start_km": 0.0, "end_km": 56.0,
     "up_direction": "서울 방향", "down_direction": "도라산 방향"},
    {"code": "gyeongin",      "name": "경인선",         "start_km": 0.0, "end_km": 27.0,
     "up_direction": "구로 방향", "down_direction": "인천 방향"},
    {"code": "gyeongchun",    "name": "경춘선",         "start_km": 0.0, "end_km": 80.7,
     "up_direction": "망우 방향", "down_direction": "춘천 방향"},
    {"code": "gyeonggang",    "name": "경강선",         "start_km": 0.0, "end_km": 57.1,
     "up_direction": "판교 방향", "down_direction": "여주 방향"},
    # ── 고속선 ────────────────────────────────────────────────────────────
    {"code": "gyeongbu_high", "name": "경부고속선",     "start_km": 0.0, "end_km": 417.0,
     "up_direction": "서울 방향", "down_direction": "부산 방향"},
    {"code": "honam_high",    "name": "호남고속선",     "start_km": 0.0, "end_km": 182.3,
     "up_direction": "오송 방향", "down_direction": "목포 방향"},
    {"code": "gangneung",     "name": "강릉선",         "start_km": 0.0, "end_km": 120.7,
     "up_direction": "만종 방향", "down_direction": "강릉 방향"},
    # ── 지선 ──────────────────────────────────────────────────────────────
    {"code": "jinhae",        "name": "진해선",         "start_km": 0.0, "end_km": 21.3,
     "up_direction": "창원 방향", "down_direction": "진해 방향"},
    {"code": "gaya",          "name": "가야선",         "start_km": 0.0, "end_km": 7.1,
     "up_direction": "삼랑진 방향", "down_direction": "가야 방향"},
]


def seed():
    db = SessionLocal()
    try:
        added = 0
        for data in ROUTES:
            if db.query(Route).filter(Route.code == data["code"]).first():
                print(f"  이미 존재: {data['name']}")
                continue
            db.add(Route(**data))
            added += 1
            print(f"  ✓ {data['name']:12s}  {data['start_km']:5.1f} ~ {data['end_km']:5.1f} km")
        db.commit()
        print(f"\n  {added}개 노선 추가 완료")
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 50)
    print("  전국 노선 초기 데이터 입력")
    print("=" * 50)
    seed()
