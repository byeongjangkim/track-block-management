#!/usr/bin/env python3
"""
build_geometry_from_facilities.py — facilities 테이블 → route_geometry 테이블 생성

핵심 원칙:
  - facilities(사용자 입력 KORAIL 공식 데이터)가 노선 기하학의 SOT다.
  - route_geometry는 이 스크립트로만 갱신한다. 직접 편집 금지.
  - segment 정의:
      segment=0 : 하선(DOWN) 본선  direction='DOWN' or 'BOTH'
      segment=1 : 상선(UP)  본선  direction='UP'  or 'BOTH'
      segment=2+: 부본선·측선     JUNCTION 타입 정의 구간 (미구현)
  - LOD:
      high : facilities 원본 좌표 그대로
      mid  : Douglas-Peucker tolerance=0.001
      low  : Douglas-Peucker tolerance=0.005

실행:
    cd maps
    python3 pipeline/build_geometry_from_facilities.py --route gyeongbu
    python3 pipeline/build_geometry_from_facilities.py --all
    python3 pipeline/build_geometry_from_facilities.py --verify gyeongbu
"""

import argparse
import math
import sqlite3
import sys
from pathlib import Path

from shapely.geometry import LineString

MAPS_DIR = Path(__file__).parent.parent
DB_PATH  = MAPS_DIR.parent / "backend" / "db.sqlite3"

LOD_TOLERANCE = {
    "high": None,
    "mid":  0.001,
    "low":  0.005,
}

# segment 번호 → direction 필터
SEGMENT_DIRECTIONS = {
    0: ("DOWN", "BOTH"),  # 하선 본선
    1: ("UP",   "BOTH"),  # 상선 본선
}


def get_all_route_codes(conn: sqlite3.Connection) -> list[str]:
    return [r[0] for r in conn.execute("SELECT code FROM routes ORDER BY code").fetchall()]


def get_route_id(conn: sqlite3.Connection, route_code: str) -> int | None:
    row = conn.execute("SELECT id FROM routes WHERE code=?", (route_code,)).fetchone()
    return row[0] if row else None


def fetch_anchors(conn: sqlite3.Connection, route_id: int,
                  directions: tuple[str, ...]) -> list[tuple[float, float, float]]:
    """
    use_as_anchor=True 이고 direction이 지정 값 중 하나이거나 NULL인 시설물을
    km 오름차순으로 반환. (km, lat, lon)
    NULL direction은 건널목·변전소 등 방향 무관 시설 — anchor 대상이면 포함.
    """
    placeholders = ",".join("?" * len(directions))
    rows = conn.execute(
        f"""
        SELECT km, lat, lon FROM facilities
        WHERE route_id=?
          AND use_as_anchor=1
          AND lat IS NOT NULL
          AND lon IS NOT NULL
          AND (direction IN ({placeholders}) OR direction IS NULL)
        ORDER BY km
        """,
        (route_id, *directions),
    ).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]


def simplify_line(coords: list[tuple[float, float, float]],
                  tolerance: float | None) -> list[tuple[float, float, float]]:
    """
    Douglas-Peucker 간소화.
    coords: [(km, lat, lon), ...]
    반환: 간소화된 동일 형식 리스트
    """
    if tolerance is None or len(coords) < 3:
        return coords

    # shapely는 (x, y) 기준 — lon=x, lat=y 사용
    xy = [(lon, lat) for _, lat, lon in coords]
    line = LineString(xy)
    simplified = line.simplify(tolerance, preserve_topology=True)
    simplified_coords = set(simplified.coords)

    # 원본 coords 중 simplified에 포함된 점만 유지 (km 보존)
    result = [
        (km, lat, lon)
        for km, lat, lon in coords
        if (lon, lat) in simplified_coords
    ]
    # 시작·끝점 항상 포함
    if coords[0] not in result:
        result.insert(0, coords[0])
    if coords[-1] not in result:
        result.append(coords[-1])
    return result


