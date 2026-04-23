#!/usr/bin/env python3
"""
import_geometry.py — 노선 GeoJSON 좌표를 SQLite route_geometry 테이블에 저장한다.

핵심 원칙:
  - shapely.ops.linemerge() 로 끝점이 연결되는 OSM way 조각들만 이어붙인다.
  - 연결되지 않는 구간(상선/하선 등)은 별도 segment(0,1,2...)로 저장한다.
  - D3는 segment별로 별도 <path>를 그리므로 거미줄이 발생하지 않는다.
  - Douglas-Peucker 알고리즘으로 LOD 3단계(high/mid/low)를 생성한다.

실행:
    cd maps
    python3 pipeline/import_geometry.py --route gyeongbu
    python3 pipeline/import_geometry.py --all
    python3 pipeline/import_geometry.py --verify gyeongbu
"""

import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path

from shapely.geometry import LineString, MultiLineString, shape
from shapely.ops import linemerge

MAPS_DIR      = Path(__file__).parent.parent
PROCESSED_DIR = MAPS_DIR / "processed"
DB_PATH       = MAPS_DIR.parent / "backend" / "db.sqlite3"

LOD_CONFIG = {
    "high": None,    # 원본 OSM 그대로
    "mid":  0.001,   # ~100m 간소화
    "low":  0.005,   # ~500m 간소화
}

