#!/usr/bin/env python3
"""
import_shp_to_geometry.py — 국가기본도_철도중심선 SHP → route_geometry 테이블

원본 데이터: 국가공간정보포털 TN_RLROAD_CTLN
  - 좌표계: EPSG:5179 (Korea_2000_Unified, TM)
  - 속성: RLWAY_NM(노선명), RLROAD_SE(철도구분), RLWTY_SE(선로유형)
  - 필터: RLROAD_SE IN (RRC001,RRC002) AND RLWTY_SE = RRT001 (KORAIL 철도중심선)

변환:
  - EPSG:5179 → EPSG:4326 (WGS84)
  - 노선명 → route_code (ROUTE_MAP 참조)
  - segment=0: 하선, segment=1: 상선 (SHP에 방향 정보 없어 segment=0 단일 저장)
  - km=NULL (SHP에 KORAIL 공식 거리정 없음 — facilities 입력 후 갱신)
  - LOD 3단계 생성 (high/mid/low)

실행:
    cd maps
    python3 pipeline/import_shp_to_geometry.py --route gyeongbu
    python3 pipeline/import_shp_to_geometry.py --all
    python3 pipeline/import_shp_to_geometry.py --list      # 매핑 가능 노선 목록
"""

import argparse
import sqlite3
import sys
from pathlib import Path

import pyproj
import shapefile
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge, unary_union

MAPS_DIR = Path(__file__).parent.parent
DB_PATH  = MAPS_DIR.parent / "backend" / "db.sqlite3"
SHP_PATH = MAPS_DIR / "raw" / "railway_line" / "TN_RLROAD_CTLN"

# 좌표 변환: EPSG:5179(한국 TM) → EPSG:4326(WGS84)
TRANSFORMER = pyproj.Transformer.from_crs("EPSG:5179", "EPSG:4326", always_xy=True)

# 국가기본도 노선명 → 이 프로젝트 route_code 매핑
# 여러 노선명이 같은 코드로 매핑될 수 있음 (별칭 포함)
ROUTE_MAP: dict[str, str] = {
    # ── 고속철도 (RRC001) ──────────────────────────────────────
    "경부고속철도":         "gyeongbu_high",
    "경부고속철도서해선":   "suseo_pyeongtaek",   # 수서~평택고속선
    "호남고속철도":         "honam_high",
    "KTX강릉선":            "gangneung",
    "강릉선":               "gangneung",
    "KTX동해선":            "donghae_ktx",
    "KTX중부내륙선":        "jungbu_naeryuk",

    # ── 보통철도 간선 (RRC002) ────────────────────────────────
    "경부선":               "gyeongbu",
    "호남선":               "honam",
    "전라선":               "jeolla",
    "경전선":               "gyeongjeon",
    "동해선":               "donghae",
    "동해남부선":           "donghae",            # 동해남부선 = 동해선 일부
    "중앙선":               "jungang",
    "태백선":               "taebaek",
    "영동선":               "yeongdong",
    "경춘선":               "gyeongchun",
    "경강선":               "gyeonggang",         # 성남~여주
    "장항선":               "janghang",
    "충북선":               "chungbuk",
    "경원선":               "gyeongwon",
    "경의선":               "gyeongui",
    "경인선":               "gyeongin",
    "진해선":               "jinhae",
    "가야선":               "gaya",
    "중부내륙선":           "jungbu_naeryuk",     # KTX중부내륙선 일반선 구간

    # ── 보통철도 지선 (RRC002) ────────────────────────────────
    "경북선":               "gyeongbuk",
    "광주선":               "gwangju_line",
    "괴동선":               "goeodong",
    "교외선":               "gyooe",
    "군산선":               "gunsan",
    "군산항선":             "gunsan_port",
    "대구선":               "daegu_line",
    "대불선":               "daebul",
    "덕산선":               "deoksan",
    "묵호항선":             "mukho",
    "문경선":               "mungyeong",
    "부산신항선":           "busan_sinhang",
    "부전마산선":           "bujeon_masan",
    "북전주선":             "buk_jeonju",
    "북평선":               "buk_pyeong",
    "삼척선":               "samcheok",
    "서해선":               "seohae",
    "여천선":               "yeocheon",
    "연무선":               "yeonmu",
    "온산선":               "onsan",
    "정선선":               "jeongseon",
    "평택선":               "pyeongtaek",
    "포항영일항만선":       "pohang_yoil",
    "함백선":               "hambak",
    "화순선":               "hwasun",
    "가은선":               "gaeun",

    # ── 지하철(지상) (RRC004) ─────────────────────────────────
    "수인선":               "suin",
    "수인분당선":           "suin",               # 수인선과 통합 운영
    "분당선":               "bundang",
}

