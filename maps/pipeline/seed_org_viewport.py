"""
seed_org_viewport.py — 조직별 초기 viewport 값을 org_viewport 테이블에 입력

데이터 출처: maps/data/org_viewport.tsv
대상 DB: backend/db.sqlite3

사용법:
  python pipeline/seed_org_viewport.py          # 전체 조직 시드
  python pipeline/seed_org_viewport.py --dry-run # 실제 저장 없이 출력만
"""
import argparse
import csv
import sys
from pathlib import Path

DB_PATH   = Path(__file__).parent.parent.parent / "backend" / "db.sqlite3"
TSV_PATH  = Path(__file__).parent.parent / "data" / "org_viewport.tsv"


def load_tsv() -> list[dict]:
    rows = []
    with open(TSV_PATH, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            # _system_superuser 행은 조직 테이블에 없으므로 건너뜀
            if row['org_code'].startswith('_'):
                continue
            rows.append(row)
    return rows


def seed(dry_run: bool = False) -> None:
    import sqlite3

    rows = load_tsv()

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    inserted = updated = skipped = 0

    for row in rows:
        org_code   = row['org_code']
        center_lat = float(row['center_lat'])
        center_lon = float(row['center_lon'])
        zoom_level = float(row['zoom_level'])

        # organizations 테이블에서 id 조회
        res = cur.execute("SELECT id FROM organizations WHERE code = ?", (org_code,)).fetchone()
        if res is None:
            print(f"  SKIP  {org_code} — organizations 테이블에 없음")
            skipped += 1
            continue

        org_id = res[0]

        # 기존 레코드 확인
        existing = cur.execute(
            "SELECT id, center_lat, center_lon, zoom_level FROM org_viewport WHERE organization_id = ?",
            (org_id,)
        ).fetchone()

        if existing:
            ex_lat, ex_lon, ex_zoom = existing[1], existing[2], existing[3]
            if ex_lat == center_lat and ex_lon == center_lon and ex_zoom == zoom_level:
                print(f"  OK    {org_code} ({row['org_name']}) — 변경 없음")
                continue
            print(f"  UPD   {org_code} ({row['org_name']}) lat={center_lat} lon={center_lon} zoom={zoom_level}")
            if not dry_run:
                cur.execute(
                    "UPDATE org_viewport SET center_lat=?, center_lon=?, zoom_level=? WHERE organization_id=?",
                    (center_lat, center_lon, zoom_level, org_id)
                )
            updated += 1
        else:
            print(f"  INS   {org_code} ({row['org_name']}) lat={center_lat} lon={center_lon} zoom={zoom_level}")
            if not dry_run:
                cur.execute(
                    "INSERT INTO org_viewport (organization_id, center_lat, center_lon, zoom_level) VALUES (?,?,?,?)",
                    (org_id, center_lat, center_lon, zoom_level)
                )
            inserted += 1

    if not dry_run:
        con.commit()
    con.close()

    mode = "[DRY-RUN] " if dry_run else ""
    print(f"\n{mode}완료: 삽입 {inserted}건, 수정 {updated}건, 건너뜀 {skipped}건")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="org_viewport 시드 데이터 입력")
    parser.add_argument("--dry-run", action="store_true", help="실제 저장 없이 출력만")
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"ERROR: DB 파일 없음 — {DB_PATH}", file=sys.stderr)
        sys.exit(1)
    if not TSV_PATH.exists():
        print(f"ERROR: TSV 파일 없음 — {TSV_PATH}", file=sys.stderr)
        sys.exit(1)

    seed(dry_run=args.dry_run)
