#!/usr/bin/env python3
"""
vectorize.py — 노선별 GeoJSON을 SVG로 변환한다 (mapshaper 사용).

실행 방법:
    cd maps
    source .venv/bin/activate

    # 단일 노선
    python pipeline/vectorize.py --route gyeongbu

    # 전체 노선 일괄 변환
    python pipeline/vectorize.py --all

산출물:
    svg/gyeongbu.svg
    svg/gyeongbu_high.svg
    svg/gyeongjeon.svg
    svg/donghae.svg
    svg/jinhae.svg
    svg/gaya.svg

다음 단계:
    python pipeline/anchor_editor.py --route gyeongbu
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

# ── 경로 설정 ──────────────────────────────────────────────────────────────
MAPS_DIR      = Path(__file__).parent.parent
PROCESSED_DIR = MAPS_DIR / "processed"
SVG_DIR       = MAPS_DIR / "svg"

# ── 변환 설정 ─────────────────────────────────────────────────────────────
# key: extract_routes.py 의 ROUTE_FILTERS 키와 동일
ROUTES = {
    "gyeongbu":      "경부선",
    "gyeongbu_high": "경부고속선 (KTX)",
    "gyeongjeon":    "경전선",
    "donghae":       "동해선",
    "jinhae":        "진해선",
    "gaya":          "가야선",
}

# mapshaper 변환 옵션
MAPSHAPER_WIDTH    = 1200    # SVG 출력 너비 (px)
MAPSHAPER_SIMPLIFY = "0.5%"  # 노드 단순화 비율 (높을수록 단순, 낮을수록 정밀)
MAPSHAPER_PROJ     = "merc"  # 투영: 메르카토르 (SVG 좌표 왜곡 최소화)


def check_mapshaper() -> str:
    """mapshaper 실행 파일 경로를 반환한다."""
    path = shutil.which("mapshaper")
    if not path:
        print("[오류] mapshaper를 찾을 수 없습니다.")
        print("  → 설치: npm install -g mapshaper")
        sys.exit(1)
    return path


def convert_one(route_key: str, mapshaper_bin: str) -> bool:
    """단일 노선을 GeoJSON → SVG로 변환한다. 성공 시 True 반환."""
    label      = ROUTES.get(route_key, route_key)
    input_path = PROCESSED_DIR / f"{route_key}.geojson"
    output_path = SVG_DIR / f"{route_key}.svg"

    if not input_path.exists():
        print(f"  [건너뜀] {label}: {input_path.name} 없음")
        print(f"           → 먼저 실행: python pipeline/extract_routes.py")
        return False

    cmd = [
        mapshaper_bin,
        str(input_path),
        "-proj", MAPSHAPER_PROJ,
        "-simplify", MAPSHAPER_SIMPLIFY, "keep-shapes",
        "-o", f"format=svg", f"width={MAPSHAPER_WIDTH}",
        str(output_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"  [오류] {label}: mapshaper 실패")
        print(result.stderr)
        return False

    # 결과 요약
    size_kb   = output_path.stat().st_size // 1024
    viewbox   = _parse_viewbox(output_path)
    print(f"  ✓ {label:22s} → svg/{route_key}.svg  ({size_kb} KB, viewBox: {viewbox})")
    return True


def _parse_viewbox(svg_path: Path) -> str:
    """SVG 파일에서 viewBox 값을 읽어 반환한다."""
    with open(svg_path, encoding="utf-8") as f:
        for line in f:
            if "viewBox" in line:
                start = line.index('viewBox="') + 9
                end   = line.index('"', start)
                return line[start:end]
    return "unknown"


def main() -> None:
    parser = argparse.ArgumentParser(description="GeoJSON → SVG 변환 (mapshaper)")
    group  = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--route", choices=list(ROUTES.keys()),
                       help="변환할 노선 코드")
    group.add_argument("--all", action="store_true",
                       help="모든 노선 일괄 변환")
    args = parser.parse_args()

    mapshaper_bin = check_mapshaper()
    SVG_DIR.mkdir(exist_ok=True)

    if args.all:
        print("=" * 55)
        print("  전체 노선 SVG 변환")
        print("=" * 55)
        print()
        success = 0
        for key in ROUTES:
            if convert_one(key, mapshaper_bin):
                success += 1
        print(f"\n완료: {success}/{len(ROUTES)}개 노선 변환")
    else:
        print("=" * 55)
        print(f"  {ROUTES[args.route]} SVG 변환")
        print("=" * 55)
        print()
        convert_one(args.route, mapshaper_bin)

    print(f"\n산출물 위치: {SVG_DIR}")
    print(f"다음 단계: python pipeline/anchor_editor.py --route {args.route or 'gyeongbu'}")


if __name__ == "__main__":
    main()
