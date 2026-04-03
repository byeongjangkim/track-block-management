# maps — 노선도 제작 파이프라인

OSM(OpenStreetMap) 또는 VWORLD GIS 데이터를 사용해 커스텀 SVG 철도 노선도를 제작한다.
M2 MacBook (arm64, macOS 15) 기준. 스캔 이미지 파이프라인 없이 GIS 데이터만으로 제작한다.

---

## 환경 현황 (2026-04-03 기준)

| 도구 | 상태 | 설치 방법 |
|---|---|---|
| Python 3.12 | 설치됨 | — |
| Node.js 22 | 설치됨 | — |
| Homebrew | 설치됨 | — |
| GDAL (`ogr2ogr`) | **미설치** | `brew install gdal` |
| geopandas / shapely | **미설치** | `pip install geopandas shapely pyproj requests` |
| mapshaper | **미설치** | `npm install -g mapshaper` |
| QGIS | **미설치** | `brew install --cask qgis` (선택사항, GUI 편집용) |
| Inkscape | **미설치** | `brew install --cask inkscape` (선택사항, SVG 수동 편집) |

### Phase 1 최소 설치 (필수)

```bash
# 1. GDAL (ogr2ogr — GeoJSON 가공)
brew install gdal

# 2. Python GIS 스택 (maps 전용 가상환경)
cd maps
python3 -m venv .venv
source .venv/bin/activate
pip install geopandas shapely pyproj requests

# 3. mapshaper (GeoJSON → SVG 변환)
npm install -g mapshaper
```

### 선택 설치 (GUI 편집 필요 시)

```bash
# QGIS — 시각적 확인·편집 (용량 크므로 필요 시에만 설치)
brew install --cask qgis

# Inkscape — SVG 수동 후처리
brew install --cask inkscape
```

---

## 데이터 소스

### 1순위: OpenStreetMap (Overpass API)

- **URL:** https://overpass-turbo.eu
- **라이선스:** ODbL 1.0 (출처 표기 의무, 내부 업무용 사용 가능)
- **형식:** GeoJSON / XML
- **특징:** API 키 불필요, 즉시 사용 가능

#### 부산경남 철도 Overpass 쿼리

```
[out:json][timeout:60];
(
  way["railway"="rail"](34.5,128.0,36.0,130.0);
  way["railway"="rail"]["usage"="main"](34.5,128.0,36.0,130.0);
);
out geom;
```

- overpass-turbo.eu 에서 위 쿼리 실행 → Export → GeoJSON → `raw/osm_busan_gyeongnam.geojson` 저장

#### Python으로 직접 다운로드

```bash
# pipeline/download_osm.py 실행
python pipeline/download_osm.py
# → raw/osm_busan_gyeongnam.geojson 생성
```

### 2순위: VWORLD (국가공간정보포털)

- **URL:** https://www.vworld.kr → 오픈API → WFS
- **라이선스:** 공공누리 1유형 (출처 표기 후 자유 이용)
- **형식:** SHP, GeoJSON
- **특징:** API 키 필요 (무료 발급), 공식 국가 데이터

---

## 파이프라인 개요

```
[1단계] 데이터 수집
  Overpass API → raw/osm_busan_gyeongnam.geojson
  (또는 VWORLD WFS → raw/vworld_railway.shp)

[2단계] 노선별 GeoJSON 분리 (Python + geopandas)
  pipeline/extract_routes.py
  → processed/gyeongbu.geojson
  → processed/gyeongjeon.geojson
  → processed/donghae.geojson
  ...

[3단계] SVG 변환 (mapshaper)
  mapshaper processed/gyeongbu.geojson \
    -proj merc \
    -simplify 0.5% \
    -o format=svg svg/gyeongbu.svg

[4단계] 거리정 앵커 포인트 매핑 (Python CLI)
  pipeline/anchor_editor.py --route gyeongbu
  → anchors/gyeongbu.json

[5단계] 시설물 JSON 작성 (텍스트 편집기)
  → facilities/gyeongbu.json

[6단계] 프론트엔드 배포
  pipeline/deploy.py --route gyeongbu
  → ../frontend/public/maps/gyeongbu.svg 복사
```

