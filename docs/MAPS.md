# GIS 파이프라인

---

## 아키텍처 개요

```
rail_baseline_points (KP+GPS anchor 원천)
  ↓ center_only 모드: station_center + facility_point/start/end
  ↓ all_points 모드: rail_computed_geometry 사용
  ↓
D3 geoMercator projection (scale=12180, Korea 기준)
  1 SVG unit ≈ 418m
  ↓
SVG 렌더링 (zoom transform으로 자연 스케일)
```

---

## 역 좌표 모드 (`station_points_mode`)

`system_settings.map_settings.station_points_mode` 로 제어.

| 모드 | 앵커 | 특징 |
|---|---|---|
| `center_only` (기본) | station_center + facility_point/start/end | 역 진입로 굴곡 없음 |
| `all_points` | rail_computed_geometry 전체 | 역 구내 굴곡 발생 가능 |

### center_only 앵커 규칙

```python
# backend/app/api/v1/map.py
_CENTER_ONLY_POINT_TYPES = "('station_center', 'facility_point', 'facility_start', 'facility_end')"
```

- `facility_start/end` (터널·교량 경계): **반드시 포함** — 본선 위에 있음
- `station_yard_start/end` (역 진입로): **반드시 제외** — 곡선 굴곡 유발

**⚠️ 일관성 규칙**: 노선 렌더링과 차단명령 KP 보간이 동일 앵커 셋 사용 필수.  
불일치 시 차단구간이 선로에서 시각적으로 이탈함 (실제 사례: 경부고속선 천안아산 구간).

---

## KP 보간

### `_interpolate_rail_kp(db, rail_route_id, kp, center_only)`
임의 KP → (lat, lon) 선형 보간.

### `_rail_kp_range_coords(db, rail_route_id, start_kp, end_kp, center_only)`
KP 범위 → 좌표 목록.  
시작/종료점은 보간, 중간 앵커는 범위 내 실제 포인트 사용.

---

## SVG 렌더링 — 선로 오프셋

`TRACK_HALF_GAP_SVG = 0.5` 기준 (k ≥ 3에서 복선 분리 시작):

```typescript
// 선로 오프셋 (SVG 단위, zoom 무관)
// TRACK_HALF_GAP_SVG = 0.5
trackOffsetsSvg(trackCount):
  단선(1): [0]
  복선(2): [-0.5, +0.5]
  2복선(4): [-1.5, -0.5, +0.5, +1.5]
  3복선(6): [-2.5, -1.5, -0.5, +0.5, +1.5, +2.5]
```

- 상선 계열: 음수 오프셋 (SVG 기준 위쪽)
- 하선 계열: 양수 오프셋 (SVG 기준 아래쪽)
- **복선 분리 시작**: `showMultiTrack = k >= 3` — k < 3에서는 단일 중심선 표시

줌 배율별 상하선 중심간격 (px):

| k | 3 | 5 | 7 | 10 | 15 | 20 | 25 |
|---|---|---|---|---|---|---|---|
| 간격(px) | 3 | 5 | 7 | 10 | 15 | 20 | 25 |

### 노선 선 두께

노선 선로는 `capStrokeSvg` 미사용 — 별도 함수로 화면 픽셀을 선형 증가 후 고정:

```typescript
// 화면 픽셀 목표: min(1.6, 0.4 + 0.2×k)
// SVG 단위 = 목표픽셀 / k  (zoom transform이 ×k 배율 적용)
routeStrokeWidthSvg(k) = min(1.6, 0.4 + 0.2×k) / k

// k=2: 0.8px | k=3: 1.0px | k=4: 1.2px | k=5: 1.4px | k≥6: 1.6px 고정
```

### Stroke Soft Cap (기타 레이어)

```typescript
// k≤capZoom: 자연 성장, k>capZoom: 화면 픽셀 고정
capStrokeSvg(svgVal, k, capZoom) = svgVal * min(1, capZoom/k)
```

capZoom 기본값=5 (시스템 설정에서 조정).  
zoom handler에서 차단구간·전차선단전·관할구간 등에 적용 — **새 레이어 추가 시 반드시 적용**.  
노선 선로(`path.route-computed`)는 `routeStrokeWidthSvg(k)` 사용.

