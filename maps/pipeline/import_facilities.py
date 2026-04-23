#!/usr/bin/env python3
"""
import_facilities.py — CSV 시설물 양식을 읽어 앵커·시설물 JSON을 생성한다.

실행 방법:
    cd maps
    source .venv/bin/activate

    # 단일 노선
    python pipeline/import_facilities.py --route gyeongbu

    # 단일 노선 + frontend 배포까지
    python pipeline/import_facilities.py --route gyeongbu --deploy

    # 전체 노선 + 배포
    python pipeline/import_facilities.py --all --deploy

입력:
    facilities/input/{route}.csv

산출물:
    anchors/{route}.json       ← 거리정 앵커 포인트
    facilities/{route}.json    ← 시설물 마커 데이터
    (--deploy 옵션 시) frontend/public/maps/ 에도 복사
"""

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path

try:
    from pyproj import Transformer
except ImportError:
    print("[오류] pyproj가 설치되지 않았습니다. pip install pyproj")
    sys.exit(1)

# ── 경로 설정 ──────────────────────────────────────────────────────────────
MAPS_DIR       = Path(__file__).parent.parent
PROJECT_ROOT   = MAPS_DIR.parent
PROCESSED_DIR  = MAPS_DIR / "processed"
SVG_DIR        = MAPS_DIR / "svg"
ANCHORS_DIR    = MAPS_DIR / "anchors"
FACILITIES_DIR = MAPS_DIR / "facilities"
INPUT_DIR      = FACILITIES_DIR / "input"
PUBLIC_MAPS    = PROJECT_ROOT / "frontend" / "public" / "maps"

# ── 노선 메타데이터 ─────────────────────────────────────────────────────────
ROUTES = {
    "gyeongbu":      {"label": "경부선",          "start_km": 0.0, "end_km": 451.8},
    "gyeongbu_high": {"label": "경부고속선 (KTX)", "start_km": 0.0, "end_km": 417.0},
    "gyeongjeon":    {"label": "경전선",           "start_km": 0.0, "end_km": 278.8},
    "donghae":       {"label": "동해선",           "start_km": 0.0, "end_km": 188.6},
    "jinhae":        {"label": "진해선",           "start_km": 0.0, "end_km": 21.3},
    "gaya":          {"label": "가야선",           "start_km": 0.0, "end_km": 7.1},
}

VALID_TYPES = {"STATION", "CROSSING", "OVERPASS", "SUBSTATION", "TUNNEL", "BRIDGE"}

# 위경도 → 메르카토르 변환기
_transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)


# ── SVG viewBox 파싱 ──────────────────────────────────────────────────────

def read_svg_viewbox(route_key: str) -> tuple[int, int]:
    """SVG 파일에서 width, height 반환."""
    svg_path = SVG_DIR / f"{route_key}.svg"
    if not svg_path.exists():
        print(f"  [오류] {svg_path} 없음 → vectorize.py 먼저 실행")
        sys.exit(1)
    with open(svg_path, encoding="utf-8") as f:
        for line in f:
            if "viewBox" in line:
                start = line.index('viewBox="') + 9
                end   = line.index('"', start)
                parts = line[start:end].split()
                return int(parts[2]), int(parts[3])
    print(f"  [오류] {svg_path} viewBox 파싱 실패")
    sys.exit(1)


# ── GeoJSON bbox → SVG 변환기 ─────────────────────────────────────────────