LOD_TOLERANCE = {
    "high": None,
    "mid":  0.0001,   # SHP 좌표 밀도가 높으므로 OSM보다 타이트하게
    "low":  0.0005,
}


def tm_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """EPSG:5179 TM 좌표 → WGS84 (lat, lon)"""
    lon, lat = TRANSFORMER.transform(x, y)
    return lat, lon


def load_shp_records() -> dict[str, list]:
    """
    SHP 파일에서 KORAIL 철도중심선 레코드를 route_code별로 그룹핑.
    반환: {route_code: [shapely LineString, ...]}
    """
    sf = shapefile.Reader(str(SHP_PATH), encoding="cp949")
    field_names = [f[0] for f in sf.fields[1:]]

    route_lines: dict[str, list] = {}

    for shp, rec in zip(sf.shapes(), sf.records()):
        d = dict(zip(field_names, rec))
        rlroad_se = d.get("RLROAD_SE", "").strip()
        rlwty_se  = d.get("RLWTY_SE",  "").strip()
        rlway_nm  = d.get("RLWAY_NM",  "").strip()

        # 고속철도(RRC001), 보통철도(RRC002), 도시철도(RRC004) 중심선
        if rlroad_se not in ("RRC001", "RRC002", "RRC004"):
            continue
        if rlwty_se != "RRT001":
            continue
        if not rlway_nm:
            continue

        route_code = ROUTE_MAP.get(rlway_nm)
        if route_code is None:
            continue

        if len(shp.points) < 2:
            continue

        # TM → WGS84 변환
        coords_wgs84 = []
        for x, y in shp.points:
            lat, lon = tm_to_wgs84(x, y)
            coords_wgs84.append((lon, lat))  # shapely: (x=lon, y=lat)

        try:
            line = LineString(coords_wgs84)
            if line.is_valid and not line.is_empty:
                route_lines.setdefault(route_code, []).append(line)
        except Exception:
            continue

    sf.close()
    return route_lines


def merge_lines(lines: list) -> list[list[tuple[float, float]]]:
    """
    여러 LineString을 segment별 좌표 목록으로 병합.
    linemerge로 연결 가능한 선분은 이어붙이고,
    연결 불가한 선분은 별도 segment로 분리 저장 (버리지 않음).

    반환: [[(lat, lon), ...], [(lat, lon), ...], ...]
          segment=0이 가장 긴 선분(본선), 이후는 길이 내림차순 정렬.
    """
    merged = linemerge(lines)

    if isinstance(merged, LineString):
        geoms = [merged]
    elif isinstance(merged, MultiLineString):
        geoms = list(merged.geoms)
    else:
        return []

    # 길이 내림차순 정렬 (segment=0 = 본선)
    geoms.sort(key=lambda g: g.length, reverse=True)

    result = []
    for geom in geoms:
        coords = [(lat, lon) for lon, lat in geom.coords]
        if len(coords) >= 2:
            result.append(coords)

    return result


def simplify_line(coords: list[tuple[float, float]],
                  tolerance: float | None) -> list[tuple[float, float]]:
    """Douglas-Peucker 간소화. coords: [(lat, lon), ...]"""
    if tolerance is None or len(coords) < 3:
        return coords

    xy = [(lon, lat) for lat, lon in coords]
    simplified = LineString(xy).simplify(tolerance, preserve_topology=True)
    simplified_set = set(simplified.coords)

    result = [(lat, lon) for lat, lon in coords if (lon, lat) in simplified_set]
    if coords[0] not in result:
        result.insert(0, coords[0])
    if coords[-1] not in result:
        result.append(coords[-1])
    return result


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


