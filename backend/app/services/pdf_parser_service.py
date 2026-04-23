"""
차단명령 PDF 파싱 서비스.

두 가지 문서 유형을 지원한다:
  - 시행문 (공문): 노선명, 문서번호, 작업책임자, 안전관리자 등 메타 정보
  - 세부내역 (표): 날짜별 차단 일정 목록 (1 PDF에 수십 건)

두 파일을 합쳐 차단명령 후보 목록을 반환한다.
"""

from __future__ import annotations

import io
import re
from typing import Optional

import pikepdf
import pdfplumber


# ── 시행문 파싱 패턴 ──────────────────────────────────────────────────────────

_RE_ROUTE_TITLE = re.compile(
    r'(?:제목|제\s*목)[^\n]*?([가-힣]+선)',
)
_RE_ROUTE_BODY = re.compile(r'([가-힣]+선)\s*(?:등|노선|선로)')
_RE_DOC_NO = re.compile(r'작업관리센터TF[-–]?(\d{5,7})')
# 작업책임자: 소속 다음 줄 이름(전화번호) 형식 또는 같은 줄에 이름(전화)
_RE_PHONE = re.compile(r'(0\d{1,2}[-–]\d{3,4}[-–]\d{4})')

def _extract_name_phone(pattern: re.Pattern, text: str) -> tuple[Optional[str], Optional[str]]:
    """패턴으로 이름과 연락처를 함께 추출. (name, phone) 반환."""
    m = pattern.search(text)
    if not m:
        return None, None
    name = m.group(1).strip()
    # 이름 이후 100자 내에서 전화번호 검색
    search_start = m.start()
    nearby = text[search_start: search_start + 100]
    mp = _RE_PHONE.search(nearby)
    phone = mp.group(1) if mp else None
    return name, phone

_RE_SUPERVISOR = re.compile(
    r'작업\s*책임\s*자[^\n]*?([가-힣]{2,4})\s*\('   # "작업책임자 ... 홍길동("
)
_RE_SUPERVISOR2 = re.compile(
    r'(?:책임건설사업기술인|사업소장|시설팀장|선임장)\s+([가-힣]{2,4})\s*\('
)
_RE_SAFETY_MGR = re.compile(r'철도운행\s*안전\s*관리\s*자[^\n]*?([가-힣]{2,4})\s*\(')
_RE_ELECTRIC_SAFETY = re.compile(r'전기\s*철도\s*안전\s*관리\s*자[^\n]*?([가-힣]{2,4})\s*\(')
_RE_DEPT_HEAD = re.compile(r'시행\s*부서\s*장[^\n]*?([가-힣]{2,4})\s*\(')
_RE_DEPT_HEAD2 = re.compile(r'(?:본부장|단장|소장)\s+([가-힣]{2,4})\s*\(')
_RE_CONTRACTOR = re.compile(r'시공\s*사\s*[:\s]+([^\n\(]{2,50}?)(?:\s*\(|\s*\n|$)')
_RE_TRAIN_WATCHER = re.compile(r'열차\s*감시\s*원[^\n]*?([가-힣]{2,4})\s*\(')
_RE_FIELD_COVER = re.compile(r'분야\s*[:\s]*([시설전기건축]{2,3})')

# 동원장비 패턴
_RE_EQUIP_SECTION = re.compile(r'동원\s*장비')
_RE_HAS_MACHINE = re.compile(r'(?:모터카|트롤리|평판화차|1종장비|굴착기|자갈화차|장대)')
_RE_HAS_LABOR = re.compile(r'인력\s*(?:트롤리|밀차)')

# ── 세부내역 표 파싱 패턴 ─────────────────────────────────────────────────────

# 섹션 헤더 (차단 종류 감지)
_RE_SECTION = re.compile(r'◐([^◐◑]+)◑|[◐●○]\s*([가-힣\s]+(?:차단|사용중지|단전))\s*[◑●○]')

# 날짜: 2026-04-20 또는 2026.04.20
_RE_DATE = re.compile(r'(20\d{2})[-./](0?\d|1[0-2])[-./]([012]?\d|3[01])')

