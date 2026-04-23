#!/usr/bin/env python3
"""
add_route.py — 신규 노선 추가 통합 스크립트

이미 osm_korea.geojson 가 있다고 가정하고 아래 단계를 순서대로 실행한다:
  1. extract_routes.py   — OSM에서 해당 노선 GeoJSON 분리
  2. import_geometry.py  — GeoJSON → SQLite (LOD 3단계 저장)
  3. (선택) 조직 관할 구간 등록 안내 출력

사용법:
  cd maps
  python pipeline/add_route.py --route sinro             # 단일 노선
  python pipeline/add_route.py --route sinro --verify    # 저장 후 검증

주의사항:
  - ROUTE_FILTERS(extract_routes.py)와 backend routes 테이블에
    신규 노선이 먼저 추가되어 있어야 한다.
  - 신규 노선 등록 전체 절차는 maps/ROUTE_MANAGEMENT.md 참고.
"""

import argparse
import subprocess
import sys
from pathlib import Path

MAPS_DIR = Path(__file__).parent.parent
PIPELINE = MAPS_DIR / "pipeline"


def run(cmd: list[str], label: str) -> bool:
    print(f"\n{'='*60}")
    print(f"[{label}] {' '.join(cmd)}")
    print('='*60)
    result = subprocess.run(cmd, cwd=MAPS_DIR)
    if result.returncode != 0:
        print(f"\nERROR: {label} 실패 (exit {result.returncode})", file=sys.stderr)
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="신규 노선 추가 통합 스크립트")
    parser.add_argument("--route", required=True, help="노선 코드 (예: gyeongbu, sinro)")
    parser.add_argument("--verify", action="store_true", help="import 후 좌표 수 검증")
    parser.add_argument("--python", default="python3", help="Python 실행 경로 (기본: python3)")
    args = parser.parse_args()

    py = args.python
    code = args.route

    print(f"\n노선 '{code}' 추가 시작")

    # Step 1: extract
    ok = run(
        [py, str(PIPELINE / "extract_routes.py"), "--route", code],
        "1/2  extract_routes"
    )
    if not ok:
        print("\n중단: extract_routes 실패. ROUTE_FILTERS 설정을 확인하세요.")
        sys.exit(1)

    # Step 2: import geometry
    verify_flag = ["--verify", code] if args.verify else []
    ok = run(
        [py, str(PIPELINE / "import_geometry.py"), "--route", code] + verify_flag,
        "2/2  import_geometry"
    )
    if not ok:
        print("\n중단: import_geometry 실패.")
        sys.exit(1)

    print(f"""
{'='*60}
완료: 노선 '{code}' SQLite 저장 성공

다음 단계 (수동 작업 필요):
  1. backend routes 테이블에 노선 추가 (없는 경우)
     → 백엔드 관리자 페이지 또는 DB 직접 삽입

  2. 조직 관할 구간 등록
     → backend 관리자 페이지: /admin/organizations/{"{id}"}/route-ranges
     → 또는 DB: organization_route_ranges 테이블 직접 삽입

  3. maps/data/routes_metadata.tsv 에 노선 정보 추가

  4. (선택) maps/data/org_viewport.tsv 조정 후 seed 재실행
     python pipeline/seed_org_viewport.py

상세 절차: maps/ROUTE_MANAGEMENT.md 참고
{'='*60}
""")


if __name__ == "__main__":
    main()