class SvgMapper:
    """위경도 → SVG 좌표 변환기 (processed GeoJSON 기반)."""

    def __init__(self, route_key: str):
        geojson_path = PROCESSED_DIR / f"{route_key}.geojson"
        if not geojson_path.exists():
            print(f"  [오류] {geojson_path} 없음 → extract_routes.py 먼저 실행")
            sys.exit(1)

        with open(geojson_path, encoding="utf-8") as f:
            data = json.load(f)

        min_x = min_y =  float("inf")
        max_x = max_y = -float("inf")

        for feature in data["features"]:
            for lon, lat in self._flatten(feature.get("geometry", {})):
                mx, my = _transformer.transform(lon, lat)
                min_x = min(min_x, mx); max_x = max(max_x, mx)
                min_y = min(min_y, my); max_y = max(max_y, my)

        self.svg_w, self.svg_h = read_svg_viewbox(route_key)
        self.scale   = self.svg_w / (max_x - min_x)
        calc_h       = self.scale * (max_y - min_y)
        self.y_pad   = (self.svg_h - calc_h) / 2
        self.min_x   = min_x
        self.min_y   = min_y

    def to_svg(self, lat: float, lon: float) -> tuple[float, float]:
        mx, my = _transformer.transform(lon, lat)
        x = (mx - self.min_x) * self.scale
        y = self.svg_h - self.y_pad - (my - self.min_y) * self.scale
        return round(x, 1), round(y, 1)

    @staticmethod
    def _flatten(geometry: dict) -> list[tuple[float, float]]:
        gtype  = geometry.get("type", "")
        coords = geometry.get("coordinates", [])
        if gtype == "LineString":
            return [c[:2] for c in coords]
        if gtype in ("MultiLineString", "Polygon"):
            return [c[:2] for ring in coords for c in ring]
        return []


# ── CSV 파싱 ──────────────────────────────────────────────────────────────

def parse_csv(route_key: str) -> list[dict]:
    """facilities/input/{route}.csv를 읽어 행 목록 반환."""
    csv_path = INPUT_DIR / f"{route_key}.csv"
    if not csv_path.exists():
        print(f"  [오류] {csv_path} 없음")
        sys.exit(1)

    rows = []
    errors = []

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(
            (line for line in f if not line.lstrip().startswith("#")),
        )
        for lineno, raw in enumerate(reader, start=2):
            row = {k.strip(): v.strip() for k, v in raw.items() if k}

            # 필수 컬럼 검증
            if not row.get("type"):
                errors.append(f"  행 {lineno}: type 없음")
                continue
            if row["type"] not in VALID_TYPES:
                errors.append(f"  행 {lineno}: 알 수 없는 type '{row['type']}'")
                continue
            if not row.get("name"):
                errors.append(f"  행 {lineno}: name 없음")
                continue
            if not row.get("km_start"):
                errors.append(f"  행 {lineno}: km_start 없음")
                continue

            try:
                row["km_start"] = float(row["km_start"])
            except ValueError:
                errors.append(f"  행 {lineno}: km_start 숫자 오류 '{row['km_start']}'")
                continue

            row["km_end"] = float(row["km_end"]) if row.get("km_end") else None

            try:
                row["lat"] = float(row["lat"]) if row.get("lat") else None
                row["lon"] = float(row["lon"]) if row.get("lon") else None
            except ValueError:
                errors.append(f"  행 {lineno}: lat/lon 숫자 오류")
                continue

            # 불리언
            row["has_station_map"] = row.get("has_station_map", "").lower() == "true"
            # STATION이면 기본 use_as_anchor=true
            default_anchor = row["type"] == "STATION"
            row["use_as_anchor"] = (
                row.get("use_as_anchor", "").lower() == "true"
                if row.get("use_as_anchor") else default_anchor
            )

            rows.append(row)

    if errors:
        print(f"  [검증 오류] {len(errors)}건:")
        for e in errors:
            print(e)

    return sorted(rows, key=lambda r: r["km_start"])


# ── JSON 생성 ─────────────────────────────────────────────────────────────

def build_anchor_json(route_key: str, rows: list[dict], mapper: SvgMapper) -> dict:
    """앵커 포인트 JSON 구성."""
    meta    = ROUTES[route_key]
    anchors = []

    for row in rows:
        if not row["use_as_anchor"]:
            continue
        if row["lat"] is None or row["lon"] is None:
            print(f"  [건너뜀] 앵커 '{row['name']}': lat/lon 없음")
            continue
        x, y = mapper.to_svg(row["lat"], row["lon"])
        anchors.append({"km": row["km_start"], "x": x, "y": y})
        print(f"    앵커: {row['name']:20s}  km={row['km_start']:6.1f}  x={x:7.1f}  y={y:7.1f}")

    return {
        "route":          meta["label"],
        "route_code":     route_key,
        "start_km":       meta["start_km"],
        "end_km":         meta["end_km"],
        "up_offset_px":   -6,
        "down_offset_px":  6,
        "anchors":        anchors,
    }


