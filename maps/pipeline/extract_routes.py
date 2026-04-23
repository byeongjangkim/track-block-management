#!/usr/bin/env python3
"""
extract_routes.py — 전국 OSM GeoJSON에서 노선별 GeoJSON을 분리한다.

실행 방법:
    cd maps
    source .venv/bin/activate

    python pipeline/extract_routes.py --route gyeongbu   # 단일 노선
    python pipeline/extract_routes.py --all              # 전체 노선

산출물:
    processed/{route}.geojson   (노선별 개별 GeoJSON, .gitignore)
"""

import argparse
import json
from pathlib import Path

# ── 경로 설정 ──────────────────────────────────────────────────────────────
MAPS_DIR      = Path(__file__).parent.parent
RAW_DIR       = MAPS_DIR / "raw"
PROCESSED_DIR = MAPS_DIR / "processed"

# 전국 다운로드 파일 우선, 없으면 구 부산경남 파일 사용
CANDIDATE_GEOJSONS = [
    RAW_DIR / "osm_korea.geojson",
    RAW_DIR / "osm_gyeongbu.geojson",
    RAW_DIR / "osm_busan_gyeongnam.geojson",
]

# ── 전국 노선 필터 ─────────────────────────────────────────────────────────
# names: OSM `name` 태그 값 목록 (OR 조건)
# ref  : OSM `ref` 태그 (이름 없을 때 보조 필터)
ROUTE_FILTERS: dict[str, dict] = {
    "gyeongbu":      {"label": "경부선",        "names": ["경부선", "경부본선"]},
    "gyeongbu_high": {"label": "경부고속선",     "names": ["경부고속선", "경부고속본선"]},
    "honam":         {"label": "호남선",         "names": ["호남선", "호남본선"]},
    "honam_high":    {"label": "호남고속선",     "names": ["호남고속선"]},
    "jeolla":        {"label": "전라선",         "names": ["전라선"]},
    "gyeongjeon":    {"label": "경전선",         "names": ["경전선"]},
    "donghae":       {"label": "동해선",         "names": ["동해선", "동해본선"]},
    "jungang":       {"label": "중앙선",         "names": ["중앙선"]},
    "taebaek":       {"label": "태백선",         "names": ["태백선"]},
    "yeongdong":     {"label": "영동선",         "names": ["영동선"]},
    # 강릉선: OSM에서 "경강선"으로 태깅됨. lon>128.0 & lat>37.4 범위로 경강선(성남-여주)과 분리
    "gangneung":     {"label": "강릉선",         "names": ["경강선"],
                      "bbox": (37.4, 128.0, 38.0, 129.0)},   # (min_lat, min_lon, max_lat, max_lon)
    "gyeongchun":    {"label": "경춘선",         "names": ["경춘선"]},
    # 경강선(성남-여주): lon<128.2 범위로 강릉 구간과 분리
    "gyeonggang":    {"label": "경강선",         "names": ["경강선"],
                      "bbox": (37.2, 127.0, 37.6, 128.2)},
    "janghang":      {"label": "장항선",         "names": ["장항선"]},
    "chungbuk":      {"label": "충북선",         "names": ["충북선"]},
    "gyeongwon":     {"label": "경원선",         "names": ["경원선"]},
    "gyeongui":      {"label": "경의선",         "names": ["경의선"]},
    "gyeongin":      {"label": "경인선",         "names": ["경인선"]},
    "jinhae":        {"label": "진해선",         "names": ["진해선"]},
    "gaya":          {"label": "가야선",         "names": ["가야선"]},
}


def find_source_geojson() -> Path:
    for p in CANDIDATE_GEOJSONS:
        if p.exists():
            return p
    print("[오류] OSM GeoJSON 파일을 찾을 수 없습니다.")
    print("  → 먼저 실행: python pipeline/download_osm.py --bbox korea")
    raise SystemExit(1)


