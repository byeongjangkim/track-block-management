# 기준데이터 시드 파일

이 폴더에 기준데이터 SQL 덤프 파일을 복사하세요.

## 복사해야 할 파일

| 파일 | 위치 | 용도 |
|---|---|---|
| `reference_data_*.sql` | `backend/scripts/dumps/` | 시군구 지도, 노선, 역, 시설물, 조직, 관할구간, 시스템설정 |

## 복사 방법 (Mac에서 USB 준비 시)

```bash
# 최신 덤프 파일을 이 폴더로 복사
cd <프로젝트루트>
bash backend/scripts/dump_reference_data.sh
cp backend/scripts/dumps/reference_data_$(ls -t backend/scripts/dumps/ | head -1) install-usb/seed/

# USB로 전체 복사
cp -r . /Volumes/USB드라이브이름/track-block-management/
```

## USB → 서버 복사 후 기준데이터 복원

```bash
# 서버에서 실행
cd /opt/track-block-management/install-usb
bash scripts/restore-seed.sh
```

## 포함 데이터 목록

- **routes**: 레거시 노선 53개
- **organizations**: 14개 조직 (지역본부 12 + 사업단 2)
- **org_viewport**: 조직별 지도 초기 뷰포트
- **system_settings**: 색상 22개 + 지도설정 2개
- **rail_routes**: 전국 153개 노선
- **rail_stations**: 역 정보
- **rail_route_station_points**: KP 앵커 포인트 1,066개
- **rail_baseline_points**: 노선 중심선 기준점
- **rail_computed_geometry**: 계산된 노선 GeoJSON
- **rail_track_sections**: 구간별 선로 수
- **rail_facilities**: 시설물 (변전소, 신호기계실 등)
- **rail_facility_***: 시설물 분류·관리소·관할그룹
- **organization_route_ranges**: 조직별 관할 구간 (분야별)

## 주의사항

- `reference_data_*.sql` 파일은 보안상 git에 커밋하지 않습니다.
- 이 폴더의 `.sql` 파일은 USB/배포 시에만 사용합니다.
- **운영 데이터(block_orders 등)는 별도 백업 필요** — 기준데이터 덤프에 포함되지 않습니다.
