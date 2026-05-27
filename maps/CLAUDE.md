# maps — GIS 파이프라인

---

## 역할 구분

| 데이터 종류 | 저장 위치 | 설명 |
|---|---|---|
| **노선 geometry** | `route_geometry` DB 테이블 | SHP·CSV 입력, km 보간, LOD 자동 생성 |
| **시도·시군구 경계** | `maps/data/*.geojson` 정적 파일 | NGII 데이터 전처리, 서버 파일 서빙 |

---

## 1. 노선 geometry (route_geometry 테이블)

### source 컬럼으로 레이어 분리

| source | 입력 | km | 표시 |
|---|---|---|---|
| `shp` | 국가기본도 SHP 파싱 | NULL | 점선·흐린 색 (참조용) |
| `user` | 관리자 CSV 업로드 | 필수 | 실선·진한 색 (공식) |

**원칙:** user 데이터가 있는 노선은 user 레이어만 표시. shp 데이터는 user 업로드 완료 후 삭제.

### segment 번호 기준

| segment | 의미 |
|---|---|
| `0` | 선로 중앙선 (본선 대표, Phase 1 현재 이것만 사용) |
| `1` | 하선(Down) / T1 (고속) |
| `2` | 상선(Up) / T2 (고속) |
| `3+` | 추가 선로, 역구내 측선 |

### 데이터 흐름

**경로 A — SHP import (source='shp')**
```bash
cd maps && source ../backend/.venv/bin/activate
python3 pipeline/import_shp_to_geometry.py --route gyeongbu  # 단일
python3 pipeline/import_shp_to_geometry.py --all              # 전체
```

**경로 B — CSV 직접 업로드 (source='user')**
```
CSV 컬럼: segment, seq, lat, lon, km
```
- 웹 UI: 노선도 관리 → CSV 업로드
- 업로드 시 기존 user 데이터 교체, LOD(mid·low) 자동 생성

### LOD 전환 기준 (D3 줌 스케일 k 기준)

| D3 줌 k | LOD | 목표 간격 |
|---|---|---|
| k < 3 | `low` | 10 km |
| 3 ≤ k < 8 | `mid` | 2 km |
| k ≥ 8 | `high` | 500 m |

---

## 2. 배경 지도 — 시도·시군구 경계 (정적 GeoJSON)

### 파일 구성

```
maps/data/
├── korea_map_level1.geojson   # 17개 시도 경계 (315 KB)
└── korea_map_level2.geojson   # 255개 시군구 경계 (1.2 MB, NGII 38MB 원본에서 단순화)
```

### 생성 방식 — Level 1 (시도)

`korea_map_level1.geojson`은 **`korea_map_level2.geojson`(시군구)을 시도 코드별로 `unary_union`하여 생성**.

```python
# sig_cd 앞 2자리로 그룹화 → shapely.ops.unary_union() → simplify(0.0005) → strip_holes()
```

이 방식을 사용하는 이유:
- 시군구 경계를 병합하면 내부 경계선이 완전히 제거되어 올바른 시도 외곽선만 남음
- `provinces-geo.json` 등 외부 소스는 인천-경기도 경계가 소실되거나 self-intersecting 오류 발생
- Level 2 NGII 데이터(sig_cd 코드 정확)가 가장 신뢰할 수 있는 소스

후처리:
- `area < 0.0001` 조각 제거 (한강 하중도, 연안 미소 섬 등)
- `strip_holes()`: 내부 hole 제거 (한강·저수지 등 수계가 hole로 생성되는 문제 해결)

재생성 명령:
```bash
cd backend && source .venv/bin/activate && cd ..
python3 - << 'EOF'
# maps/data/korea_map_level2.geojson → korea_map_level1.geojson
# (unary_union + simplify + strip_holes)
EOF
```
> 재생성이 필요한 경우: database/seeds/routes.py 참고, 또는 이 세션 기록 참조

### API

```
GET /api/v1/map/sigungu?level=1    # 시도 17개만
GET /api/v1/map/sigungu?level=2    # 시도 17개 + 시군구 255개
```

- 서버 `@lru_cache(maxsize=2)`로 캐시 → **파일 변경 시 백엔드 재시작 필수**
- 파일 경로: `Path(__file__).resolve().parent×5 / "maps" / "data"`

### GeoJSON Feature 구조

```json
{
  "properties": {
    "sig_cd":      "28",         // 시도 코드 (Level 1: 2자리, Level 2: 5자리)
    "name":        "인천광역시",
    "full_name":   "인천광역시",
    "admin_level": 1,            // 1=시도, 2=시군구
    "centroid":    [126.38, 37.57]
  }
}
```

### 렌더링 규칙 (D3.js)

| 항목 | Level 1 (시도) | Level 2 (시군구) |
|---|---|---|
| 채움 | 시도별 연한 색 (불투명도 0.15) | 없음 |
| 선 색 | `#6b8299` | `#8fa5b8` |
| 선 굵기 | 1.0 px | 0.5 px |
| 표시 조건 | 항상 | zoom ≥ 1.5 |

시도별 채움색: 4색 배분 원칙 (인접 시도 구분)
- 연장밋빛(서울·세종·경남·강원), 연파랑(부산·충북·전남·제주)
- 연보라(대구·울산·전북), 연에메랄드(인천·충남·경북)
- 연노랑(광주·대전·경기)

### 핵심 교훈 (시행착오)

| 실패한 접근 | 이유 |
|---|---|
| `provinces-geo.json` 단순화 버전 사용 | 인천-경기도 경계 소실 |
| 사용자 정의 RDP 적용 | self-intersecting 폴리곤 생성 (TopologyException) |
| `sigungu_geometry` DB 테이블 유지 | 대용량(22,962행), 정적 GeoJSON이 훨씬 효율적 |
| 외부 province-level GeoJSON 사용 | 내부 구/시/군 경계 미병합으로 망가진 경계 표시 |

**올바른 방법: Level 2(시군구) → `unary_union` → Level 1(시도) 생성**

---

## 파일 구성

```
maps/
├── pipeline/
│   ├── add_route.py                  # 신규 노선 추가 통합
│   ├── download_osm.py               # Overpass API → osm_korea.geojson
│   ├── extract_routes.py             # osm_korea.geojson → 노선별 GeoJSON 분리
│   ├── import_geometry.py            # 노선 GeoJSON → route_geometry DB
│   ├── import_shp_to_geometry.py     # SHP → route_geometry source='shp'
│   └── seed_org_viewport.py          # org_viewport 초기값 DB 입력
├── data/
│   ├── korea_map_level1.geojson      # 17개 시도 (unary_union 생성)
│   ├── korea_map_level2.geojson      # 255개 시군구 (NGII 기반)
│   └── stations.csv                  # 역 마스터 (replace_stations.py 입력)
└── raw/
    └── railway_line/
        └── TN_RLROAD_CTLN.*          # 국가기본도 SHP (.gitignore)
```

---

## 관련 문서

| 문서 | 내용 |
|---|---|
| [ROUTE_MANAGEMENT.md](ROUTE_MANAGEMENT.md) | 51개 노선 등록 현황 |
| [../database/CLAUDE.md](../database/CLAUDE.md) | route_geometry 스키마 상세 |
| [../backend/CLAUDE.md](../backend/CLAUDE.md) | /map/sigungu API, geometry 관리 API |
