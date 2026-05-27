# scripts — 유틸리티 스크립트

초기 데이터 로딩 및 DB 유지보수 스크립트 모음.
M2 MacBook 네이티브 환경 기준.

---

## 디렉토리 구조

```
scripts/
├── CLAUDE.md
├── import_rail_routes.py            # 최종 노선현황목록 KP XLSX → rail_routes
├── import_rail_station_baseline.py  # KORAIL 역 관리목록 XLSX → rail_routes/stations/route_station_points
├── import_station_management.py     # 소속별 역 현황 XLSX → 관리역/소속역 관계
├── rebuild_rail_baseline_points.py  # 역 중심점 → rail_baseline_points 재생성
└── replace_stations.py   # maps/data/stations.csv → facilities 역 데이터 전체 교체
```

---

## 데이터 입력 방식

| 데이터 종류 | 입력 방법 |
|---|---|
| 조직·노선·관할구간·초기 관리자 | `database/seeds/` 스크립트 (최초 1회) |
| 최종 노선 기본정보 | `import_rail_routes.py` → 최종 노선현황목록 KP XLSX |
| 역 중심 KP 원천 데이터 | `import_rail_station_baseline.py` → KORAIL 역 관리목록 XLSX |
| 관리역·소속역 관계 | `import_station_management.py` → 소속별 역 현황 XLSX |
| D3/KP 보간 baseline | `rebuild_rail_baseline_points.py` → 역 중심점 anchor 재생성 |
| 기존 시설물/역 호환 데이터 | `replace_stations.py` → legacy `facilities` 테이블 |
| 철도시설물 (최종 구조) | `rail_facilities` / `rail_facility_management_offices` — import 스크립트 예정 |
| 차단명령 | 웹 UI → 차단명령 등록 |

> **원칙:** SQLite DB가 Single Source of Truth. 파일은 입력 수단이며 데이터 저장소가 아니다.

---

## import_rail_routes.py

`최종_노선현황목록_KP기반.xlsx`를 읽어 `rail_routes`에 노선 기본정보를 저장한다.
기존 `rail_routes` 행은 `korail_route_code` 기준으로 갱신하고, 노선별 역/KP 원천 데이터는 삭제하지 않는다.

**처리 내용:**
- 노선코드, 노선구분, 노선명 저장
- 시작역/종료역 코드·명칭·KP·GPS 저장
- 역수, 노선길이(KP), 산정기준, 사용유무 저장
- `--mark-missing-inactive` 지정 시 엑셀에 없는 기존 노선을 비활성 처리

**실행:**

```bash
python3 scripts/import_rail_routes.py "/path/to/최종_노선현황목록_KP기반.xlsx" --db backend/db.sqlite3
```

---

## replace_stations.py

`maps/data/stations.csv`를 읽어 `facilities` 테이블의 역(`type='역'`) 데이터를 전체 교체한다.
stations.csv는 임시 데이터 소스이며, 향후 웹 UI CSV 업로드로 대체 예정.

**처리 내용:**
- `type='역'` 전체 삭제 후 재입력
- 관리역 목록 기준으로 `station_type` 자동 분류 (`관리역` / `보통역` / `신호장` / `신호소`)
- 경강선 → 여주 이하는 `gyeonggang`, 그 이상은 `gangneung`(강릉선)으로 분기 처리

**실행:**

```bash
cd backend && source .venv/bin/activate && cd ..
python scripts/replace_stations.py
```

---

## import_rail_station_baseline.py

KORAIL 역 관리목록 XLSX를 읽어 `rail_routes`, `rail_stations`, `rail_route_station_points`에 저장한다.
좌표가 없어도 `역중심 KP`가 있으면 저장한다. 좌표와 `역중심 KP`가 모두 있는 역만 `rail_baseline_points` anchor가 된다.

**처리 내용:**
- 같은 물리 역은 `rail_stations`에 1회 저장
- 노선별 역 순서·KP·구내 범위는 `rail_route_station_points`에 저장
- `yard_start_kp`, `yard_end_kp` 보존
- 최신 역명 보정: `디지털시티` → `DMC`, `남동인더스` → `남동인더스파크`
- `rail_baseline_points` 테이블이 있으면 역 중심점 baseline도 함께 재생성
- `--replace` 지정 시 기존 `rail_*` baseline 데이터 전체 교체

**실행:**

```bash
python3 scripts/import_rail_station_baseline.py "/path/to/역관리목록.xlsx" --db backend/db.sqlite3 --replace
```

---

## import_station_management.py

최신 `소속별 역 현황.xlsx`를 읽어 `rail_station_management_groups`, `rail_station_management_members`를 저장한다.
파일에 등장하는 역은 GPS가 없어도 모두 `rail_stations`에 등록한다.

**처리 내용:**
- 관리역은 `station_role='관리역'`, `station_type='관리역'`
- 소속역은 현재 모두 `station_role='소속역'`, `station_type='보통역'`
- 파일에 있지만 기존 역/KP 원천 데이터에 없는 역은 `MGMT_...` 코드로 생성
- 최신 역명 보정: `디지털시티` → `DMC`, `남동인더스` → `남동인더스파크`

**실행:**

```bash
python3 scripts/import_station_management.py "/path/to/소속별 역 현황.xlsx" --db backend/db.sqlite3 --replace
```

---

## rebuild_rail_baseline_points.py

`rail_route_station_points`의 역 중심점과 역 구내 시작·종료점을 `rail_baseline_points`의 station anchor로 재생성한다.
`station_yard_start`, `station_yard_end` 좌표는 같은 노선의 `station_center` anchor를 기준으로 KP 선형 보간한다.
시설물·수동 보정점은 삭제하지 않고, 역 관련 source만 교체한다.

**실행:**

```bash
python3 scripts/rebuild_rail_baseline_points.py --db backend/db.sqlite3
```

---

## 주의사항

- 모든 스크립트는 `backend/.venv` 가상환경 활성화 상태에서 실행
- `replace_stations.py` 실행 시 기존 역 데이터 전량 삭제됨 — 실행 전 확인 필수
