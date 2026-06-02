# 차단명령 승인문서 PDF 파싱 명세

> **관련 문서**
> - 구현 위치: [backend/app/services/pdf_parser_service.py](../backend/app/services/pdf_parser_service.py)
> - API 엔드포인트: [backend/CLAUDE.md](../backend/CLAUDE.md) — 문서/PDF 파싱 섹션
> - DB 스키마: [database/CLAUDE.md](../database/CLAUDE.md) — block_orders 테이블
> - 프론트엔드 UI 흐름: [frontend/UI_UX_pages.md](../frontend/UI_UX_pages.md) — 6.3 차단명령

---

## 1. KORAIL 차단명령 문서 구조

KORAIL 차단명령 승인문서는 **두 가지 PDF**로 구성된다.

| 문서 | 명칭 | 내용 | 파싱 방식 |
|---|---|---|---|
| **시행문** | 공문 (시행문서) | 담당자 정보, 노선, 문서번호 등 메타 정보 | 텍스트 기반 정규식 |
| **세부내역** | 차단명령 세부내역 | 일자별 차단 일정 표 | pdfplumber 테이블 추출 |

---

## 2. 시행문(공문) 파싱 항목

### 2.1 파싱 대상 항목

| 항목 | DB 컬럼 | 파싱 패턴 | 비고 |
|---|---|---|---|
| 문서번호 | `doc_no` | `작업관리센터TF-XXXXXX` | VARCHAR(30) |
| 노선명 | `route_id` (FK 변환) | 제목 또는 본문의 `XX선` | 노선명 → route_id 매핑 |
| 시행부서장 | `dept_head` | `시행부서장 홍길동(010-...)` | VARCHAR(50) |
| 시행부서장 연락처 | `dept_head_phone` | `(0\d{1,2}-\d{3,4}-\d{4})` | VARCHAR(20) |
| 작업책임자 | `work_supervisor` | `작업책임자 ... 홍길동(010-...)` | VARCHAR(50), 필수 |
| 작업책임자 연락처 | `work_supervisor_phone` | 이름 이후 100자 내 전화번호 | VARCHAR(20) |
| 철도운행안전관리자 | `safety_manager` | `철도운행안전관리자 ... 홍길동(...)` | VARCHAR(50), 필수 |
| 철도운행안전관리자 연락처 | `safety_manager_phone` | 이름 이후 100자 내 전화번호 | VARCHAR(20) |
| 전기철도안전관리자 | `electric_safety_manager` | `전기철도안전관리자 ... 홍길동(...)` | VARCHAR(50) |
| 전기철도안전관리자 연락처 | `electric_safety_manager_phone` | 이름 이후 100자 내 전화번호 | VARCHAR(20) |
| 시공사 | `contractor` | `시공사: XX건설(주)` | VARCHAR(100) |
| 열차감시원 | `train_watcher` | `열차감시원 홍길동(010-...)` | VARCHAR(50) |
| 열차감시원 연락처 | `train_watcher_phone` | 이름 이후 100자 내 전화번호 | VARCHAR(20) |
| 분야 | `field` | `분야: 시설/전기/건축` | 시설/전기/건축 |
| 동원장비 여부 | `has_equipment` | `모터카/트롤리/1종장비` 등 키워드 | Boolean |
| 인력 여부 | `has_labor` | `인력 트롤리/밀차` 키워드 | Boolean |

### 2.2 연락처 추출 방식

```python
_RE_PHONE = re.compile(r'(0\d{1,2}[-–]\d{3,4}[-–]\d{4})')

def _extract_name_phone(pattern, text):
    """패턴으로 이름 추출 → 이름 이후 100자 내 전화번호 검색"""
    m = pattern.search(text)
    if not m:
        return None, None
    name = m.group(1).strip()
    nearby = text[m.start(): m.start() + 100]
    mp = _RE_PHONE.search(nearby)
    return name, mp.group(1) if mp else None
```

### 2.3 대표 문서 패턴 (KORAIL 양식)

```
작업관리센터TF-123456
제목: 경부선 선로차단작업 시행

  시행부서장   홍길동(010-1234-5678)
  작업책임자   김철수(010-2345-6789)
  철도운행안전관리자  이영희(010-3456-7890)
  전기철도안전관리자  박민준(010-4567-8901)
  시공사: ○○건설(주)
  열차감시원  최감시(010-5678-9012)

동원장비: 모터카 1대, ...
```

---

## 3. 세부내역 파싱 항목

### 3.1 섹션 유형 (◐...◑ 헤더로 구분)

