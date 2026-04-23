#!/usr/bin/env python3
"""
호남선 SHP geometry → source='user' geometry 변환 스크립트

SHP source='shp' 데이터를 읽어 Haversine 누적 거리로 km 값을 부여한 뒤
source='user' 로 저장한다. KORAIL 공식 선로제원표 데이터가 없을 때의 임시 방법.

호남선 특성:
  - 방향: 서대전(북, ~36.3°) → 목포(남, ~34.8°) — 위도 내림차순 정렬
  - km 범위: 0.0 ~ 251.5 km

실행:
  cd track-block-management
  source backend/.venv/bin/activate
  python3 scripts/honam_shp_to_user.py

주의: km 값은 Haversine 비율 추정값. 추후 KORAIL 공식 데이터로 교체 필요.
"""

import math
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
import os
os.chdir(BACKEND_DIR)

from sqlalchemy import text

from app.core.database import SessionLocal
from app.services.geometry_service import save_geometry_user

ROUTE_CODE = "honam"


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
        # 노선 km 범위 조회
        route = db.execute(
            text("SELECT start_km, end_km FROM routes WHERE code = :code"),
            {"code": ROUTE_CODE},
        ).fetchone()
        if not route:
            print(f"[오류] 노선 '{ROUTE_CODE}' 없음 — routes 테이블 확인 필요")
            sys.exit(1)

        route_start, route_end = route.start_km, route.end_km
        print(f"호남선 km 범위: {route_start} ~ {route_end} km")

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
            print("[오류] SHP geometry 없음 — 노선도 관리에서 SHP import 먼저 실행 필요")
            sys.exit(1)

        print(f"SHP 포인트: {len(shp_rows)}개 (lod={used_lod})")

        # segment별로 그룹화
        seg_map: dict[int, list] = {}
        for row in shp_rows:
            seg_map.setdefault(row.segment, []).append(row)

        print(f"segment 수: {len(seg_map)}개")

        # 호남선: 서대전(북, 고위도) → 목포(남, 저위도)
        # segment를 평균 위도 내림차순(북→남)으로 정렬
        sorted_segs = sorted(
            seg_map.items(),
            key=lambda kv: sum(r.lat for r in kv[1]) / len(kv[1]),
            reverse=True,   # 고위도(서대전) → 저위도(목포)
        )

        # 정렬 결과 미리보기
        print("segment 정렬 순서 (위도 내림차순):")
        for seg_id, pts in sorted_segs[:5]:
            avg_lat = sum(r.lat for r in pts) / len(pts)
            print(f"  segment={seg_id:3d}  pts={len(pts):4d}  avg_lat={avg_lat:.4f}")
        if len(sorted_segs) > 5:
            print(f"  ... ({len(sorted_segs) - 5}개 더)")

        # 정렬된 순서로 포인트 연결 (segment 내부는 seq 순)
        ordered_points: list = []
        for _, rows_in_seg in sorted_segs:
            ordered_points.extend(sorted(rows_in_seg, key=lambda r: r.seq))

        # Haversine 누적 거리 계산
        cumulative: list[float] = [0.0]
        for i in range(1, len(ordered_points)):
            p, c = ordered_points[i - 1], ordered_points[i]
            cumulative.append(cumulative[-1] + haversine_km(p.lat, p.lon, c.lat, c.lon))

        total_dist = cumulative[-1]
        print(f"Haversine 총 거리: {total_dist:.2f} km (segment 간 점프 포함)")

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

        print(f"source='user'로 저장 중... (high/mid/low LOD 자동 생성)")
        saved = save_geometry_user(db, ROUTE_CODE, rows)
        print(f"완료: high lod {saved}개 저장 (mid/low는 Douglas-Peucker 자동 생성)")

        # 검증
        result = db.execute(
            text("""
                SELECT COUNT(*), MIN(km), MAX(km)
                FROM route_geometry
                WHERE route_code = :code AND source = 'user' AND lod = 'high'
            """),
            {"code": ROUTE_CODE},
        ).fetchone()
        print(f"검증 — 저장된 행: {result[0]}개, km {result[1]:.1f} ~ {result[2]:.1f}")
        print()
        print("다음 단계:")
        print("  1. 브라우저에서 노선도 확인 (호남선이 점선→실선으로 변경)")
        print("  2. 노선도가 올바르면 노선도 관리에서 [SHP 삭제] 실행")
        print("  3. 추후 KORAIL 공식 선로제원표 데이터 확보 시 CSV 업로드로 교체")

    finally:
        db.close()


if __name__ == "__main__":
    main()
