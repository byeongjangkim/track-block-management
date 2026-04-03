#!/usr/bin/env python3
"""
extract_routes.py — OSM GeoJSON에서 노선별 GeoJSON을 분리한다.

실행 방법:
    cd maps
    source .venv/bin/activate
    python pipeline/extract_routes.py

산출물:
    processed/gyeongbu.geojson      경부선 (경부선 + 경부본선)
    processed/gyeongbu_high.geojson 경부고속선 (KTX)
    processed/gyeongjeon.geojson    경전선
    processed/donghae.geojson       동해선 (동해선 + 동해본선)
    processed/jinhae.geojson        진해선
    processed/gaya.geojson          가야선

다음 단계:
    mapshaper processed/gyeongbu.geojson -proj merc -simplify 0.5% -o format=svg svg/gyeongbu.svg
"""

import json
from pathlib import Path

# ── 경로 설정 ──────────────────────────────────────────────────────────────
MAPS_DIR      = Path(__file__).parent.parent
RAW_DIR       = MAPS_DIR / "raw"
PROCESSED_DIR = MAPS_DIR / "processed"
OSM_GEOJSON   = RAW_DIR / "osm_busan_gyeongnam.geojson"

# ── 노선 필터 설정 ─────────────────────────────────────────────────────────
# key   : 출력 파일명 (processed/{key}.geojson)
# names : OSM name 태그 값 목록 (OR 조건)
# label : 화면 출력용 한글 이름
ROUTE_FILTERS: dict[str, dict] = {
    "gyeongbu": {
        "label": "경부선",
        "names": ["경부선", "경부본선"],  # 구간별 태깅 다름 → 합산
    },
    "gyeongbu_high": {
        "label": "경부고속선 (KTX)",
        "names": ["경부고속선"],
    },
    "gyeongjeon": {
        "label": "경전선",
        "names": ["경전선"],
    },
    "donghae": {
        "label": "동해선",
        "names": ["동해선", "동해본선"],  # 구간별 태깅 다름 → 합산
    },
    "jinhae": {
        "label": "진해선",
        "names": ["진해선"],
    },
    "gaya": {
        "label": "가야선",
        "names": ["가야선"],
    },
}


def load_geojson(path: Path) -> dict:
    print(f"  로드: {path.name}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_geojson(features: list, path: Path) -> None:
    geojson = {
        "type": "FeatureCollection",
        "features": features,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)


def extract_routes(all_features: list) -> dict[str, list]:
    """노선 필터 기준으로 feature 목록을 분리한다."""
    result: dict[str, list] = {key: [] for key in ROUTE_FILTERS}
    unmatched_names: set[str] = set()

    for feature in all_features:
        props = feature.get("properties", {})
        name = props.get("name", "")

        matched = False
        for key, config in ROUTE_FILTERS.items():
            if name in config["names"]:
                result[key].append(feature)
                matched = True
                break  # 하나의 feature는 하나의 노선에만 배정

        if not matched and name:
            unmatched_names.add(name)

    return result, unmatched_names


def main() -> None:
    print("=" * 55)
    print("  노선별 GeoJSON 분리")
    print("=" * 55)

    if not OSM_GEOJSON.exists():
        print(f"\n[오류] {OSM_GEOJSON} 없음")
        print("  → 먼저 실행: python pipeline/download_osm.py")
        raise SystemExit(1)

    # 원본 GeoJSON 로드
    print("\n[1단계] 원본 GeoJSON 로드")
    source = load_geojson(OSM_GEOJSON)
    all_features = source["features"]
    print(f"  전체 feature 수: {len(all_features):,}개")

    # 노선별 분리
    print("\n[2단계] 노선별 분리")
    route_features, unmatched_names = extract_routes(all_features)

    # 결과 출력 및 저장
    print("\n[3단계] 저장")
    PROCESSED_DIR.mkdir(exist_ok=True)

    total_matched = 0
    for key, features in route_features.items():
        label = ROUTE_FILTERS[key]["label"]
        count = len(features)
        total_matched += count

        if count == 0:
            print(f"  [경고] {label}: 0개 — OSM 태그 불일치 가능성")
            continue

        out_path = PROCESSED_DIR / f"{key}.geojson"
        save_geojson(features, out_path)
        print(f"  ✓ {label:20s}: {count:4d}개  →  processed/{key}.geojson")

    # 미매칭 feature 정보 출력
    unmatched_count = len(all_features) - total_matched - sum(
        1 for f in all_features if not f.get("properties", {}).get("name", "")
    )
    no_name_count = sum(
        1 for f in all_features if not f.get("properties", {}).get("name", "")
    )

    print(f"\n[통계]")
    print(f"  매칭된 feature : {total_matched:,}개")
    print(f"  이름 없는 feature: {no_name_count:,}개  (측선·인입선 등)")
    if unmatched_names:
        # 빈도순 정렬을 위해 전체 features에서 카운트
        name_count: dict[str, int] = {}
        for f in all_features:
            n = f.get("properties", {}).get("name", "")
            if n and n in unmatched_names:
                name_count[n] = name_count.get(n, 0) + 1

        sorted_names = sorted(name_count.items(), key=lambda x: -x[1])
        print(f"  미매칭 노선명 ({len(unmatched_names)}개):")
        for name, cnt in sorted_names[:15]:
            print(f"    {cnt:4d}개  {name}")
        if len(sorted_names) > 15:
            print(f"    ... 외 {len(sorted_names) - 15}개")

    print(f"\n완료!")
    print(f"  산출물 위치: {PROCESSED_DIR}")
    print(f"\n다음 단계 — SVG 변환 (예시: 경부선):")
    print(f"  mapshaper processed/gyeongbu.geojson -proj merc -simplify 0.5% -o format=svg svg/gyeongbu.svg")


if __name__ == "__main__":
    main()
