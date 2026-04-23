# 노선 관리 절차

노선 GIS 데이터는 `route_geometry` 테이블에 **source 컬럼**으로 레이어를 분리 관리한다.

| source | 의미 | km | 표시 방식 |
|---|---|---|---|
| `shp` | 국가기본도 SHP 추출 (형태 참조용) | NULL | 점선·흐린 색 |
| `user` | 관리자 CSV 직접 업로드 (공식 데이터) | 필수 | 실선·진한 색 |

**원칙:** user 데이터가 있는 노선은 user 레이어로 표시. shp 데이터는 user 업로드 완료 후 단계적 삭제.

---

## 노선 등록 현황 (51개)

> 범례: SHP=SHP import 여부, USER=user CSV 업로드 여부, geometry=route_geometry 존재 여부

### 고속철도 (6개)

| 노선 코드 | 노선명 | km 범위 | SHP | USER | 비고 |
|---|---|---|---|---|---|
| `gyeongbu_high` | 경부고속선 (KTX) | 0~417.0 | ✅ | ⬜ | |
| `honam_high` | 호남고속선 | 0~182.3 | ✅ | ⬜ | |
| `gangneung` | 강릉선 | 0~120.7 | ✅ | ⬜ | |
| `donghae_ktx` | KTX동해선 | 0~87.0 | ✅ | ⬜ | |
| `jungbu_naeryuk` | 중부내륙선 | 0~93.0 | ✅ | ⬜ | |
| `suseo_pyeongtaek` | 수서평택고속선 | 0~61.0 | ✅ | ⬜ | |

### 보통철도 간선 (14개)

| 노선 코드 | 노선명 | km 범위 | SHP | USER | 비고 |
|---|---|---|---|---|---|
| `gyeongbu` | 경부선 | 0~451.8 | ✅ | ✅ | 시설물 일부 입력. user geometry 12,738pts (스크립트 변환) |
| `honam` | 호남선 | 0~251.5 | ✅ | ✅ | 5,212pts — km 추정값(Haversine), 공식 데이터 교체 필요 |
| `jeolla` | 전라선 | 0~180.4 | ✅ | ⬜ | |
| `gyeongjeon` | 경전선 | 0~278.8 | ✅ | ⬜ | |
| `donghae` | 동해선 | 0~188.6 | ✅ | ⬜ | |
| `jungang` | 중앙선 | 0~395.0 | ✅ | ⬜ | |
| `taebaek` | 태백선 | 0~93.2 | ✅ | ⬜ | |
| `yeongdong` | 영동선 | 0~192.6 | ✅ | ⬜ | |
| `gyeongchun` | 경춘선 | 0~80.7 | ✅ | ⬜ | |
| `janghang` | 장항선 | 0~154.7 | ✅ | ⬜ | |
| `chungbuk` | 충북선 | 0~115.0 | ✅ | ⬜ | |
| `gyeongwon` | 경원선 | 0~94.5 | ✅ | ⬜ | |
| `gyeongui` | 경의선 | 0~56.0 | ✅ | ⬜ | |
| `gyeongin` | 경인선 | 0~27.0 | ✅ | ⬜ | |

### 보통철도 지선 (28개)

| 노선 코드 | 노선명 | km 범위 | SHP | USER | 비고 |
|---|---|---|---|---|---|
| `gyeonggang` | 경강선 | 0~57.1 | ✅ | ⬜ | |
| `gyeongbuk` | 경북선 | 0~115.4 | ✅ | ⬜ | |
| `gwangju_line` | 광주선 | 0~14.1 | ✅ | ⬜ | |
| `goeodong` | 괴동선 | 0~18.0 | ✅ | ⬜ | |
| `gyooe` | 교외선 | 0~31.8 | ✅ | ⬜ | |
| `gunsan` | 군산선 | 0~21.7 | ✅ | ⬜ | |
| `gunsan_port` | 군산항선 | 0~4.0 | ✅ | ⬜ | |
| `daegu_line` | 대구선 | 0~58.0 | ✅ | ⬜ | |
| `daebul` | 대불선 | 0~21.0 | ✅ | ⬜ | |
| `deoksan` | 덕산선 | 0~8.5 | ✅ | ⬜ | |
| `mukho` | 묵호항선 | 0~4.0 | ✅ | ⬜ | |
| `mungyeong` | 문경선 | 0~21.0 | ✅ | ⬜ | |
| `busan_sinhang` | 부산신항선 | 0~10.0 | ✅ | ⬜ | |
| `bujeon_masan` | 부전마산선 | 0~29.4 | ✅ | ⬜ | |
| `buk_jeonju` | 북전주선 | 0~5.5 | ✅ | ⬜ | |
| `buk_pyeong` | 북평선 | 0~7.5 | ✅ | ⬜ | |
| `samcheok` | 삼척선 | 0~12.9 | ✅ | ⬜ | |
| `seohae` | 서해선 | 0~90.0 | ✅ | ⬜ | |
| `yeocheon` | 여천선 | 0~4.5 | ✅ | ⬜ | |
| `yeonmu` | 연무선 | 0~3.5 | ✅ | ⬜ | |
| `onsan` | 온산선 | 0~9.3 | ✅ | ⬜ | |
| `jeongseon` | 정선선 | 0~45.9 | ✅ | ⬜ | |
| `pyeongtaek` | 평택선 | 0~20.0 | ✅ | ⬜ | |
| `pohang_yoil` | 포항영일항만선 | 0~8.0 | ✅ | ⬜ | |
| `hambak` | 함백선 | 0~21.7 | ✅ | ⬜ | |
| `hwasun` | 화순선 | 0~15.0 | ✅ | ⬜ | |
| `gaeun` | 가은선 | 0~15.8 | ❌ | ⬜ | SHP 미수록 |
| `jinhae` | 진해선 | 0~21.3 | ✅ | ⬜ | |

