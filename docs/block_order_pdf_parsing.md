# 차단명령 PDF 파싱 명세

> 구현: `backend/app/services/pdf_parser_service.py`

---

## 문서 구조

KORAIL 차단명령 승인문서는 두 PDF로 구성:

| 문서 | 내용 | 파싱 방식 |
|---|---|---|
| **시행문** | 담당자·노선·문서번호 메타 | 정규식 텍스트 파싱 |
| **세부내역** | 일자별 차단 일정 표 | pdfplumber 테이블 추출 |

---

## 시행문 파싱 항목

| 항목 | DB 컬럼 | 비고 |
|---|---|---|
| 문서번호 | `doc_no` | 작업관리센터TF-XXXXXX |
| 노선명 | route_id (FK 변환) | |
| 시행부서장 | `dept_head` | |
| 작업책임자 | `work_supervisor` | 필수 |
| 안전관리자 | `safety_manager` | 필수 |
| 전기철도안전관리자 | `electric_safety_manager` | |
| 시공사 | `contractor` | |
| 분야 | `field` | 시설/전기/건축 |

---

## 세부내역 표 구조

```
[0]빈칸  [1]날짜  [2]구분  [3]시각  [4]역간구간  [5]지점km  [6]선로  [7]사유/시행사항
```

2행 1쌍 구조 (시작행 + 종료행).

| 컬럼 | DB 컬럼 |
|---|---|
| 날짜 | `work_date` |
| 시각(시작/종료) | `start_time`, `end_time` |
| 지점km | `start_km`, `end_km` |
| **선로** | **`tracks` (JSON 배열)** |
| 사유 | `reason` |

---

## 유효한 block_type

| block_type | 표시 | 비고 |
|---|---|---|
| `선로차단` | 노선 위 직접 | 장비/인력/기계 공통, 실선 |
| `전차선단전` | 노선 위 직접 | 변전소간 전차선 단전, 녹색 |
| `작업구간설정` | 최외방 +0.5×gap 외방 | 차단 없는 인력/기계, 실선 |
| `보호지구작업` | 최외방 +1.0×gap 외방 | 사각형+해칭, 신규 |
| `임시완속` | 노선 위 직접 | 점선 |
| `속도제한` | 노선 위 직접 | 점선 |

---

## 선로(tracks) 매핑 (`_TRACKS_MAP`)

| PDF 표기 | tracks 값 |
|---|---|
| 상선 | `["상선"]` |
| 하선 | `["하선"]` |
| 상하선, 상하 | `["상선","하선"]` |
| 상1/상2/상3 | `["상1"]` 등 |
| 하1/하2/하3 | `["하1"]` 등 |
| 단선 | `["상선"]` (사용자 확인 권장) |
| 구내 | `["상선"]` (사용자 확인 권장) |

---

## 전차선 단전 특이 처리

```
역간구간(단전구간): 청도SP ~ 밀양SS
지점km: (공란)
```
→ `start_km=NULL`, `section_note="청도SP~밀양SS"`

---

## 검토 필요(`needs_review`) 조건

- `tracks == null`
- `start_km == null` AND `section_note` 없음
- `field_confidence == 'low'`

---

## API

```
POST /api/v1/documents/parse-bulk    세부내역 다중 파싱
POST /api/v1/documents/parse-single  시행문 단건 파싱 (폼 자동 채움)
POST /api/v1/block-orders/bulk       파싱 결과 일괄 저장
```