# 시각: 00:50 또는 00시50분
_RE_TIME = re.compile(r'(\d{1,2})[:\s시](\d{2})(?:\s*분)?')

# km 지점: 5.200 또는 444.500
_RE_KM = re.compile(r'\b(\d{1,4}\.\d{1,3})\b')

# 선로 열 방향 매핑
_DIRECTION_MAP = {
    '상하': 'UP', '상하1': 'UP', '상하2': 'UP', '상하3': 'UP',
    '상선': 'UP', '상1': 'UP', '상2': 'UP', '상3': 'UP',
    '하선': 'DOWN', '하1': 'DOWN', '하2': 'DOWN', '하3': 'DOWN',
    '단선': 'UP',      # 단방향 미확정, 사용자 수정 필요
    '구내': 'UP',      # 역구내 작업 — 상선 기본값, 사용자 확인 권장
    '상하선': 'UP',    # 상하 양방향
}


# ── 분야 추론 ─────────────────────────────────────────────────────────────────

# (키워드 목록, 추론 분야, 신뢰도)
_FIELD_RULES: list[tuple[list[str], str, str]] = [
    # 전기 — 전차선·단전·변전소 관련
    (['전차선', '단전', '전기', '전철', 'SP', 'SS', 'SSP', '급전'], '전기', 'high'),
    # 시설 — 궤도재료·레일·침목 직접 명시
    (['레일', '침목', '분기기', '궤도', '재설정', '테르밋', '용접', '선로재료', '노후레일'], '시설', 'high'),
    # 시설 — 작업 내용 키워드 (점검·교환·유지보수 등)
    (['유지보수', '점검', '교환', '선로', '장비', '인력', '기계', '상하차'], '시설', 'medium'),
]

def _infer_field(reason_text: str) -> tuple[str, str]:
    """사유/시행사항 텍스트에서 분야를 추론. (field, confidence) 반환."""
    for keywords, field, conf in _FIELD_RULES:
        if any(kw in reason_text for kw in keywords):
            return field, conf
    return '시설', 'low'


# ── 텍스트 추출 ───────────────────────────────────────────────────────────────

def _words_to_text(words: list[dict]) -> str:
    """
    extract_words() 결과를 줄 단위 텍스트로 재조립.
    y 좌표가 비슷한 단어를 같은 줄로 묶는다.
    """
    if not words:
        return ''
    # y 좌표 기준 그룹화 (같은 줄 = y 차이 3pt 이내)
    lines: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (round(w['top'] / 5), w['x0'])):
        if lines and abs(w['top'] - lines[-1][0]['top']) < 5:
            lines[-1].append(w)
        else:
            lines.append([w])
    return '\n'.join(' '.join(w['text'] for w in line) for line in lines)


def _tables_to_text(tables: list[list[list]]) -> str:
    """extract_tables() 결과를 탭 구분 텍스트로 변환."""
    parts = []
    for table in tables:
        for row in table:
            cleaned = [str(cell).strip() if cell is not None else '' for cell in row]
            parts.append('\t'.join(cleaned))
    return '\n'.join(parts)


def _open_with_pdfplumber(data: bytes) -> list[str]:
    """pdfplumber로 페이지별 텍스트 추출 (3단계 폴백)."""
    pages = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ''

            if not text.strip():
                try:
                    words = page.extract_words(x_tolerance=3, y_tolerance=3)
                    text = _words_to_text(words)
                except Exception:
                    pass

            if not text.strip():
                try:
                    tables = page.extract_tables()
                    text = _tables_to_text(tables)
                except Exception:
                    pass

            pages.append(text)
    return pages


def _open_with_pdfplumber_rich(data: bytes) -> list[dict]:
    """pdfplumber로 페이지별 텍스트와 표를 함께 추출."""
    pages = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ''
            tables: list = []

            try:
                tables = page.extract_tables() or []
            except Exception:
                tables = []

            if not text.strip():
                try:
                    words = page.extract_words(x_tolerance=3, y_tolerance=3)
                    text = _words_to_text(words)
                except Exception:
                    pass

            if not text.strip() and not tables:
                try:
                    text = _tables_to_text(tables)
                except Exception:
                    pass

            pages.append({'text': text, 'tables': tables})
    return pages


