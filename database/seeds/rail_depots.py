#!/usr/bin/env python3
"""
rail_depots.py — 주요 KORAIL 기지(차량기지·보수기지) 초기 데이터 입력

실행 방법:
    cd backend
    source .venv/bin/activate
    python ../database/seeds/rail_depots.py

특이사항:
  - rail_routes 테이블에 line_type='기지'로 등록
  - korail_route_code: "DEP-{약칭}" 형식
  - start_kp = 0.0  (인출선 분기점 기점)
  - end_kp    = 기지 내 최대 거리(미상이면 None — 추후 현장 계측 후 업데이트)
  - GPS(start_lat/lon): 기지 접속 분기점 인근 좌표 (근사값, 현장 확인 후 보정)
  - route_category: 기지 유형 ('차량기지' | '보수기지' | '전기기지')
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))

from app.core.database import SessionLocal
from app.models.rail_baseline import RailRoute

DEPOTS = [
    # ── 수도권 ─────────────────────────────────────────────────────────────
    {
        "korail_route_code": "DEP-SEOUL",
        "name": "서울차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 6.0,
        "start_lat": 37.5178, "start_lon": 126.8972,   # 경부선 영등포 인근
        "start_station_name": "영등포", "end_station_name": None,
    },
    {
        "korail_route_code": "DEP-SUSEO",
        "name": "수서차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 4.5,
        "start_lat": 37.4872, "start_lon": 127.1024,   # 수서역 인근
        "start_station_name": "수서", "end_station_name": None,
    },
    {
        "korail_route_code": "DEP-SUWON",
        "name": "수원차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 5.0,
        "start_lat": 37.2644, "start_lon": 127.0327,
        "start_station_name": "수원", "end_station_name": None,
    },
    {
        "korail_route_code": "DEP-UIJEONGBU",
        "name": "의정부차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 3.0,
        "start_lat": 37.7383, "start_lon": 127.0511,
        "start_station_name": "의정부", "end_station_name": None,
    },
    # ── 충청 ───────────────────────────────────────────────────────────────
    {
        "korail_route_code": "DEP-DAEJEON",
        "name": "대전차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 7.0,
        "start_lat": 36.3454, "start_lon": 127.3845,
        "start_station_name": "대전", "end_station_name": None,
    },
    {
        "korail_route_code": "DEP-OSONG",
        "name": "오송고속차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 8.0,
        "start_lat": 36.6243, "start_lon": 127.3051,   # 오송역 인근
        "start_station_name": "오송", "end_station_name": None,
    },
    # ── 영남 ───────────────────────────────────────────────────────────────
    {
        "korail_route_code": "DEP-DONGDAEGU",
        "name": "동대구차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 5.5,
        "start_lat": 35.8795, "start_lon": 128.6285,
        "start_station_name": "동대구", "end_station_name": None,
    },
    {
        "korail_route_code": "DEP-BUSAN",
        "name": "부산차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 6.0,
        "start_lat": 35.1141, "start_lon": 129.0425,
        "start_station_name": "부산", "end_station_name": None,
    },
    {
        "korail_route_code": "DEP-GWANGMYEONG",
        "name": "광명고속차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 4.0,
        "start_lat": 37.4172, "start_lon": 126.8588,
        "start_station_name": "광명", "end_station_name": None,
    },
    # ── 호남 ───────────────────────────────────────────────────────────────
    {
        "korail_route_code": "DEP-GWANGJU",
        "name": "광주차량기지",
        "line_type": "기지",
        "route_category": "차량기지",
        "start_kp": 0.0, "end_kp": 4.5,
        "start_lat": 35.1596, "start_lon": 126.8526,
        "start_station_name": "광주송정", "end_station_name": None,
    },
    # ── 보수기지 ───────────────────────────────────────────────────────────
    {
        "korail_route_code": "DEP-MAINT-SEOUL",
        "name": "서울보수기지",
        "line_type": "기지",
        "route_category": "보수기지",
        "start_kp": 0.0, "end_kp": None,
        "start_lat": 37.5100, "start_lon": 126.9830,
        "start_station_name": "서울", "end_station_name": None,
    },
    {
        "korail_route_code": "DEP-MAINT-DAEJEON",
        "name": "대전보수기지",
        "line_type": "기지",
        "route_category": "보수기지",
        "start_kp": 0.0, "end_kp": None,
        "start_lat": 36.3325, "start_lon": 127.4344,
        "start_station_name": "대전", "end_station_name": None,
    },
    {
        "korail_route_code": "DEP-MAINT-BUSAN",
        "name": "부산보수기지",
        "line_type": "기지",
        "route_category": "보수기지",
        "start_kp": 0.0, "end_kp": None,
        "start_lat": 35.1016, "start_lon": 129.0297,
        "start_station_name": "부산", "end_station_name": None,
    },
]


def seed():
    db = SessionLocal()
    inserted = 0
    skipped = 0
    try:
        for d in DEPOTS:
            exists = db.query(RailRoute).filter(
                RailRoute.korail_route_code == d["korail_route_code"]
            ).first()
            if exists:
                print(f"  SKIP  {d['name']} (이미 존재: {d['korail_route_code']})")
                skipped += 1
                continue
            route = RailRoute(
                korail_route_code    = d["korail_route_code"],
                name                 = d["name"],
                line_type            = d["line_type"],
                route_category       = d.get("route_category"),
                start_kp             = d.get("start_kp"),
                end_kp               = d.get("end_kp"),
                start_lat            = d.get("start_lat"),
                start_lon            = d.get("start_lon"),
                start_station_name   = d.get("start_station_name"),
                end_station_name     = d.get("end_station_name"),
                is_active            = True,
            )
            db.add(route)
            print(f"  ADD   {d['name']}")
            inserted += 1
        db.commit()
        print(f"\n완료: {inserted}개 추가, {skipped}개 이미 존재")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