---

## 디렉토리 구조

```
maps/
├── raw/                            # 원본 다운로드 데이터 — .gitignore
│   ├── osm_busan_gyeongnam.geojson # Overpass API 다운로드 결과
│   └── vworld_railway.shp          # VWORLD 다운로드 결과 (선택)
├── processed/                      # 노선별 분리 GeoJSON — .gitignore
│   ├── gyeongbu.geojson
│   ├── gyeongjeon.geojson
│   └── donghae.geojson
├── svg/                            # 완성된 SVG 파일 (git 포함)
│   ├── gyeongbu.svg
│   └── ...
├── anchors/                        # 거리정 앵커 포인트 JSON (git 포함)
│   ├── gyeongbu.json
│   └── ...
├── facilities/                     # 시설물 JSON (git 포함)
│   ├── gyeongbu.json
│   └── ...
├── station_maps/                   # 역구내 배선도 SVG (Phase 3)
│   └── ...
├── pipeline/
│   ├── download_osm.py             # Overpass API → GeoJSON 다운로드
│   ├── extract_routes.py           # 노선별 GeoJSON 분리 (geopandas)
│   ├── anchor_editor.py            # 거리정 앵커 포인트 CLI 편집기
│   └── deploy.py                   # SVG를 frontend/public/maps/ 에 복사
├── .gitignore
└── requirements.txt
```

---

## 스크립트별 상세

### pipeline/download_osm.py

Overpass API를 호출해 부산경남 범위의 철도 GeoJSON을 저장한다.

```python
import requests, json, pathlib

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
QUERY = """
[out:json][timeout:60];
(
  way["railway"="rail"](34.5,128.0,36.0,130.0);
);
out geom;
"""

def main():
    resp = requests.post(OVERPASS_URL, data={"data": QUERY}, timeout=90)
    resp.raise_for_status()
    pathlib.Path("raw").mkdir(exist_ok=True)
    with open("raw/osm_busan_gyeongnam.geojson", "w", encoding="utf-8") as f:
        # Overpass JSON → GeoJSON 변환은 osmtogeojson 또는 수동 변환
        json.dump(resp.json(), f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
```

> Overpass 응답은 OSM 자체 JSON 포맷. GeoJSON으로 변환 시 `osmtogeojson` (npm) 사용:
> `npm install -g osmtogeojson`
> `osmtogeojson raw/osm_busan_gyeongnam.json > raw/osm_busan_gyeongnam.geojson`

### pipeline/extract_routes.py

OSM GeoJSON에서 노선명 태그(`name` 속성)로 필터링해 노선별 GeoJSON을 분리한다.

```python
import geopandas as gpd, pathlib, sys

ROUTE_FILTERS = {
    "gyeongbu":   ["경부선"],
    "gyeongjeon": ["경전선"],
    "donghae":    ["동해선", "부전마산복선전철"],
    "jinhae":     ["진해선"],
}

def main():
    gdf = gpd.read_file("raw/osm_busan_gyeongnam.geojson")
    pathlib.Path("processed").mkdir(exist_ok=True)
    for code, names in ROUTE_FILTERS.items():
        mask = gdf["name"].isin(names)
        subset = gdf[mask]
        if subset.empty:
            print(f"[경고] {code}: 데이터 없음 — OSM 태그 확인 필요")
            continue
        subset.to_file(f"processed/{code}.geojson", driver="GeoJSON")
        print(f"[완료] processed/{code}.geojson ({len(subset)}개 way)")

if __name__ == "__main__":
    main()
```

> OSM 태그의 `name` 값이 정확히 맞지 않을 수 있음. 실행 후 결과 확인 필수.

### mapshaper SVG 변환 명령

```bash
# 단일 노선 변환
mapshaper processed/gyeongbu.geojson \
  -proj merc \
  -simplify 0.5% \
  -o format=svg svg/gyeongbu.svg

# 전체 노선 일괄 변환 (bash 루프)
for route in gyeongbu gyeongjeon donghae jinhae; do
  mapshaper processed/${route}.geojson \
    -proj merc -simplify 0.5% \
    -o format=svg svg/${route}.svg
done
```