def _recover_with_pikepdf(file_bytes: bytes) -> bytes:
    """pikepdf로 손상/잘린 PDF를 복구하여 정상 바이트로 반환."""
    pdf_obj = pikepdf.open(io.BytesIO(file_bytes))
    buf = io.BytesIO()
    pdf_obj.save(buf)
    buf.seek(0)
    return buf.read()


def _extract_pages(file_bytes: bytes) -> list[str]:
    """
    PDF에서 페이지별 텍스트를 추출한다.

    처리 순서:
      1. pdfplumber 직접 추출 (정상 PDF)
      2. 페이지 0개인 경우 → pikepdf로 손상 복구 후 재추출
         (Linearized PDF가 잘린 경우 등)
    """
    # 1단계: pdfplumber 직접 시도
    try:
        pages = _open_with_pdfplumber(file_bytes)
        if any(p.strip() for p in pages):
            return pages
    except Exception:
        pages = []

    # 2단계: pikepdf로 복구 후 재시도 (파일 손상/잘림 대응)
    try:
        recovered = _recover_with_pikepdf(file_bytes)
        pages = _open_with_pdfplumber(recovered)
        return pages
    except Exception:
        pass

    return []


def _extract_pages_with_tables(file_bytes: bytes) -> list[dict]:
    """
    PDF에서 페이지별 텍스트와 표를 함께 추출한다.

    반환: list[{'text': str, 'tables': list[list[list]]}]

    처리 순서:
      1. pdfplumber 직접 추출
      2. 페이지 0개인 경우 → pikepdf로 손상 복구 후 재추출
    """
    # 1단계: pdfplumber 직접 시도
    try:
        pages = _open_with_pdfplumber_rich(file_bytes)
        if any(p['text'].strip() or p['tables'] for p in pages):
            return pages
    except Exception:
        pages = []

    # 2단계: pikepdf로 복구 후 재시도 (파일 손상/잘림 대응)
    try:
        recovered = _recover_with_pikepdf(file_bytes)
        pages = _open_with_pdfplumber_rich(recovered)
        return pages
    except Exception:
        pass

    return []


def _full_text(pages: list[str]) -> str:
    return '\n'.join(pages)


# ── 문서 유형 감지 ────────────────────────────────────────────────────────────

def detect_doc_type(pages: list[str]) -> str:
    """
    'cover'  — 시행문 (공문)
    'detail' — 세부내역 (차단 일정 표)
    'both'   — 두 유형 모두 포함 (복합 PDF)
    """
    text = _full_text(pages)
    has_cover = bool(
        re.search(r'한국철도공사', text) and
        re.search(r'작업\s*책임\s*자', text)
    )
    has_detail = bool(
        re.search(r'◐[^◐◑]+◑', text) or
        re.search(r'선로일시사용중지|각\s*열차\s*사이\s*차단|전차선\s*단전', text)
    )
    if has_cover and has_detail:
        return 'both'
    if has_detail:
        return 'detail'
    return 'cover'


# ── 시행문 파싱 ───────────────────────────────────────────────────────────────

