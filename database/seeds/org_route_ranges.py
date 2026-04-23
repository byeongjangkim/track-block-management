#!/usr/bin/env python3
"""
org_route_ranges.py — 조직별 노선 담당 구간 초기 데이터 입력 (최초 1회)

DB가 유일한 데이터 기준(SOT)이다.
이 스크립트는 DB 초기화 목적으로만 사용하며, 이후 변경은 백엔드 API로 처리한다.

구조:
  - field='all'  : 지역본부 행정 경계 (분야 무관 전체)
  - field='시설'  : 시설 분야 담당 경계
  - field='전기'  : 전기 분야 담당 경계

실행 방법:
    cd backend
    source .venv/bin/activate
    python ../database/seeds/org_route_ranges.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))

from app.core.database import SessionLocal
from app.models.organization import Organization, OrganizationRouteRange
from app.models.route import Route

# ── 관할 구간 초기 데이터 (org_code, route_code, field, start_km, end_km) ──
RANGES = [
    # 서울본부
    ("seoul", "gyeongbu",   "all",   0.0,   97.2),
    ("seoul", "gyeongwon",  "all",   0.0,   94.5),
    ("seoul", "gyeongui",   "all",   0.0,   56.0),
    ("seoul", "gyeongin",   "all",   0.0,   27.0),
    # 충북본부
    ("chungbuk", "chungbuk", "all",  0.0,  115.0),
    # 대전충남본부
    ("daejeon", "gyeongbu",  "all",  97.2,  212.6),
    ("daejeon", "honam",     "all",   0.0,  103.9),
    ("daejeon", "janghang",  "all",   0.0,  154.7),
    # 전북본부
    ("jeonbuk", "honam",     "all", 103.9,  163.0),
    ("jeonbuk", "jeolla",    "all",   0.0,   60.9),
    # 광주본부
    ("gwangju", "honam",     "all", 163.0,  251.5),
    ("gwangju", "gyeongjeon","all",   0.0,  148.3),
    # 전남본부
    ("jeonnam", "jeolla",    "all",  60.9,  180.4),
    # 경북본부
    ("gyeongbuk", "gyeongbu", "all", 212.6, 300.0),
    ("gyeongbuk", "jungang",  "all",  66.5, 395.0),
    ("gyeongbuk", "taebaek",  "all",   0.0,  93.2),
    ("gyeongbuk", "yeongdong","all",   0.0, 192.6),
    # 부산경남본부
    ("busan", "gyeongbu",   "all",  300.0,  451.8),
    ("busan", "gyeongjeon", "all",  148.3,  278.8),
    ("busan", "donghae",    "all",    0.0,  188.6),
    ("busan", "jinhae",     "all",    0.0,   21.3),
    ("busan", "gaya",       "all",    0.0,    7.1),
    # 강원본부
    ("gangwon", "jungang",   "all",   0.0,   66.5),
    ("gangwon", "yeongdong", "all",   0.0,  192.6),
    ("gangwon", "gangneung", "all",   0.0,  120.7),
    # 수도권동부본부
    ("metro_east", "gyeongchun", "all",  0.0,  80.7),
    ("metro_east", "gyeonggang", "all",  0.0,  57.1),
    # 수도권서부본부
    ("metro_west", "gyeongui",  "all",  0.0,  56.0),
    ("metro_west", "gyeongin",  "all",  0.0,  27.0),
    # 고속시설사업단
    ("highspeed_facility", "gyeongbu_high", "시설",  0.0,  417.0),
    ("highspeed_facility", "honam_high",    "시설",  0.0,  182.3),
    ("highspeed_facility", "gangneung",     "시설",  0.0,  120.7),
    # 고속전기사업단
    ("highspeed_electric", "gyeongbu_high", "전기",  0.0,  417.0),
    ("highspeed_electric", "honam_high",    "전기",  0.0,  182.3),
    ("highspeed_electric", "gangneung",     "전기",  0.0,  120.7),
]


def seed():
    db = SessionLocal()
    try:
        # 조직·노선 코드 → id 맵 생성
        org_map = {o.code: o.id for o in db.query(Organization).all()}
        route_map = {r.code: r.id for r in db.query(Route).all()}

        missing_orgs = set()
        missing_routes = set()
        added = 0

        for org_code, route_code, field, start_km, end_km in RANGES:
            if org_code not in org_map:
                missing_orgs.add(org_code)
                continue
            if route_code not in route_map:
                missing_routes.add(route_code)
                continue

            org_id = org_map[org_code]
            route_id = route_map[route_code]

            exists = db.query(OrganizationRouteRange).filter_by(
                organization_id=org_id,
                route_id=route_id,
                field=field,
            ).first()
            if exists:
                print(f"  이미 존재: {org_code} / {route_code} / {field}")
                continue

            db.add(OrganizationRouteRange(
                organization_id=org_id,
                route_id=route_id,
                field=field,
                start_km=start_km,
                end_km=end_km,
            ))
            added += 1
            print(f"  ✓ {org_code:22s}  {route_code:16s}  [{field:4s}]  {start_km:6.1f} ~ {end_km:6.1f} km")

        db.commit()

        if missing_orgs:
            print(f"\n  ⚠ 조직 없음 (organizations 시드 먼저 실행): {missing_orgs}")
        if missing_routes:
            print(f"\n  ⚠ 노선 없음 (routes 시드 먼저 실행): {missing_routes}")
        print(f"\n  {added}개 관할 구간 추가 완료")
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 65)
    print("  조직별 노선 담당 구간 초기 데이터 입력")
    print("=" * 65)
    seed()
