#!/usr/bin/env python3
"""
경부선 SHP geometry → source='user' geometry 변환 스크립트 (테스트용)

SHP 포인트에 Haversine 누적 거리를 이용해 km 값을 부여하고
route_geometry source='user' 로 저장한다.

실행:
  cd track-block-management
  source backend/.venv/bin/activate
  python3 scripts/gyeongbu_shp_to_user.py
"""

import math
import sys
from pathlib import Path

# backend 디렉토리를 CWD로 설정 (DATABASE_URL sqlite:///./db.sqlite3 기준)
BACKEND_DIR = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
import os
os.chdir(BACKEND_DIR)

from sqlalchemy import text

from app.core.database import SessionLocal
from app.services.geometry_service import save_geometry_user

ROUTE_CODE = "gyeongbu"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """두 WGS84 좌표 사이의 거리 (km)."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.asin(math.sqrt(a))


def main() -> None:
    db = SessionLocal()
    try:
        # 경부선 km 범위 조회
        route = db.execute(
            text("SELECT start_km, end_km FROM routes WHERE code = :code"),
            {"code": ROUTE_CODE},
        ).fetchone()
        if not route:
            print(f"[오류] 노선 '{ROUTE_CODE}' 없음")
            sys.exit(1)

        route_start, route_end = route.start_km, route.end_km
        print(f"경부선 km 범위: {route_start} ~ {route_end} km")

        # SHP geometry 조회 (high lod 우선, 없으면 low)
        shp_rows = []
        used_lod = ""
        for lod in ("high", "low"):
            shp_rows = db.execute(
                text("""
                    SELECT segment, seq, lat, lon
                    FROM route_geometry
                    WHERE route_code = :code AND source = 'shp' AND lod = :lod
                    ORDER BY segment, seq
                """),
                {"code": ROUTE_CODE, "lod": lod},
            ).fetchall()
            if shp_rows:
                used_lod = lod
                break

        if not shp_rows:
            print("[오류] SHP geometry 없음 — SHP import 먼저 실행 필요")
            sys.exit(1)

        print(f"SHP 포인트: {len(shp_rows)}개 (lod={used_lod})")

        # segment별로 그룹화
        seg_map: dict[int, list] = {}
        for row in shp_rows:
            seg_map.setdefault(row.segment, []).append(row)

        # 경부선: 서울(북, 고위도) → 부산(남, 저위도) → segment를 평균 위도 내림차순으로 정렬
        sorted_segs = sorted(
            seg_map.items(),
            key=lambda kv: sum(r.lat for r in kv[1]) / len(kv[1]),
            reverse=True,  # 고위도(서울) → 저위도(부산)
        )
        print(f"segment 수: {len(sorted_segs)}개 (위도 기준 정렬: {sorted_segs[0][0]} → {sorted_segs[-1][0]})")

        # 정렬된 순서대로 포인트 연결 (segment 내부 seq 순)
        ordered_points: list = []
        for _, rows_in_seg in sorted_segs:
            ordered_points.extend(sorted(rows_in_seg, key=lambda r: r.seq))

        # Haversine 누적 거리 계산
        cumulative: list[float] = [0.0]
        for i in range(1, len(ordered_points)):
            p, c = ordered_points[i - 1], ordered_points[i]
            cumulative.append(cumulative[-1] + haversine_km(p.lat, p.lon, c.lat, c.lon))

        total_dist = cumulative[-1]
        print(f"Haversine 총 거리: {total_dist:.2f} km (점프 포함)")

        # km 값 부여: haversine 비율 → 노선 km 체계로 선형 스케일
        route_len = route_end - route_start
        rows: list[dict] = []
        for i, point in enumerate(ordered_points):
            ratio = cumulative[i] / total_dist if total_dist > 0 else 0.0
            km = round(route_start + ratio * route_len, 4)
            rows.append({
                "segment": point.segment,
                "seq":     point.seq,
                "lat":     point.lat,
                "lon":     point.lon,
                "km":      km,
            })

        print("source='user'로 저장 중... (high/mid/low LOD 자동 생성)")
        saved = save_geometry_user(db, ROUTE_CODE, rows)
        print(f"완료: high lod {saved}개 저장 (mid/low는 Douglas-Peucker 자동 생성)")

        # 검증: km 범위 확인
        result = db.execute(
            text("""
                SELECT COUNT(*), MIN(km), MAX(km)
                FROM route_geometry
                WHERE route_code = :code AND source = 'user' AND lod = 'high'
            """),
            {"code": ROUTE_CODE},
        ).fetchone()
        print(f"검증 — 저장된 행: {result[0]}개, km {result[1]:.1f} ~ {result[2]:.1f}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