def parse_cover(pages: list[str]) -> dict:
    """시행문에서 메타 정보를 추출."""
    text = _full_text(pages)
    result: dict = {
        'route_name': None,
        'doc_no': None,
        'dept_head': None,
        'dept_head_phone': None,
        'work_supervisor': None,
        'work_supervisor_phone': None,
        'safety_manager': None,
        'safety_manager_phone': None,
        'electric_safety_manager': None,
        'electric_safety_manager_phone': None,
        'contractor': None,
        'train_watcher': None,
        'train_watcher_phone': None,
        'field': None,
        'has_equipment': False,
        'has_labor': True,
    }

    # 노선명: 제목에서 우선 추출, 없으면 본문에서
    m = _RE_ROUTE_TITLE.search(text)
    if m:
        result['route_name'] = m.group(1).strip()
    else:
        m = _RE_ROUTE_BODY.search(text)
        if m:
            result['route_name'] = m.group(1).strip()

    # 문서번호 (작업관리센터TF-XXXXXX 형식)
    m = _RE_DOC_NO.search(text)
    if m:
        result['doc_no'] = m.group(1)

    # 시행부서장 + 연락처
    name, phone = _extract_name_phone(_RE_DEPT_HEAD, text)
    if not name:
        name, phone = _extract_name_phone(_RE_DEPT_HEAD2, text)
    result['dept_head'] = name
    result['dept_head_phone'] = phone

    # 작업책임자 + 연락처
    name, phone = _extract_name_phone(_RE_SUPERVISOR, text)
    if not name:
        name, phone = _extract_name_phone(_RE_SUPERVISOR2, text)
    result['work_supervisor'] = name
    result['work_supervisor_phone'] = phone

    # 철도운행안전관리자 + 연락처
    name, phone = _extract_name_phone(_RE_SAFETY_MGR, text)
    result['safety_manager'] = name
    result['safety_manager_phone'] = phone

    # 전기철도안전관리자 + 연락처
    name, phone = _extract_name_phone(_RE_ELECTRIC_SAFETY, text)
    result['electric_safety_manager'] = name
    result['electric_safety_manager_phone'] = phone

    # 시공사
    m = _RE_CONTRACTOR.search(text)
    if m:
        result['contractor'] = m.group(1).strip()

    # 열차감시원 + 연락처
    name, phone = _extract_name_phone(_RE_TRAIN_WATCHER, text)
    result['train_watcher'] = name
    result['train_watcher_phone'] = phone

    # 분야 (시행문에 명시된 경우)
    m = _RE_FIELD_COVER.search(text)
    if m:
        for cand in ('시설', '전기', '건축'):
            if cand in m.group(1):
                result['field'] = cand
                break

    # 동원장비에서 장비/인력 여부 파싱
    equip_m = _RE_EQUIP_SECTION.search(text)
    if equip_m:
        equip_text = text[equip_m.start(): equip_m.start() + 500]
        if _RE_HAS_MACHINE.search(equip_text):
            result['has_equipment'] = True
        if _RE_HAS_LABOR.search(equip_text):
            result['has_labor'] = True

    return result


# ── 세부내역 표 파싱 ──────────────────────────────────────────────────────────

def _parse_direction(line_text: str) -> Optional[str]:
    """선로 열 값에서 방향을 반환. 매핑 실패 시 None."""
    for key, val in _DIRECTION_MAP.items():
        if key in line_text:
            return val
    return None


def _needs_review(row: dict) -> bool:
    """사용자 확인이 필요한 행 여부."""
    if row.get('direction') is None:
        return True
    # km 없는 경우: section_note가 있으면 전차선 단전으로 OK, 없으면 검토 필요
    if row.get('start_km') is None and not row.get('section_note'):
        return True
    if row.get('field_confidence') == 'low':
        return True
    return False


def _is_power_section(section: str) -> bool:
    """전차선 단전 섹션 여부 — km 대신 SP/SS 구간명을 사용한다."""
    return '단전' in section