def save_geometry(conn: sqlite3.Connection, route_code: str,
                  segments: list[list[tuple[float, float]]]) -> None:
    """
    LOD 3단계 × segment별로 route_geometry에 저장.
    segments[0] = 가장 긴 선분(본선, segment=0)
    segments[1+] = 나머지 조각(지선·단절구간, segment=1, 2, ...)
    """
    conn.execute("DELETE FROM route_geometry WHERE route_code=?", (route_code,))

    for lod, tolerance in LOD_TOLERANCE.items():
        total_pts = 0
        for seg_idx, coords in enumerate(segments):
            simplified = simplify_line(coords, tolerance)
            rows = [
                (route_code, lod, seg_idx, seq, lat, lon, None)
                for seq, (lat, lon) in enumerate(simplified)
            ]
            conn.executemany(
                "INSERT INTO route_geometry (route_code,lod,segment,seq,lat,lon,km) "
                "VALUES (?,?,?,?,?,?,?)",
                rows,
            )
            total_pts += len(rows)
        tag = "(원본)" if tolerance is None else f"(tolerance={tolerance})"
        print(f"    {lod:4s}: {total_pts:6d}개 좌표 / {len(segments)}개 segment {tag}")

    conn.commit()


def import_route(conn: sqlite3.Connection, route_code: str,
                 route_lines: dict[str, list]) -> bool:
    lines = route_lines.get(route_code)
    if not lines:
        print(f"  [{route_code}] SHP에 해당 노선 없음")
        return False

    print(f"\n  [{route_code}] 선분 {len(lines)}개 병합 중...")
    segments = merge_lines(lines)
    if not segments:
        print(f"  [{route_code}] 유효 좌표 부족")
        return False

    total_pts = sum(len(s) for s in segments)
    print(f"  [{route_code}] 병합 완료 — {len(segments)}개 segment, 총 {total_pts}개 좌표 → LOD 저장:")
    save_geometry(conn, route_code, segments)
    return True


def list_mappable(route_lines: dict[str, list]) -> None:
    print("\n=== 매핑 가능 노선 (SHP ↔ route_code) ===")
    conn = sqlite3.connect(str(DB_PATH))
    db_codes = {r[0] for r in conn.execute("SELECT code FROM routes").fetchall()}
    conn.close()

    for nm, code in sorted(ROUTE_MAP.items(), key=lambda x: x[1]):
        shp_ok = "✅" if code in route_lines else "❌"
        db_ok  = "✅" if code in db_codes else "❌(DB없음)"
        print(f"  {nm:20s} → {code:20s}  SHP:{shp_ok}  DB:{db_ok}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="국가기본도_철도중심선 SHP → route_geometry 테이블 import")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--route",  help="단일 노선 코드 (예: gyeongbu)")
    group.add_argument("--all",    action="store_true", help="매핑 가능한 전체 노선")
    group.add_argument("--list",   action="store_true", help="매핑 가능 노선 목록만 출력")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"[오류] DB 파일 없음: {DB_PATH}")
        sys.exit(1)
    if not SHP_PATH.with_suffix(".shp").exists():
        print(f"[오류] SHP 파일 없음: {SHP_PATH}.shp")
        sys.exit(1)

    print("SHP 파일 로딩 중...")
    route_lines = load_shp_records()
    print(f"로딩 완료 — {len(route_lines)}개 노선 추출됨: {sorted(route_lines.keys())}")

    if args.list:
        list_mappable(route_lines)
        return

    conn = sqlite3.connect(str(DB_PATH))
    ensure_route_geometry_table(conn)

    print("\n" + "=" * 60)

    if args.all:
        conn_codes = {r[0] for r in conn.execute("SELECT code FROM routes").fetchall()}
        targets = [c for c in route_lines if c in conn_codes]
        print(f"  전체 노선 import ({len(targets)}개)")
    else:
        targets = [args.route]
        print(f"  단일 노선 import: {args.route}")

    print("=" * 60)

    success = 0
    for code in targets:
        if import_route(conn, code, route_lines):
            success += 1

    conn.close()
    print(f"\n완료 — {success}/{len(targets)}개 노선 처리")


if __name__ == "__main__":
    main()