| 섹션명 | `block_type` 저장값 | 특이사항 |
|---|---|---|
| `◐각 열차 사이 차단◑` | `각열차사이차단` | 일반 km 구간 |
| `◐선로일시사용중지◑` | `선로일시사용중지` | 일반 km 구간 |
| `◐전차선 단전◑` | `전차선단전` | km 없음, 변전소 구간명 사용 |

### 3.2 세부내역 표 컬럼 구조

```
[0]빈칸  [1]날짜  [2]구분  [3]시각  [4]역간구간  [5]지점km  [6]선로  [7]사유/시행사항
```

2행 1쌍 구조: **시작행**과 **종료행**이 쌍을 이룬다.

| 컬럼 | 시작행 | 종료행 | DB 컬럼 |
|---|---|---|---|
| 날짜 | ✅ `2026-04-20` | (없음) | `work_date` |
| 구분 | `당일`/`기간` | - | (저장 안 함, 날짜로 충분) |
| 시각 | ✅ 시작 시각 | ✅ 종료 시각 | `start_time`, `end_time` |
| 역간구간 | 역간 구간명 or SP/SS명 | 종료 SP/SS명 | `section_note` (단전 시) |
| 지점km | ✅ 시작km | ✅ 종료km | `start_km`, `end_km` |
| 선로 | ✅ 선로명 (상선/하선/상1/하1 등) | - | `tracks` (JSON 배열) |
| 사유/시행사항 | ✅ 작업 사유 | 추가 비고 | `reason` |

### 3.3 전차선 단전 처리

전차선 단전 섹션은 **역간구간 열에 SP/SS 변전소명** 사용, km 없음.

```
역간구간(단전구간): 청도SP ~ 밀양SS
지점km: (공란)
```

→ DB 저장:
- `start_km = NULL`, `end_km = NULL`
- `section_note = "청도SP~밀양SS"`

변전소 명칭 약어:
| 약어 | 의미 |
|---|---|
| SP | 급전구분소 |
| SS | 변전소 |
| SSP | 보조급전구분소 |

### 3.4 선로(tracks) 매핑 — `_TRACKS_MAP`

PDF 선로 열의 텍스트 → `tracks` JSON 배열로 변환:

| 표 내 표기 | tracks 값 | 비고 |
|---|---|---|
| 상선 | `["상선"]` | 복선 상선 |
| 하선 | `["하선"]` | 복선 하선 |
| 상하선, 상하 | `["상선","하선"]` | 양방향 |
| 상1 | `["상1"]` | 2복선/3복선 |
| 상2 | `["상2"]` | |
| 하1 | `["하1"]` | |
| 하2 | `["하2"]` | |
| 단선 | `["상선"]` | 사용자 확인 권장 |
| 구내 | `["상선"]` | 역구내 기본값 |

PdfImportModal에서 단건 선택 드롭다운으로 수동 수정 가능.

---

## 4. block_orders 테이블 완전 스키마

> 전체 DB 계층 구조 → [database/CLAUDE.md](../database/CLAUDE.md)

```sql
CREATE TABLE block_orders (
    -- 식별
    id               INTEGER PRIMARY KEY,
    organization_id  INTEGER NOT NULL REFERENCES organizations(id),
    route_id         INTEGER NOT NULL REFERENCES routes(id),
    created_by       INTEGER NOT NULL REFERENCES users(id),

    -- 노선·위치
    -- direction 컬럼은 Alembic tc05에서 삭제됨 → tracks TEXT(JSON)으로 대체
    tracks           TEXT     NOT NULL DEFAULT '["상선"]',
                                                 -- JSON 배열: ["상선"] | ["하선"] | ["상선","하선"] 등
    start_km         REAL,                        -- NULL 허용 (전차선 단전)
    end_km           REAL,                        -- NULL 허용
    section_note     TEXT(200),                  -- 단전구간명 (예: "청도SP~밀양SS")

    -- 일시
    work_date        DATE     NOT NULL,
    start_time       TIME     NOT NULL,
    end_time         TIME     NOT NULL,

    -- 분류
    field            TEXT(30) NOT NULL,           -- '시설' | '전기' | '건축'
    block_type       TEXT(30) NOT NULL,           -- 차단종류 (섹션명)
    has_equipment    BOOLEAN  DEFAULT 0,          -- 기계장비 투입 여부
    has_labor        BOOLEAN  DEFAULT 1,          -- 인력 투입 여부
    is_external      BOOLEAN  DEFAULT 0,          -- 외부 공사 여부

    -- 문서
    doc_no           TEXT(30),                   -- 문서번호 (작업관리센터TF-XXXXXX)
    document_path    TEXT(255),                  -- 첨부 PDF 상대경로

    -- 담당자 및 연락처
    dept_head        TEXT(50),                   -- 시행부서장
    dept_head_phone  TEXT(20),                   -- 시행부서장 연락처
    work_supervisor  TEXT(50) NOT NULL,           -- 작업책임자
    work_supervisor_phone TEXT(20),              -- 작업책임자 연락처
    safety_manager   TEXT(50) NOT NULL,           -- 철도운행안전관리자
    safety_manager_phone TEXT(20),               -- 철도운행안전관리자 연락처
    electric_safety_manager TEXT(50),            -- 전기철도안전관리자
    electric_safety_manager_phone TEXT(20),      -- 전기철도안전관리자 연락처
    contractor       TEXT(100),                  -- 시공사
    train_watcher    TEXT(50),                   -- 열차감시원
    train_watcher_phone TEXT(20),               -- 열차감시원 연락처

    -- 작업 내용
    reason           TEXT,                       -- 사유/시행사항 (세부내역에서 파싱)
    safety_items     TEXT,                       -- 안전관리항목 (줄바꿈 구분)
    note             TEXT                        -- 기타 비고
);
```