def build_facility_json(route_key: str, rows: list[dict]) -> dict:
    """시설물 마커 JSON 구성."""
    facilities = []
    for row in rows:
        facilities.append({
            "type":            row["type"],
            "name":            row["name"],
            "km_start":        row["km_start"],
            "km_end":          row["km_end"],
            "has_station_map": row["has_station_map"],
        })
    return {"route_code": route_key, "facilities": facilities}


# ── 저장 ─────────────────────────────────────────────────────────────────

def save_json(data: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── 배포 ─────────────────────────────────────────────────────────────────

def deploy(route_key: str) -> None:
    """SVG + 앵커 + 시설물 → frontend/public/maps/ 복사."""
    PUBLIC_MAPS.mkdir(parents=True, exist_ok=True)
    (PUBLIC_MAPS / "anchors").mkdir(exist_ok=True)
    (PUBLIC_MAPS / "facilities").mkdir(exist_ok=True)

    svg_src = SVG_DIR / f"{route_key}.svg"
    if svg_src.exists():
        shutil.copy2(svg_src, PUBLIC_MAPS / f"{route_key}.svg")
        print(f"    배포: svg/{route_key}.svg")

    anchor_src = ANCHORS_DIR / f"{route_key}.json"
    if anchor_src.exists():
        shutil.copy2(anchor_src, PUBLIC_MAPS / "anchors" / f"{route_key}.json")
        print(f"    배포: anchors/{route_key}.json")

    facility_src = FACILITIES_DIR / f"{route_key}.json"
    if facility_src.exists():
        shutil.copy2(facility_src, PUBLIC_MAPS / "facilities" / f"{route_key}.json")
        print(f"    배포: facilities/{route_key}.json")


# ── 단일 노선 처리 ────────────────────────────────────────────────────────

def process_one(route_key: str, do_deploy: bool) -> bool:
    label = ROUTES[route_key]["label"]
    print(f"\n  [{label}]")

    # CSV 파싱
    rows = parse_csv(route_key)
    if not rows:
        print(f"  [건너뜀] 유효한 행 없음")
        return False
    print(f"  CSV 행 수: {len(rows)}개")

    # SVG 변환기 초기화
    mapper = SvgMapper(route_key)
    print(f"  SVG 크기: {mapper.svg_w} × {mapper.svg_h} px  스케일: {mapper.scale:.6f}")

    # 앵커 JSON
    anchor_data   = build_anchor_json(route_key, rows, mapper)
    anchor_path   = ANCHORS_DIR / f"{route_key}.json"
    save_json(anchor_data, anchor_path)
    print(f"  저장: {anchor_path}  ({len(anchor_data['anchors'])}개 앵커)")

    # 시설물 JSON
    facility_data = build_facility_json(route_key, rows)
    facility_path = FACILITIES_DIR / f"{route_key}.json"
    save_json(facility_data, facility_path)
    print(f"  저장: {facility_path}  ({len(facility_data['facilities'])}개 시설물)")

    # 배포
    if do_deploy:
        deploy(route_key)

    return True


# ── main ──────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="CSV 시설물 양식 → 앵커·시설물 JSON 생성"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--route", choices=list(ROUTES.keys()), help="노선 코드")
    group.add_argument("--all", action="store_true", help="전체 노선 처리")
    parser.add_argument("--deploy", action="store_true",
                        help="frontend/public/maps/ 에도 배포")
    args = parser.parse_args()

    print("=" * 55)
    print("  시설물·앵커 JSON 생성")
    print("=" * 55)

    targets = list(ROUTES.keys()) if args.all else [args.route]
    success = 0
    for key in targets:
        if process_one(key, do_deploy=args.deploy):
            success += 1

    print(f"\n완료: {success}/{len(targets)}개 노선 처리")
    if args.deploy:
        print(f"배포 위치: {PUBLIC_MAPS}")


if __name__ == "__main__":
    main()
