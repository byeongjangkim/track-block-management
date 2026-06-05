#!/bin/bash
# 기준데이터 덤프 — 노선·역·시설물·시군구·조직 (운영 차단명령 제외)
# 사용: cd backend && bash scripts/dump_reference_data.sh
#
# 출력 파일: scripts/dumps/reference_data_YYYYMMDD.sql
# 배포 시 Ubuntu 서버로 scp 전송 후 restore_reference_data.sh 실행

set -e

DB_NAME="${DB_NAME:-track_block}"
DUMP_DIR="$(dirname "$0")/dumps"
DATE=$(date +%Y%m%d_%H%M%S)
OUTPUT="$DUMP_DIR/reference_data_$DATE.sql"

mkdir -p "$DUMP_DIR"

echo "=== 기준데이터 덤프 시작: $DB_NAME ==="

pg_dump \
  --data-only \
  --no-owner \
  --disable-triggers \
  --table=routes \
  --table=organizations \
  --table=org_viewport \
  --table=system_settings \
  --table=rail_routes \
  --table=rail_stations \
  --table=rail_route_station_points \
  --table=rail_baseline_points \
  --table=rail_computed_geometry \
  --table=rail_track_sections \
  --table=rail_facility_classifications \
  --table=rail_facility_management_offices \
  --table=rail_facilities \
  --table=rail_route_region_boundaries \
  --table=rail_station_management_groups \
  --table=rail_station_management_members \
  --table=organization_route_ranges \
  "$DB_NAME" > "$OUTPUT"

SIZE=$(wc -c < "$OUTPUT" | awk '{printf "%.1fMB", $1/1024/1024}')
echo "덤프 완료: $OUTPUT ($SIZE)"
echo ""
echo "복원 명령:"
echo "  bash scripts/restore_reference_data.sh $OUTPUT"