---

## 5. 파싱 흐름

### 5.1 PDF 일괄등록 (세부내역 + 시행문)

```
사용자: 시행문 PDF + 세부내역 PDF 업로드
       ↓
POST /api/v1/documents/bulk-parse
       ↓
pdf_parser_service.py
  ├── parse_cover_pdf(시행문)    → cover_meta (담당자·연락처·문서번호 등)
  ├── parse_detail_pdf(세부내역) → rows[] (차단 일정 행 목록)
  └── merge_parse_results()     → 각 row에 cover_meta 주입
       ↓
프론트엔드: 검토 테이블 표시 (needs_review 행 주황 강조)
       ↓
사용자: 오류 수정, 불필요 행 삭제
       ↓
POST /api/v1/block-orders/bulk
       ↓
DB 저장 (권한 검증 per row, 실패 행 skip)
```

### 5.2 시행문 단건 불러오기 (폼 자동채움)

```
차단명령 등록 모달 → [시행문 PDF 불러오기]
       ↓
POST /api/v1/documents/parse-pdf
       ↓
parse_block_order_pdf() → 첫 번째 row + cover_meta 합산
       ↓
BlockOrderForm 필드 자동채움 (신뢰도 < 0.6 경고 배너)
```

### 5.3 needs_review 판정 기준

| 조건 | 판정 |
|---|---|
| `direction` 추출 실패 | `needs_review = True` |
| `start_km = NULL` AND `section_note` 없음 | `needs_review = True` |
| `field_confidence = 'low'` | `needs_review = True` |
| `section_note` 있음 (전차선 단전) | km 없어도 OK |

---

## 6. 파싱 한계 및 대응

| 한계 | 대응 |
|---|---|
| 스캔본(이미지 PDF) | pdfplumber 추출 불가 → "스캔본 불가" 안내 후 수동 입력 유도 |
| 손상·선형화 PDF | pikepdf로 자동 복구 후 재시도 |
| 작업책임자 패턴 불일치 | `책임건설사업기술인`, `사업소장` 등 대체 패턴 추가 적용 |
| 전화번호 없는 경우 | `_phone` 컬럼 NULL 저장 |
| 양식 변경 시 | `pdf_parser_service.py`의 정규식 패턴 추가 필요 |

---

## 7. Alembic 마이그레이션 이력

| 파일 | 내용 |
|---|---|
| `6285ade4c20e` | `section_note` 추가, `start_km`/`end_km` nullable 시도 (SQLite 제약상 미적용) |
| `a2b3c4d5e6f7` | `doc_no`, `reason`, `dept_head`, `electric_safety_manager`, `contractor` 추가; `train_safety_coordinator` 삭제 |
| `b3c4d5e6f7a8` | `*_phone` 연락처 컬럼 5개 추가 |
| `c4d5e6f7a8b9` | `start_km`/`end_km` NOT NULL → nullable 실제 적용 (batch_alter_table 재생성) |
| `d5e6f7a8b9c0` | `start_facility_id` / `end_facility_id` 추가 (전차선 단전 변전소 FK) |

---

## 관련 문서 링크

| 문서 | 내용 |
|---|---|
| [database/CLAUDE.md](../database/CLAUDE.md) | 전체 DB 스키마 및 Alembic 운영 방법 |
| [backend/CLAUDE.md](../backend/CLAUDE.md) | API 엔드포인트 목록, pdf_parser_service 위치 |
| [frontend/UI_UX_pages.md](../frontend/UI_UX_pages.md) | 차단명령 등록 폼 및 PDF 일괄등록 UI 명세 |
| [frontend/CLAUDE.md](../frontend/CLAUDE.md) | PdfImportModal, BlockOrderForm 컴포넌트 구조 |