ALL_ROUTES = [
    "gyeongbu", "gyeongbu_high", "honam", "honam_high", "jeolla",
    "gyeongjeon", "donghae", "jungang", "taebaek", "yeongdong",
    "gangneung", "gyeongchun", "gyeonggang", "janghang", "chungbuk",
    "gyeongwon", "gyeongui", "gyeongin", "jinhae", "gaya",
]


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS route_geometry (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            route_code TEXT    NOT NULL,
            lod        TEXT    NOT NULL,
            segment    INTEGER NOT NULL DEFAULT 0,
            seq        INTEGER NOT NULL,
            lat        REAL    NOT NULL,
            lon        REAL    NOT NULL,
            km         REAL,
            UNIQUE (route_code, lod, segment, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_rg_route_lod
            ON route_geometry (route_code, lod);
    """)
    conn.commit()


def geojson_to_segments(geojson_path: Path) -> list[LineString]:
    """
    GeoJSON의 모든 LineString/MultiLineString을 읽어
    shapely.ops.linemerge() 로 연결 가능한 것끼리 이어붙인다.

    반환: 연결된 LineString 목록 (상선/하선 등이 분리된 경우 여러 개)
    """
    with open(geojson_path, encoding="utf-8") as f:
        geojson = json.load(f)

    lines: list[LineString] = []
    for feature in geojson.get("features", []):
        geom = shape(feature["geometry"])
        if isinstance(geom, LineString):
            lines.append(geom)
        elif isinstance(geom, MultiLineString):
            lines.extend(geom.geoms)

    if not lines:
        raise ValueError("GeoJSON에 유효한 LineString 없음")

    merged = linemerge(lines)

    if isinstance(merged, LineString):
        return [merged]
    elif isinstance(merged, MultiLineString):
        return list(merged.geoms)
    else:
        return lines


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """두 WGS84 좌표 사이의 Haversine 거리 (km)"""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def compute_segment_km(segment: LineString) -> list[float]:
    """segment 내 각 점의 누적 거리(km) 반환 — 첫 점 = 0.0"""
    coords = list(segment.coords)
    km_values = [0.0]
    for i in range(1, len(coords)):
        lon1, lat1 = coords[i - 1]
        lon2, lat2 = coords[i]
        km_values.append(km_values[-1] + haversine_km(lat1, lon1, lat2, lon2))
    return km_values


def simplify(line: LineString, tolerance: float | None) -> LineString:
    if tolerance is None:
        return line
    return line.simplify(tolerance, preserve_topology=True)


def save_to_db(conn: sqlite3.Connection, route_code: str, lod: str,
               segments: list[LineString]) -> int:
    """
    segments를 DB에 저장한다.
    km = 노선 전체 기준 누적 Haversine 거리(km).
      - segment 0의 첫 점 = km 0.0
      - segment 간 점프 거리는 제외하고 각 segment 길이만 누적
    """
    conn.execute(
        "DELETE FROM route_geometry WHERE route_code = ? AND lod = ?",
        (route_code, lod),
    )
    rows = []
    cumulative_km = 0.0

    for seg_idx, line in enumerate(segments):
        seg_km = compute_segment_km(line)
        for seq, ((lon, lat), km) in enumerate(zip(line.coords, seg_km)):
            rows.append((route_code, lod, seg_idx, seq, lat, lon, cumulative_km + km))
        cumulative_km += seg_km[-1] if seg_km else 0.0

    conn.executemany(
        "INSERT INTO route_geometry "
        "(route_code, lod, segment, seq, lat, lon, km) VALUES (?,?,?,?,?,?,?)",
        rows,
    )
    conn.commit()
    return len(rows)


def verify(conn: sqlite3.Connection, route_code: str) -> None:
    print(f"\n[검증] {route_code}")
    for lod in ("high", "mid", "low"):
        row = conn.execute(
            "SELECT COUNT(*), MAX(segment)+1, COUNT(km) FROM route_geometry "
            "WHERE route_code = ? AND lod = ?",
            (route_code, lod),
        ).fetchone()
        cnt, n_seg, km_cnt = row
        if cnt == 0:
            print(f"  {lod:4s}: 없음")
        else:
            km_row = conn.execute(
                "SELECT MIN(km), MAX(km) FROM route_geometry "
                "WHERE route_code = ? AND lod = ?",
                (route_code, lod),
            ).fetchone()
            km_str = f"km {km_row[0]:.1f}~{km_row[1]:.1f}" if km_row[0] is not None else "km NULL"
            print(
                f"  {lod:4s}: {cnt:6,}개 좌표 / {n_seg}개 segment / {km_str}  "
                f"(km_not_null={km_cnt})"
            )


def process_route(conn: sqlite3.Connection, route_code: str) -> bool:
    geojson_path = PROCESSED_DIR / f"{route_code}.geojson"
    if not geojson_path.exists():
        print(f"  [경고] {geojson_path.name} 없음 — extract_routes.py 먼저 실행")
        return False

    print(f"\n  [{route_code}]")
    try:
        segments_high = geojson_to_segments(geojson_path)
        total_pts = sum(len(list(s.coords)) for s in segments_high)
        print(f"    high: {total_pts:,}개 좌표 / {len(segments_high)}개 segment (원본)")
    except Exception as e:
        print(f"    [오류] GeoJSON 파싱 실패: {e}")
        return False

    for lod, tolerance in LOD_CONFIG.items():
        simplified = [simplify(s, tolerance) for s in segments_high]
        cnt = save_to_db(conn, route_code, lod, simplified)
        tag = "(원본)" if tolerance is None else f"(tolerance={tolerance})"
        print(f"    {lod:4s}: {cnt:6,}개 좌표 / {len(simplified)}개 segment 저장  {tag}")

    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="노선 GeoJSON → SQLite 저장 (LOD 3단계)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--route",  choices=ALL_ROUTES, help="단일 노선 코드")
    group.add_argument("--all",    action="store_true", help="전체 노선")
    group.add_argument("--verify", metavar="ROUTE",    help="저장 결과 확인")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"[오류] DB 파일 없음: {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    ensure_table(conn)

    if args.verify:
        verify(conn, args.verify)
        conn.close()
        return

    target = ALL_ROUTES if args.all else [args.route]
    print("=" * 60)
    print(f"  노선 GeoJSON → SQLite ({'전체' if args.all else args.route})")
    print("=" * 60)

    success = 0
    for code in target:
        if process_route(conn, code):
            success += 1

    print(f"\n완료 — {success}/{len(target)}개 노선 저장")
    conn.close()


if __name__ == "__main__":
    main()
