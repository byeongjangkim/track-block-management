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

```typescript
// 선로 오프셋 (SVG 단위, zoom 무관)
trackOffsetsSvg(trackCount):
  복선(2): [-1.0, +1.0]
  2복선(4): [-3.0, -1.0, +1.0, +3.0]
  3복선(6): [-5.0, -3.0, -1.0, +1.0, +3.0, +5.0]
```

- 상선 계열: 음수 오프셋 (SVG 기준 위쪽)
- 하선 계열: 양수 오프셋 (SVG 기준 아래쪽)

### Stroke Soft Cap

```typescript
// k≤capZoom: 자연 성장, k>capZoom: 화면 픽셀 고정
capStrokeSvg(svgVal, k, capZoom) = svgVal * min(1, capZoom/k)
```

capZoom 기본값=5 (시스템 설정에서 조정).  
zoom handler에서 모든 railway 레이어에 적용 — **새 레이어 추가 시 반드시 적용**.

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