---

## 배경 지도 (절대 변경 금지)

```
maps/data/
├── korea_map_level1.geojson   시도 17개 (level2 unary_union)
└── korea_map_level2.geojson   시군구 255개 (NGII 데이터)
```

API: `GET /api/v1/map/sigungu?level=2`  
`@lru_cache(maxsize=2)` — 파일 변경 시 백엔드 재시작 필요.

시도 경계는 level2 데이터를 `sig_cd` 앞 2자리로 `unary_union` 생성.

---

## 시설물 표시 (zoom 임계값)

| 임계값 | 대상 |
|---|---|
| ZOOM_STATION = 0.8 | 관리역 |
| ZOOM_STATION2 = 3 | 보통역·무인역·신호장·신호소 |
| ZOOM_SEGMENT = 3 | 구조물 LineString (터널·교량) |
| ZOOM_DETAIL = 8 | 변전소·건널목·분기 |

---

## 전기시설물 오프셋 표시 (`facilityOffsetPoint`)

변전소(`type='변전소'`)는 실제 GPS 위치 대신 **최외방 선로 1간격 외방 고정 위치**에 표시.

### 적용 조건

- `type === '변전소'` 이고 `direction` 값이 있으며 `direction !== '상하선'`인 경우만 오프셋 적용
- `direction='상하선'`: 좌우 방향 결정 불가 → GPS 위치 유지

### 알고리즘 3단계

```
① 선로 중심선 KP 보간 (center_only 앵커 사용)
   routeCoords 배열에서 시설물 KP를 감싸는 브래킷(lo, hi) 탐색
   t = (kp - kpA) / (kpB - kpA)
   cLon = lonA + t*(lonB-lonA),  cLat = latA + t*(latB-latA)
   → D3 proj([cLon, cLat]) = center (SVG 좌표)

② GPS → 선로 중심 방향 벡터 산출
   gpsPos = proj([gpsLon, gpsLat])
   vx = gpsPos[0] - center[0]
   vy = gpsPos[1] - center[1]
   dist = √(vx²+vy²)
   (GPS가 실제 선로 측에 입력되므로 방향 벡터가 자동으로 선로 외방을 가리킴)

③ 최외방 선로 외방으로 배치
   targetDist = trackCount × TRACK_HALF_GAP_SVG
   display = center + (vx,vy)/dist × targetDist
```

### 선로 수별 표시 거리

| 선로 수 | 최외방 선로 오프셋 | targetDist (SVG) |
|---|---|---|
| 단선(1) | ±0 | **0.5** |
| 복선(2) | ±0.5 | **1.0** |
| 2복선(4) | ±1.5 | **2.0** |
| 3복선(6) | ±2.5 | **3.0** |

### KP별 선로 수 결정 (`getTrackCountAtKp`)

```typescript
// rail_track_sections 구간 내에 있으면 해당 track_count 반환
// 없으면 rail_routes.default_track_count 반환
function getTrackCountAtKp(kp, defaultCount, sections): number
```

데이터 소스:
- `routeCoordsMapRef`: `allRailGeo` feature geometry (center_only 앵커 좌표 배열)
- `routeTrackCountMapRef`: `allRailGeo` feature `default_track_count`
- `routeTrackSectionsMapRef`: `allRailGeo` feature `track_sections` (KP 구간별 선로 수)

모두 `GET /api/v1/map/rail-routes/all/geometry?station_mode=center_only` 응답에서 채움.

### 레이블 형식

```
name + station_type.toUpperCase()
예: "익산PP", "금곡SSP", "소하SP", "갈매신호기계실"
```

툴팁은 기존 형식 유지: `"sp 소하 / 경부고속선 19.264km"`

### 주의사항

- `dist < 1e-3` (GPS ≈ 선로 중심): 오프셋 적용 불가 → GPS 위치 유지
- `routeCoords`는 center_only 모드(역 중심+터널교량 경계)만 사용 → 역 간격이 긴 곡선 구간에서 미세 위치 오차 가능 (방향 판별은 정확)
- 구현 위치: `_updateFacilityVisibility(k)` 함수 내 (줌 변경마다 재계산)