def save_segment(conn: sqlite3.Connection, route_code: str, lod: str,
                 seg_idx: int, coords: list[tuple[float, float, float]]) -> int:
    """(km, lat, lon) 목록을 route_geometry에 저장."""
    conn.execute(
        "DELETE FROM route_geometry WHERE route_code=? AND lod=? AND segment=?",
        (route_code, lod, seg_idx),
    )
    rows = [
        (route_code, lod, seg_idx, seq, lat, lon, km)
        for seq, (km, lat, lon) in enumerate(coords)
    ]
    conn.executemany(
        "INSERT INTO route_geometry (route_code,lod,segment,seq,lat,lon,km) "
        "VALUES (?,?,?,?,?,?,?)",
        rows,
    )
    return len(rows)


def ensure_route_geometry_table(conn: sqlite3.Connection) -> None:
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


def build_route(conn: sqlite3.Connection, route_code: str) -> bool:
    route_id = get_route_id(conn, route_code)
    if route_id is None:
        print(f"  [오류] 노선 '{route_code}' DB에 없음")
        return False

    print(f"\n  [{route_code}]")

    # 기존 route_geometry 전체 삭제 후 재생성
    conn.execute("DELETE FROM route_geometry WHERE route_code=?", (route_code,))

    built_any = False
    for seg_idx, directions in SEGMENT_DIRECTIONS.items():
        anchors = fetch_anchors(conn, route_id, directions)
        if len(anchors) < 2:
            seg_name = "하선(DOWN)" if seg_idx == 0 else "상선(UP)"
            print(f"    segment={seg_idx} ({seg_name}): anchor 부족 ({len(anchors)}개) — 건너뜀")
            continue

        seg_name = "하선(DOWN)" if seg_idx == 0 else "상선(UP)"
        for lod, tolerance in LOD_TOLERANCE.items():
            simplified = simplify_line(anchors, tolerance)
            cnt = save_segment(conn, route_code, lod, seg_idx, simplified)
            tag = "(원본)" if tolerance is None else f"(tolerance={tolerance})"
            print(f"    segment={seg_idx} {seg_name} / {lod:4s}: {cnt:4d}개 좌표 {tag}")
        built_any = True

    if built_any:
        conn.commit()
    return built_any


def verify(conn: sqlite3.Connection, route_code: str) -> None:
    print(f"\n[검증] {route_code}")
    for lod in ("high", "mid", "low"):
        rows = conn.execute(
            "SELECT segment, COUNT(*) as pts, COUNT(km) as km_cnt, "
            "MIN(km) as km_min, MAX(km) as km_max "
            "FROM route_geometry WHERE route_code=? AND lod=? GROUP BY segment ORDER BY segment",
            (route_code, lod),
        ).fetchall()
        if not rows:
            print(f"  {lod:4s}: 없음")
            continue
        for seg, pts, km_cnt, km_min, km_max in rows:
            seg_name = {0: "하선", 1: "상선"}.get(seg, f"측선{seg}")
            km_str = f"km {km_min:.1f}~{km_max:.1f}" if km_min is not None else "km NULL"
            null_warn = " ⚠ km NULL 있음" if km_cnt < pts else ""
            print(f"  {lod:4s} / segment={seg}({seg_name}): {pts}개 좌표 / {km_str}{null_warn}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="facilities → route_geometry 생성 (LOD 3단계, 상/하선 분리)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--route",  help="단일 노선 코드")
    group.add_argument("--all",    action="store_true", help="전체 노선")
    group.add_argument("--verify", metavar="ROUTE", help="저장 결과 확인")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"[오류] DB 파일 없음: {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    ensure_route_geometry_table(conn)

    if args.verify:
        verify(conn, args.verify)
        conn.close()
        return

    if args.all:
        targets = get_all_route_codes(conn)
    else:
        targets = [args.route]

    print("=" * 60)
    print(f"  facilities → route_geometry ({'전체' if args.all else targets[0]})")
    print("=" * 60)

    success = 0
    for code in targets:
        if build_route(conn, code):
            success += 1

    print(f"\n완료 — {success}/{len(targets)}개 노선 처리")
    conn.close()


if __name__ == "__main__":
    main()