> `-proj merc`: 메르카토르 투영 (SVG 좌표 왜곡 최소화)
> `-simplify 0.5%`: 과도한 노드 수 감소 (SVG 파일 용량 절감)

### pipeline/anchor_editor.py

SVG 파일을 브라우저로 열어 특정 지점의 SVG 좌표를 확인하고, 해당 km값을 입력하는 CLI 인터랙티브 도구.

```bash
python pipeline/anchor_editor.py --route gyeongbu
# → SVG 좌표와 km 값을 대화식으로 입력
# → anchors/gyeongbu.json 저장
```

### pipeline/deploy.py

완성된 SVG를 프론트엔드 public 디렉토리에 복사한다.

```bash
python pipeline/deploy.py --route gyeongbu
# → ../frontend/public/maps/gyeongbu.svg
```

---

## 앵커 포인트 JSON 형식

```json
{
  "route": "경부선",
  "route_code": "gyeongbu",
  "start_km": 0.0,
  "end_km": 451.8,
  "up_offset_px": -6,
  "down_offset_px": 6,
  "anchors": [
    { "km": 0.0,   "x": 120.5, "y": 980.2 },
    { "km": 50.0,  "x": 145.3, "y": 870.1 },
    { "km": 100.0, "x": 178.9, "y": 750.6 }
  ]
}
```

- 앵커 사이 구간은 프론트엔드 `mapCoord.ts`에서 선형 보간으로 계산
- `up_offset_px`: 상선 표시 y 오프셋 (음수 = 위쪽)
- `down_offset_px`: 하선 표시 y 오프셋 (양수 = 아래쪽)
- SVG 좌표는 mapshaper 변환 후 브라우저 개발자 도구(요소 검사)로 확인

---

## 시설물 JSON 형식

```json
{
  "route_code": "gyeongbu",
  "facilities": [
    { "type": "STATION",    "km": 325.4, "name": "구포역",       "has_station_map": true },
    { "type": "CROSSING",   "km": 310.2, "name": "덕두건널목",   "has_station_map": false },
    { "type": "SUBSTATION", "km": 290.0, "name": "삼랑진변전소", "has_station_map": false }
  ]
}
```

시설물 type 종류: `STATION` / `CROSSING` / `OVERPASS` / `SUBSTATION` / `TUNNEL` / `BRIDGE`

---

## requirements.txt

```
geopandas
shapely
pyproj
requests
```

---

## Phase 1 작업 순서 (경부선 시범)

```bash
# 0. 환경 준비
brew install gdal
npm install -g mapshaper osmtogeojson
cd maps && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. OSM 데이터 다운로드
python pipeline/download_osm.py
osmtogeojson raw/osm_busan_gyeongnam.json > raw/osm_busan_gyeongnam.geojson

# 2. 노선별 GeoJSON 분리
python pipeline/extract_routes.py

# 3. SVG 변환
mapshaper processed/gyeongbu.geojson -proj merc -simplify 0.5% -o format=svg svg/gyeongbu.svg

# 4. 브라우저에서 SVG 확인
open svg/gyeongbu.svg

# 5. 거리정 앵커 포인트 입력
python pipeline/anchor_editor.py --route gyeongbu

# 6. 시설물 JSON 작성 (VSCode로 직접 편집)
code facilities/gyeongbu.json

# 7. 프론트엔드에 배포
python pipeline/deploy.py --route gyeongbu
```

---

## 주의사항

- `raw/`, `processed/` 는 `.gitignore` 처리 (대용량 바이너리 및 다운로드 파일)
- `svg/`, `anchors/`, `facilities/` 는 git에 포함 (산출물)
- OSM 데이터의 노선명(`name` 태그) 불일치 가능 → `extract_routes.py` 실행 후 경고 메시지 확인
- mapshaper SVG의 viewBox는 노선마다 다름 — 앵커 좌표는 각 SVG 기준 좌표
- **대상 노선 목록 도메인 담당자 확인 필요** (경부선·경전선·동해선·진해선 외 추가 여부)
- VWORLD 사용 시 API 키 발급 필요 (vworld.kr → 오픈API 신청)
