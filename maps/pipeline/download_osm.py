#!/usr/bin/env python3
"""
download_osm.py — Overpass API에서 부산경남 철도 데이터를 다운로드한다.

실행 방법:
    cd maps
    source .venv/bin/activate
    python pipeline/download_osm.py

산출물:
    raw/osm_busan_gyeongnam.json     ← Overpass API 원본 응답 (OSM JSON)
    raw/osm_busan_gyeongnam.geojson  ← GeoJSON 변환본 (osmtogeojson)
"""

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests

# ── 경로 설정 ──────────────────────────────────────────────────────────────
MAPS_DIR = Path(__file__).parent.parent          # maps/
RAW_DIR  = MAPS_DIR / "raw"

OSM_JSON    = RAW_DIR / "osm_busan_gyeongnam.json"
OSM_GEOJSON = RAW_DIR / "osm_busan_gyeongnam.geojson"

# ── Overpass API ───────────────────────────────────────────────────────────
# 여러 서버 중 응답이 빠른 곳을 순서대로 시도
OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

# 부산경남본부 관내 범위 (south, west, north, east)
# 경부선(부산~대구), 경전선, 동해선, 진해선 포함
BBOX = (34.5, 128.0, 36.2, 129.5)

OVERPASS_QUERY = f"""
[out:json][timeout:90];
(
  way["railway"="rail"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["railway"="narrow_gauge"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out geom;
"""


def download_osm() -> dict:
    """Overpass API에서 OSM JSON을 다운로드하여 반환한다."""
    for i, server in enumerate(OVERPASS_SERVERS, 1):
        print(f"  [{i}/{len(OVERPASS_SERVERS)}] 서버: {server}")
        try:
            resp = requests.post(
                server,
                data={"data": OVERPASS_QUERY},
                timeout=120,
                headers={"User-Agent": "track-block-management/1.0"},
            )
            resp.raise_for_status()
            data = resp.json()
            element_count = len(data.get("elements", []))
            print(f"  ✓ 수신 완료 — {element_count}개 요소")
            return data
        except requests.exceptions.Timeout:
            print(f"  ✗ 타임아웃 — 다음 서버 시도")
        except requests.exceptions.RequestException as e:
            print(f"  ✗ 오류: {e} — 다음 서버 시도")
        if i < len(OVERPASS_SERVERS):
            time.sleep(3)

    print("\n[오류] 모든 Overpass 서버 응답 실패.")
    print("  → 잠시 후 재시도하거나 overpass-turbo.eu 에서 수동으로 다운로드하세요.")
    sys.exit(1)


def convert_to_geojson(osm_json_path: Path, geojson_path: Path) -> None:
    """osmtogeojson CLI를 사용해 OSM JSON → GeoJSON으로 변환한다."""
    osmtogeojson_bin = shutil.which("osmtogeojson")
    if not osmtogeojson_bin:
        print("\n[오류] osmtogeojson을 찾을 수 없습니다.")
        print("  → 설치: npm install -g osmtogeojson")
        sys.exit(1)

    print(f"  변환 중: {osm_json_path.name} → {geojson_path.name}")
    with open(geojson_path, "w", encoding="utf-8") as out_f:
        result = subprocess.run(
            [osmtogeojson_bin, str(osm_json_path)],
            stdout=out_f,
            stderr=subprocess.PIPE,
            text=True,
        )

    if result.returncode != 0:
        print(f"\n[오류] osmtogeojson 실패:\n{result.stderr}")
        sys.exit(1)

    # 변환 결과 요약
    with open(geojson_path, encoding="utf-8") as f:
        geojson = json.load(f)
    feature_count = len(geojson.get("features", []))
    size_kb = geojson_path.stat().st_size // 1024
    print(f"  ✓ 변환 완료 — {feature_count}개 feature, {size_kb} KB")


def main() -> None:
    print("=" * 55)
    print("  부산경남 철도 OSM 데이터 다운로드")
    print(f"  범위: 위도 {BBOX[0]}~{BBOX[2]}, 경도 {BBOX[1]}~{BBOX[3]}")
    print("=" * 55)

    # raw/ 디렉토리 생성
    RAW_DIR.mkdir(exist_ok=True)

    # 1단계: Overpass API 다운로드
    print("\n[1단계] Overpass API 다운로드")
    osm_data = download_osm()

    print(f"  저장: {OSM_JSON}")
    with open(OSM_JSON, "w", encoding="utf-8") as f:
        json.dump(osm_data, f, ensure_ascii=False, indent=2)

    # 2단계: GeoJSON 변환
    print("\n[2단계] GeoJSON 변환 (osmtogeojson)")
    convert_to_geojson(OSM_JSON, OSM_GEOJSON)

    print(f"\n완료!")
    print(f"  OSM JSON  : {OSM_JSON}")
    print(f"  GeoJSON   : {OSM_GEOJSON}")
    print(f"\n다음 단계: python pipeline/extract_routes.py")


if __name__ == "__main__":
    main()