def _parse_table_rows(raw_rows: list[list], current_section: str, route_name: Optional[str]) -> list[dict]:
    """
    extract_tables() 결과(2행 1쌍)에서 차단명령 목록을 추출.

    표 컬럼 순서 (세부내역 표):
      [0]빈칸  [1]날짜  [2]구분  [3]시각  [4]역간구간  [5]지점km  [6]선로  [7]사유/시행사항
    시작행: 날짜+구분+시각+역간+km+선로+사유 모두 있음
    종료행: 날짜만 있고 시각+km+시행사항(비고)만 있음

    전차선 단전 섹션:
      역간구간 열에 SP/SS 변전소명 사용, km 열은 비어있음
      → start_km=None, end_km=None, section_note="시작역~종료역"
    """
    rows: list[dict] = []
    current_row: Optional[dict] = None
    is_power = _is_power_section(current_section)

    for raw in raw_rows:
        # None → '' 변환
        cells = [str(c).strip() if c is not None else '' for c in raw]
        # 최소 8열 맞추기
        while len(cells) < 8:
            cells.append('')

        col_date   = cells[1]
        col_gubun  = cells[2]   # 당일/기간
        col_time   = cells[3]
        col_range  = cells[4]   # 역간구간 (전차선 단전: SP/SS명)
        col_km     = cells[5]   # 지점 km (전차선 단전: 빈칸)
        col_line   = cells[6]   # 선로 (방향)
        col_reason = cells[7]   # 사유/시행사항

        m_date = _RE_DATE.search(col_date)

        if m_date and col_gubun:
            # ── 시작행 ──
            current_row = None  # 이전 미완성 행 버리기
            y, mo, d = m_date.group(1), m_date.group(2).zfill(2), m_date.group(3).zfill(2)
            work_date = f'{y}-{mo}-{d}'

            m_time = _RE_TIME.search(col_time)
            start_time = None
            if m_time:
                start_time = f'{m_time.group(1).zfill(2)}:{m_time.group(2)}'

            km_vals = _RE_KM.findall(col_km)
            start_km = float(km_vals[0]) if km_vals else None

            direction = _parse_direction(col_line)
            reason = col_reason.strip()
            field, field_conf = _infer_field(reason + ' ' + col_range + ' ' + current_section)

            current_row = {
                'work_date': work_date,
                'is_day': '당일' in col_gubun,
                'start_time': start_time,
                'end_time': None,
                'start_km': start_km,
                'end_km': None,
                'section_note': col_range.strip() if is_power and not km_vals else None,
                'direction': direction,
                'block_type': current_section,
                'reason': reason,
                'field': field,
                'field_confidence': field_conf,
                'route_name': route_name,
                'work_supervisor': None,
                'safety_manager': None,
            }

        elif current_row is not None:
            # ── 종료행 ──
            m_time = _RE_TIME.search(col_time)
            if m_time:
                current_row['end_time'] = f'{m_time.group(1).zfill(2)}:{m_time.group(2)}'

            km_vals = _RE_KM.findall(col_km)
            if km_vals:
                current_row['end_km'] = float(km_vals[0])

            # 전차선 단전: 종료역 SP/SS명 → section_note에 "시작~종료" 형식으로 저장
            if is_power and not km_vals and col_range.strip():
                start_loc = current_row.get('section_note') or ''
                end_loc = col_range.strip()
                current_row['section_note'] = f"{start_loc}~{end_loc}" if start_loc else end_loc

            # 비고(시행사항 추가)
            extra = col_reason.strip() or col_range.strip()
            if extra and not is_power:
                current_row['reason'] = (current_row['reason'] + ' ' + extra).strip()
                field, conf = _infer_field(current_row['reason'])
                if conf != 'low' or current_row['field_confidence'] == 'low':
                    current_row['field'] = field
                    current_row['field_confidence'] = conf

            current_row['needs_review'] = _needs_review(current_row)
            rows.append(current_row)
            current_row = None

    return rows