def load_geojson(path: Path) -> dict:
    print(f"  로드: {path.name}  ({path.stat().st_size // 1024:,} KB)")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_geojson(features: list, path: Path) -> None:
    geojson = {"type": "FeatureCollection", "features": features}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)


def feature_centroid(feature: dict) -> tuple[float, float] | None:
    """feature의 첫 좌표를 (lat, lon) 으로 반환한다."""
    geom = feature.get("geometry", {})
    coords = geom.get("coordinates", [])
    if not coords:
        return None
    c = coords[0]
    if isinstance(c[0], float):   # LineString 첫 점
        return (c[1], c[0])
    if isinstance(c[0], list):    # MultiLineString 첫 점
        return (c[0][1], c[0][0])
    return None


def in_bbox(lat: float, lon: float, bbox: tuple) -> bool:
    """bbox = (min_lat, min_lon, max_lat, max_lon)"""
    min_lat, min_lon, max_lat, max_lon = bbox
    return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


def extract_routes(all_features: list, target_codes: set[str]) -> dict[str, list]:
    result: dict[str, list] = {code: [] for code in target_codes}
    unmatched_names: dict[str, int] = {}

    for feature in all_features:
        props = feature.get("properties", {})
        name  = props.get("name", "") or ""

        matched = False
        for code, cfg in ROUTE_FILTERS.items():
            if code not in target_codes:
                continue
            if name not in cfg["names"]:
                continue
            # bbox 필터가 있으면 지리적 위치로 추가 검증
            if "bbox" in cfg:
                centroid = feature_centroid(feature)
                if centroid is None or not in_bbox(centroid[0], centroid[1], cfg["bbox"]):
                    continue
            result[code].append(feature)
            matched = True
            break

        if not matched and name:
            unmatched_names[name] = unmatched_names.get(name, 0) + 1

    return result, unmatched_names


def count_coords(features: list) -> int:
    total = 0
    for feat in features:
        geom = feat.get("geometry", {})
        if geom.get("type") == "LineString":
            total += len(geom.get("coordinates", []))
        elif geom.get("type") == "MultiLineString":
            for line in geom.get("coordinates", []):
                total += len(line)
    return total


def process_route(code: str, features: list) -> None:
    label = ROUTE_FILTERS[code]["label"]
    count = len(features)
    coords = count_coords(features)
    if count == 0:
        print(f"  [경고] {label}: 0개 feature — OSM 태그 불일치 가능성")
        return
    out_path = PROCESSED_DIR / f"{code}.geojson"
    save_geojson(features, out_path)
    print(f"  ✓ {label:16s}: feature {count:4d}개 / 좌표 {coords:,}개 → processed/{code}.geojson")


def main() -> None:
    parser = argparse.ArgumentParser(description="노선별 GeoJSON 분리")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--route", choices=list(ROUTE_FILTERS.keys()), help="단일 노선 코드")
    group.add_argument("--all",   action="store_true", help="전체 노선")
    args = parser.parse_args()

    target_codes = set(ROUTE_FILTERS.keys()) if args.all else {args.route}

    print("=" * 60)
    print(f"  노선별 GeoJSON 분리 ({'전체' if args.all else args.route})")
    print("=" * 60)

    src_path = find_source_geojson()
    source = load_geojson(src_path)
    all_features = source["features"]
    print(f"  전체 feature 수: {len(all_features):,}개\n")

    PROCESSED_DIR.mkdir(exist_ok=True)

    print("[노선 분리]")
    route_features, unmatched = extract_routes(all_features, target_codes)
    for code in sorted(target_codes):
        process_route(code, route_features[code])

    # 미매칭 상위 목록 출력 (참고용)
    if unmatched and args.all:
        top = sorted(unmatched.items(), key=lambda x: -x[1])[:10]
        print(f"\n[참고] 미매칭 노선명 상위 10개:")
        for name, cnt in top:
            print(f"  {cnt:4d}개  {name}")

    print(f"\n✅ 완료! 다음 단계: python pipeline/import_geometry.py --{'all' if args.all else f'route {args.route}'}")


if __name__ == "__main__":
    main()
