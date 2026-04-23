#!/usr/bin/env python3
"""
download_osm.py — Overpass API에서 전국(또는 특정 지역) 철도 GIS 데이터를 다운로드한다.

실행 방법:
    cd maps
    source .venv/bin/activate

    # 전국 다운로드 (권장, 5~10분 소요)
    python pipeline/download_osm.py --bbox korea

    # 특정 지역만 (빠른 테스트)
    python pipeline/download_osm.py --bbox gyeongbu

산출물:
    raw/osm_korea.json      ← Overpass API 원본 응답 (OSM JSON)
    raw/osm_korea.geojson   ← GeoJSON 변환본 (osmtogeojson)
"""

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests

# ── 경로 설정 ──────────────────────────────────────────────────────────────
MAPS_DIR = Path(__file__).parent.parent
RAW_DIR  = MAPS_DIR / "raw"

# ── Overpass 서버 목록 ─────────────────────────────────────────────────────
OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

# ── bbox 프리셋 (south, west, north, east) ────────────────────────────────
BBOX_PRESETS = {
    # 전국 (모든 노선 포함)
    "korea":    (34.3, 124.5, 38.6, 130.0),
    # 경부선 전체 (서울~부산)
    "gyeongbu": (35.1, 126.9, 37.6, 129.1),
    # 부산경남 (기존 범위)
    "busan":    (34.5, 128.0, 36.2, 129.5),
}


def build_query(bbox: tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    return f"""
[out:json][timeout:180];
(
  way["railway"="rail"]({s},{w},{n},{e});
  way["railway"="narrow_gauge"]({s},{w},{n},{e});
);
out geom;
"""


def download_osm(query: str) -> dict:
    """Overpass API에서 OSM JSON을 다운로드하여 반환한다."""
    for i, server in enumerate(OVERPASS_SERVERS, 1):
        print(f"  [{i}/{len(OVERPASS_SERVERS)}] 서버: {server}")
        try:
            resp = requests.post(
                server,
                data={"data": query},
                timeout=300,
                headers={"User-Agent": "track-block-management/1.0"},
            )
            resp.raise_for_status()
            data = resp.json()
            element_count = len(data.get("elements", []))
            print(f"  ✓ 수신 완료 — {element_count:,}개 요소")
            return data
        except requests.exceptions.Timeout:
            print(f"  ✗ 타임아웃 — 다음 서버 시도")
        except requests.exceptions.RequestException as e:
            print(f"  ✗ 오류: {e} — 다음 서버 시도")
        if i < len(OVERPASS_SERVERS):
            time.sleep(5)

    print("\n[오류] 모든 Overpass 서버 응답 실패.")
    print("  → 잠시 후 재시도하거나 overpass-turbo.eu 에서 수동으로 다운로드하세요.")
    sys.exit(1)


def convert_to_geojson(osm_json_path: Path, geojson_path: Path) -> None:
    """osmtogeojson CLI로 OSM JSON → GeoJSON 변환."""
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

    with open(geojson_path, encoding="utf-8") as f:
        geojson = json.load(f)
    feature_count = len(geojson.get("features", []))
    size_kb = geojson_path.stat().st_size // 1024
    print(f"  ✓ 변환 완료 — {feature_count:,}개 feature, {size_kb:,} KB")


def main() -> None:
    parser = argparse.ArgumentParser(description="철도 OSM 데이터 다운로드")
    parser.add_argument(
        "--bbox",
        default="korea",
        choices=list(BBOX_PRESETS.keys()),
        help="다운로드 범위 (기본: korea)",
    )
    args = parser.parse_args()

    bbox = BBOX_PRESETS[args.bbox]
    out_name = "osm_korea" if args.bbox == "korea" else f"osm_{args.bbox}"
    osm_json_path    = RAW_DIR / f"{out_name}.json"
    osm_geojson_path = RAW_DIR / f"{out_name}.geojson"

    print("=" * 60)
    print(f"  철도 OSM 데이터 다운로드 ({args.bbox})")
    print(f"  범위: 위도 {bbox[0]}~{bbox[2]}, 경도 {bbox[1]}~{bbox[3]}")
    print("=" * 60)

    RAW_DIR.mkdir(exist_ok=True)

    print("\n[1단계] Overpass API 다운로드")
    osm_data = download_osm(build_query(bbox))

    print(f"  저장: {osm_json_path}")
    with open(osm_json_path, "w", encoding="utf-8") as f:
        json.dump(osm_data, f, ensure_ascii=False)

    print("\n[2단계] GeoJSON 변환 (osmtogeojson)")
    convert_to_geojson(osm_json_path, osm_geojson_path)

    print(f"\n✅ 완료!")
    print(f"  OSM JSON : {osm_json_path}")
    print(f"  GeoJSON  : {osm_geojson_path}")
    print(f"\n다음 단계: python pipeline/extract_routes.py --all")


if __name__ == "__main__":
    main()
