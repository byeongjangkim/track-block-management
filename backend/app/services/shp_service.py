"""
shp_service.py — 국가기본도_철도중심선 SHP 파싱 및 route_geometry DB 저장 서비스

maps/pipeline/import_shp_to_geometry.py 의 핵심 로직을 백엔드 API에서 사용 가능하도록 모듈화.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pyproj
import shapefile
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge
from sqlalchemy import text
from sqlalchemy.orm import Session

# ── 경로 설정 ─────────────────────────────────────────────────────────────
# backend/app/services/shp_service.py → 4단계 상위 = 프로젝트 루트
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
SHP_PATH = _PROJECT_ROOT / "maps" / "raw" / "railway_line" / "TN_RLROAD_CTLN"

# ── 좌표 변환: EPSG:5179(한국 TM) → EPSG:4326(WGS84) ────────────────────
_TRANSFORMER = pyproj.Transformer.from_crs("EPSG:5179", "EPSG:4326", always_xy=True)

# ── 철도구분 코드 레이블 ──────────────────────────────────────────────────
SHP_CLASS_LABEL: dict[str, str] = {
    "RRC001": "고속철도",
    "RRC002": "보통철도",
    "RRC003": "전용철도",
    "RRC004": "도시철도",
    "RRC005": "삭도",
    "RRC006": "기타",
    "RRC999": "기타",
}

# ── 이 프로젝트에서 관리하는 노선 — 한국어명 → route_code ─────────────
ROUTE_MAP: dict[str, str] = {
    # 고속철도 (RRC001)
    "경부고속철도":         "gyeongbu_high",
    "경부고속철도서해선":   "suseo_pyeongtaek",
    "호남고속철도":         "honam_high",
    "KTX강릉선":            "gangneung",
    "강릉선":               "gangneung",
    "KTX동해선":            "donghae_ktx",
    "KTX중부내륙선":        "jungbu_naeryuk",
    # 보통철도 간선 (RRC002)
    "경부선":               "gyeongbu",
    "호남선":               "honam",
    "전라선":               "jeolla",
    "경전선":               "gyeongjeon",
    "동해선":               "donghae",
    "동해남부선":           "donghae",
    "중앙선":               "jungang",
    "태백선":               "taebaek",
    "영동선":               "yeongdong",
    "경춘선":               "gyeongchun",
    "경강선":               "gyeonggang",
    "장항선":               "janghang",
    "충북선":               "chungbuk",
    "경원선":               "gyeongwon",
    "경의선":               "gyeongui",
    "경인선":               "gyeongin",
    "진해선":               "jinhae",
    "가야선":               "gaya",
    "중부내륙선":           "jungbu_naeryuk",
    # 보통철도 지선 (RRC002)
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
    # 도시철도(지상) — KORAIL 운영 (RRC004)
    "수인선":               "suin",
    "수인분당선":           "suin",
    "분당선":               "bundang",
}

LOD_TOLERANCE: dict[str, float | None] = {
    "high": None,
    "mid":  0.0001,
    "low":  0.0005,
}


def shp_available() -> bool:
    """SHP 파일 존재 여부"""
    return SHP_PATH.with_suffix(".shp").exists()


def _tm_to_wgs84(x: float, y: float) -> tuple[float, float]:
    lon, lat = _TRANSFORMER.transform(x, y)
    return lat, lon


def _simplify(coords: list[tuple[float, float]],
               tolerance: float | None) -> list[tuple[float, float]]:
    if tolerance is None or len(coords) < 3:
        return coords
    xy = [(lon, lat) for lat, lon in coords]
    simp = LineString(xy).simplify(tolerance, preserve_topology=True)
    simp_set = set(simp.coords)
    result = [(lat, lon) for lat, lon in coords if (lon, lat) in simp_set]
    if coords[0] not in result:
        result.insert(0, coords[0])
    if coords[-1] not in result:
        result.append(coords[-1])
    return result


def _merge_to_segments(lines: list) -> list[list[tuple[float, float]]]:
    """
    여러 LineString → segment별 좌표 목록.
    segment=0 이 가장 긴 선분(본선), 이후는 길이 내림차순.
    """
    merged = linemerge(lines)
    if isinstance(merged, LineString):
        geoms = [merged]
    elif isinstance(merged, MultiLineString):
        geoms = list(merged.geoms)
    else:
        return []
    geoms.sort(key=lambda g: g.length, reverse=True)
    result = []
    for g in geoms:
        coords = [(lat, lon) for lon, lat in g.coords]
        if len(coords) >= 2:
            result.append(coords)
    return result


def load_shp_route_index() -> dict[str, list]:
    """
    SHP 전체를 읽어 route_code → [LineString, ...] 로 그룹핑 반환.
    ROUTE_MAP에 등록된 노선명만 포함.
    """
    sf = shapefile.Reader(str(SHP_PATH), encoding="cp949")
    field_names = [f[0] for f in sf.fields[1:]]
    route_lines: dict[str, list] = {}

    for shp, rec in zip(sf.shapes(), sf.records()):
        d = dict(zip(field_names, rec))
        rlroad_se = d.get("RLROAD_SE", "").strip()
        rlwty_se  = d.get("RLWTY_SE",  "").strip()
        rlway_nm  = d.get("RLWAY_NM",  "").strip()

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

        coords_wgs84 = []
        for x, y in shp.points:
            lat, lon = _tm_to_wgs84(x, y)
            coords_wgs84.append((lon, lat))

        try:
            line = LineString(coords_wgs84)
            if line.is_valid and not line.is_empty:
                route_lines.setdefault(route_code, []).append(line)
        except Exception:
            continue

    sf.close()
    return route_lines


def list_shp_routes(db: Session) -> list[dict[str, Any]]:
    """
    SHP 내 노선 목록 반환.
    각 항목: {name_kr, route_code, shp_class, record_count, in_db, has_geometry}
    """
    if not shp_available():
        return []

    sf = shapefile.Reader(str(SHP_PATH), encoding="cp949")
    field_names = [f[0] for f in sf.fields[1:]]

    # 노선명별 (한국어) 집계
    name_stats: dict[str, dict] = {}
    for rec in sf.records():
        d = dict(zip(field_names, rec))
        rlroad_se = d.get("RLROAD_SE", "").strip()
        rlwty_se  = d.get("RLWTY_SE",  "").strip()
        rlway_nm  = d.get("RLWAY_NM",  "").strip()
        if not rlway_nm or rlwty_se != "RRT001":
            continue
        if rlroad_se not in ("RRC001", "RRC002", "RRC004"):
            continue
        key = rlway_nm
        if key not in name_stats:
            name_stats[key] = {"shp_class": rlroad_se, "count": 0}
        name_stats[key]["count"] += 1
    sf.close()

    # DB 정보 조회
    db_codes: set[str] = {
        r[0] for r in db.execute(text("SELECT code FROM routes")).fetchall()
    }
    geo_codes: set[str] = {
        r[0] for r in db.execute(
            text("SELECT DISTINCT route_code FROM route_geometry WHERE lod='high' AND source='shp'")
        ).fetchall()
    }

    # route_code 기준으로 집계 (동일 route_code에 여러 한국어명이 매핑될 수 있음)
    code_info: dict[str, dict] = {}
    for nm, stat in name_stats.items():
        rc = ROUTE_MAP.get(nm)
        if rc is None:
            continue
        if rc not in code_info:
            code_info[rc] = {
                "route_code":   rc,
                "name_kr":      nm,
                "shp_class":    SHP_CLASS_LABEL.get(stat["shp_class"], stat["shp_class"]),
                "record_count": 0,
                "in_db":        rc in db_codes,
                "has_geometry": rc in geo_codes,
            }
        code_info[rc]["record_count"] += stat["count"]

    return sorted(code_info.values(), key=lambda x: x["route_code"])


def import_routes(route_codes: list[str], db: Session) -> list[dict[str, Any]]:
    """
    지정된 route_code 목록을 SHP에서 읽어 route_geometry에 저장.
    반환: [{route_code, segments, total_pts, status}]
    """
    if not shp_available():
        raise FileNotFoundError(f"SHP 파일 없음: {SHP_PATH}.shp")

    # SHP 전체 로드 (1회)
    route_lines = load_shp_route_index()

    # routes 테이블에 없는 코드는 자동 등록
    existing_codes: set[str] = {
        r[0] for r in db.execute(text("SELECT code FROM routes")).fetchall()
    }

    results = []
    for code in route_codes:
        lines = route_lines.get(code)
        if not lines:
            results.append({"route_code": code, "status": "SHP에 데이터 없음",
                            "segments": 0, "total_pts": 0})
            continue

        # routes 테이블에 없으면 자동 추가
        if code not in existing_codes:
            db.execute(
                text("INSERT OR IGNORE INTO routes (code, name, start_km, end_km) "
                     "VALUES (:code, :name, 0.0, 0.0)"),
                {"code": code, "name": code},
            )
            existing_codes.add(code)

        segments = _merge_to_segments(lines)
        if not segments:
            results.append({"route_code": code, "status": "병합 실패",
                            "segments": 0, "total_pts": 0})
            continue

        # 기존 shp geometry 삭제 (user 데이터는 유지)
        db.execute(
            text("DELETE FROM route_geometry WHERE route_code=:code AND source='shp'"),
            {"code": code},
        )

        # LOD 3단계 저장 (source='shp')
        for lod, tolerance in LOD_TOLERANCE.items():
            for seg_idx, coords in enumerate(segments):
                simplified = _simplify(coords, tolerance)
                rows = [
                    {"code": code, "lod": lod, "seg": seg_idx,
                     "seq": seq, "lat": lat, "lon": lon}
                    for seq, (lat, lon) in enumerate(simplified)
                ]
                db.execute(
                    text(
                        "INSERT INTO route_geometry "
                        "(route_code, source, lod, segment, seq, lat, lon, km) "
                        "VALUES (:code, 'shp', :lod, :seg, :seq, :lat, :lon, NULL)"
                    ),
                    rows,
                )

        db.commit()

        total_pts = sum(len(s) for s in segments)
        results.append({
            "route_code": code,
            "status":     "완료",
            "segments":   len(segments),
            "total_pts":  total_pts,
        })

    return results