### 보통철도 기타 (1개)

| 노선 코드 | 노선명 | km 범위 | SHP | USER | 비고 |
|---|---|---|---|---|---|
| `gaya` | 가야선 | 0~7.1 | ❌ | ⬜ | SHP 미수록 |

### 지하철(지상) — KORAIL 운영 (2개)

| 노선 코드 | 노선명 | km 범위 | SHP | USER | 비고 |
|---|---|---|---|---|---|
| `suin` | 수인선 | 0~52.8 | ✅ | ⬜ | |
| `bundang` | 분당선 | 0~52.7 | ✅ | ⬜ | |

---

## Step A. SHP import (source='shp', 형태 참조용)

SHP 데이터는 노선의 대략적 형태를 화면에 표시하기 위한 임시 참조 데이터다.
km=NULL, 선분 조각남, 방향 없음 등 한계가 있으므로 user 업로드 완료 후 삭제한다.

### 커맨드라인 실행

```bash
cd maps && source ../backend/.venv/bin/activate
python3 pipeline/import_shp_to_geometry.py --list    # 목록
python3 pipeline/import_shp_to_geometry.py --route gyeongbu   # 단일
python3 pipeline/import_shp_to_geometry.py --all     # 전체
```

### 웹 UI

노선도 관리 → "SHP import" 탭 → 노선 체크박스 선택 → import

---

## Step B. 노선도 CSV 업로드 (source='user', 공식 데이터)

KORAIL 공식 선로제원표 기반으로 관리자가 직접 작성·업로드한다.
이 데이터가 실제 노선도 렌더링·관할구간 슬라이싱의 기준이 된다.

### CSV 컬럼

```
segment,seq,lat,lon,km
```

| 컬럼 | 설명 | 필수 | 예시 |
|---|---|---|---|
| segment | 선분 번호 (본선=0, 지선·측선=1,2,...) | ✅ | 0 |
| seq | 선분 내 좌표 순번 (0부터 오름차순) | ✅ | 0, 1, 2 |
| lat | WGS84 위도 | ✅ | 37.5547 |
| lon | WGS84 경도 | ✅ | 126.9707 |
| km | KORAIL 공식 거리정 (소수점 1자리, km 단위) | ✅ | 0.0 |

**입력 규칙:**
- 본선(segment=0)은 시점(km=0)에서 종점 방향으로 seq를 오름차순으로 입력
- 지선·측선은 segment=1,2,... 로 분리
- km은 반드시 실제 KORAIL 거리정을 입력 (추정값 사용 금지)
- LOD high는 입력 데이터 그대로 저장, mid/low는 서버에서 자동 간소화

**CSV 예시 (경부선 일부):**
```
segment,seq,lat,lon,km
0,0,37.5547,126.9707,0.0
0,1,37.5480,126.9750,0.8
0,2,37.5390,126.9820,1.9
0,3,37.5300,126.9890,3.1
```

### 웹 UI

노선도 관리(`/admin/route-geometry`)
1. 해당 노선 행의 [템플릿] 버튼 → CSV 다운로드
2. CSV 편집 (KORAIL 선로제원표 기반 실제 km 입력)
3. [CSV 업로드] 버튼 → source='user'로 DB 저장, 기존 user 데이터 교체
4. [다운로드] 버튼 → 저장된 내용 확인

### SHP → user 변환 스크립트 (임시 방법)

KORAIL 공식 km 데이터가 없는 경우, SHP geometry에서 위도 기반 정렬 + Haversine 거리 계산으로 km를 추정한다.
**주의:** 이 방법은 정확한 거리정이 아닌 추정값이므로 추후 공식 데이터로 교체해야 한다.

```bash
cd backend && source .venv/bin/activate && cd ..
python scripts/gyeongbu_shp_to_user.py   # 경부선 예시
```

- 스크립트 위치: `scripts/gyeongbu_shp_to_user.py`
- 현황: 경부선(`gyeongbu`) — 12,738pts, km 0.0~451.8 ✅

### 검증

```bash
sqlite3 backend/db.sqlite3 "
SELECT source, COUNT(DISTINCT segment) segs, COUNT(*) pts,
       MIN(km) km_min, MAX(km) km_max
FROM route_geometry WHERE route_code='gyeongbu' AND lod='high'
GROUP BY source;
"
```

✅ user 행: km_min/km_max가 실제 거리정 범위 내, km NULL 없음

---

## Step C. SHP 데이터 삭제 (user 업로드 완료 후)

user 데이터 업로드가 완료되면 해당 노선의 shp 데이터를 삭제한다.

```bash
sqlite3 backend/db.sqlite3 "
DELETE FROM route_geometry WHERE route_code='gyeongbu' AND source='shp';
"
```

또는 웹 UI: 노선도 관리 → 해당 노선 → "SHP 데이터 삭제" 버튼

---

## 신규 노선 추가 절차

1. routes 테이블에 노선 등록:
   ```sql
   INSERT INTO routes (code, name, start_km, end_km)
   VALUES ('new_code', '노선명', 0.0, 100.0);
   ```

2. SHP에 해당 노선이 있으면:
   - `import_shp_to_geometry.py`의 `ROUTE_MAP`에 추가
   - `--route new_code`로 import (source='shp')

3. 노선도 CSV 업로드:
   - 노선도 관리 → 템플릿 다운로드 → 작성 → 업로드 (source='user')

4. SHP 데이터 삭제 (user 업로드 완료 후)

5. 브라우저에서 노선 표시 확인