def parse_detail(pages_raw: list, route_name: Optional[str] = None) -> list[dict]:
    """
    세부내역에서 차단명령 행 목록을 파싱.

    pages_raw: _extract_pages_with_tables()의 반환값
      각 원소 = {'text': str, 'tables': list[list[list]]}
    """
    rows: list[dict] = []
    current_section = '선로일시사용중지'  # 기본값

    for page in pages_raw:
        text = page.get('text', '')
        tables = page.get('tables', [])

        # 섹션 헤더를 텍스트에서 먼저 파악
        for line in text.split('\n'):
            m_sec = _RE_SECTION.search(line)
            if m_sec:
                raw = (m_sec.group(1) or m_sec.group(2) or '').strip()
                current_section = re.sub(r'\s+', '', raw)

        if tables:
            # 표가 있으면 표 기반 파싱 (정확도 높음)
            for table in tables:
                # 헤더/섹션 행 제거 후 파싱
                data_rows = []
                for row in table:
                    cells = [str(c).strip() if c is not None else '' for c in row]
                    joined = ''.join(cells)
                    # 섹션 헤더 행 감지
                    m_sec = _RE_SECTION.search(joined)
                    if m_sec:
                        raw = (m_sec.group(1) or m_sec.group(2) or '').strip()
                        current_section = re.sub(r'\s+', '', raw)
                        continue
                    data_rows.append(row)
                rows.extend(_parse_table_rows(data_rows, current_section, route_name))
        else:
            # 표가 없으면 텍스트 기반 파싱 (시행문 텍스트 등)
            current_row: Optional[dict] = None
            for line in text.split('\n'):
                line = line.strip()
                if not line:
                    continue
                m_sec = _RE_SECTION.search(line)
                if m_sec:
                    raw = (m_sec.group(1) or m_sec.group(2) or '').strip()
                    current_section = re.sub(r'\s+', '', raw)
                    continue
                m_date = _RE_DATE.search(line)
                if m_date:
                    current_row = None
                    y, mo, d = m_date.group(1), m_date.group(2).zfill(2), m_date.group(3).zfill(2)
                    rest = line[m_date.end():]
                    m_time = _RE_TIME.search(rest)
                    km_vals = _RE_KM.findall(rest)
                    field, conf = _infer_field(rest)
                    current_row = {
                        'work_date': f'{y}-{mo}-{d}',
                        'is_day': '당일' in line,
                        'start_time': f'{m_time.group(1).zfill(2)}:{m_time.group(2)}' if m_time else None,
                        'end_time': None,
                        'start_km': float(km_vals[0]) if km_vals else None,
                        'end_km': None,
                        'direction': _parse_direction(rest),
                        'block_type': current_section,
                        'reason': rest.split()[-1] if rest.split() else '',
                        'field': field,
                        'field_confidence': conf,
                        'route_name': route_name,
                        'work_supervisor': None,
                        'safety_manager': None,
                    }
                elif current_row is not None:
                    m_time = _RE_TIME.search(line)
                    if m_time:
                        current_row['end_time'] = f'{m_time.group(1).zfill(2)}:{m_time.group(2)}'
                    km_vals = _RE_KM.findall(line)
                    if km_vals:
                        current_row['end_km'] = float(km_vals[0])
                    current_row['needs_review'] = _needs_review(current_row)
                    rows.append(current_row)
                    current_row = None

    return rows


# ── 공개 API ─────────────────────────────────────────────────────────────────

def parse_cover_pdf(file_bytes: bytes) -> dict:
    """시행문 PDF → 메타 정보 딕셔너리."""
    try:
        pages = _extract_pages(file_bytes)
    except Exception as exc:
        return {'error': f'PDF 읽기 실패: {exc}'}
    if not any(p.strip() for p in pages):
        return {'error': '텍스트를 추출할 수 없습니다 (스캔본 불가)'}
    return parse_cover(pages)


def parse_detail_pdf(file_bytes: bytes, route_name: Optional[str] = None) -> dict:
    """
    세부내역 PDF → 차단명령 후보 목록.

    반환:
        {
          doc_type: 'cover' | 'detail' | 'both',
          rows: list[dict],   # 차단명령 후보
          error: str | None,
        }
    """
    try:
        pages_rich = _extract_pages_with_tables(file_bytes)
    except Exception as exc:
        return {'doc_type': 'unknown', 'rows': [], 'error': f'PDF 읽기 실패: {exc}'}
    if not any(p['text'].strip() or p['tables'] for p in pages_rich):
        return {'doc_type': 'unknown', 'rows': [], 'error': '텍스트를 추출할 수 없습니다 (스캔본 불가)'}

    # 문서 유형 감지는 텍스트 기반으로
    text_pages = [p['text'] for p in pages_rich]
    doc_type = detect_doc_type(text_pages)

    # 시행문이 포함된 경우 메타 정보도 추출
    cover_meta: dict = {}
    if doc_type in ('cover', 'both'):
        cover_meta = parse_cover(text_pages)
        if not route_name and cover_meta.get('route_name'):
            route_name = cover_meta['route_name']

    rows = []
    if doc_type in ('detail', 'both'):
        rows = parse_detail(pages_rich, route_name=route_name)

    return {
        'doc_type': doc_type,
        'cover_meta': cover_meta,
        'rows': rows,
        'error': None,
    }


def merge_parse_results(
    cover_result: Optional[dict],
    detail_result: Optional[dict],
    route_name: Optional[str] = None,
) -> dict:
    """
    시행문 결과 + 세부내역 결과를 병합.

    - route_name: 사용자가 Step1에서 선택/확인한 노선명 (최우선)
    - cover_result의 work_supervisor, safety_manager를 각 row에 채움
    """
    meta: dict = cover_result or {}
    rows: list[dict] = (detail_result or {}).get('rows', [])

    # 최종 노선명 결정: 사용자 선택 > 시행문 > 세부내역
    final_route = route_name or meta.get('route_name') or None

    # 시행문에서 추출한 담당자·장비 정보를 rows에 주입
    supervisor = meta.get('work_supervisor')
    safety_mgr = meta.get('safety_manager')
    has_equipment = meta.get('has_equipment', False)
    has_labor = meta.get('has_labor', True)

    for row in rows:
        row['route_name'] = final_route
        # 시행문 공통 필드 주입 (row에 없는 경우만)
        for field_key in (
            'doc_no',
            'dept_head', 'dept_head_phone',
            'electric_safety_manager', 'electric_safety_manager_phone',
            'contractor',
            'train_watcher', 'train_watcher_phone',
        ):
            if meta.get(field_key) and not row.get(field_key):
                row[field_key] = meta[field_key]
        if supervisor and not row.get('work_supervisor'):
            row['work_supervisor'] = supervisor
        if meta.get('work_supervisor_phone') and not row.get('work_supervisor_phone'):
            row['work_supervisor_phone'] = meta['work_supervisor_phone']
        if safety_mgr and not row.get('safety_manager'):
            row['safety_manager'] = safety_mgr
        if meta.get('safety_manager_phone') and not row.get('safety_manager_phone'):
            row['safety_manager_phone'] = meta['safety_manager_phone']
        if 'has_equipment' not in row:
            row['has_equipment'] = has_equipment
        if 'has_labor' not in row:
            row['has_labor'] = has_labor
        # needs_review 재계산
        row['needs_review'] = _needs_review(row)

    errors = []
    if cover_result and cover_result.get('error'):
        errors.append(f'시행문: {cover_result["error"]}')
    if detail_result and detail_result.get('error'):
        errors.append(f'세부내역: {detail_result["error"]}')

    return {
        'route_name': final_route,
        'cover_meta': meta,
        'rows': rows,
        'total': len(rows),
        'needs_review_count': sum(1 for r in rows if r.get('needs_review')),
        'error': '; '.join(errors) if errors else None,
    }


# 기존 단일 파일 파싱 (하위 호환 유지)
def parse_block_order_pdf(file_bytes: bytes) -> dict:
    """기존 단건 파싱 (BlockOrderForm PDF 불러오기 용)."""
    result = parse_detail_pdf(file_bytes)
    meta = result.get('cover_meta', {})
    rows = result.get('rows', [])
    first = rows[0] if rows else {}

    fields = ['route_name', 'direction', 'start_km', 'end_km',
              'work_date', 'start_time', 'end_time', 'field',
              'block_type', 'work_supervisor', 'safety_manager']

    out = {
        'route_name': first.get('route_name') or meta.get('route_name'),
        'direction': first.get('direction'),
        'start_km': first.get('start_km'),
        'end_km': first.get('end_km'),
        'work_date': first.get('work_date'),
        'start_time': first.get('start_time'),
        'end_time': first.get('end_time'),
        'field': first.get('field') or meta.get('field'),
        'block_type': first.get('block_type'),
        'work_supervisor': first.get('work_supervisor') or meta.get('work_supervisor'),
        'safety_manager': first.get('safety_manager') or meta.get('safety_manager'),
        'train_safety_coordinator': None,
        'train_watcher': None,
        'error': result.get('error'),
    }
    filled = sum(1 for k in fields if out.get(k) is not None)
    out['confidence'] = round(filled / len(fields), 2)
    return out
