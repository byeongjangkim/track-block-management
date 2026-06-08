"""
차단명령 PDF 파싱 서비스.

두 가지 문서 유형을 지원한다:
  - 시행문 (공문): 노선명, 문서번호, 작업책임자, 안전관리자 등 메타 정보
  - 세부내역 (표): 날짜별 차단 일정 목록 (1 PDF에 수십 건)

두 파일을 합쳐 차단명령 후보 목록을 반환한다.

파싱 대상 필드 (tc11·tc12 포함):
  공통       : doc_no, route_name, dept_head/phone, work_supervisor/phone,
               safety_manager/phone, electric_safety_manager/phone,
               contractor/contractor_phone, train_watcher/phone,
               field, has_equipment/has_labor, project_name, approved_date,
               equipment_name
  세부내역 행 : work_date, start/end_time, start/end_km,
               start/end_station_name, tracks, block_type, reason,
               section_note(전차선단전 구간명)
  고속선 전용 : block_method(SS/SSS), zep, zcp, cpt, tzep
"""

from __future__ import annotations

import io
import re
from typing import Optional

import pikepdf
import pdfplumber


# ── 시행문 파싱 패턴 ──────────────────────────────────────────────────────────

_RE_ROUTE_TITLE = re.compile(r'(?:제목|제\s*목)[^\n]*?([가-힣]+선)')
_RE_ROUTE_BODY  = re.compile(r'([가-힣]+선)\s*(?:등|노선|선로)')

# 문서번호: "작업관리센터TF-XXXXXX" 전체 형식으로 저장
_RE_DOC_NO = re.compile(r'(작업관리센터TF[-–]?\d{5,7})')

_RE_PHONE = re.compile(r'(0\d{1,2}[-–]\d{3,4}[-–]\d{4})')

def _extract_name_phone(pattern: re.Pattern, text: str) -> tuple[Optional[str], Optional[str]]:
    """패턴으로 이름과 연락처를 함께 추출. (name, phone) 반환."""
    m = pattern.search(text)
    if not m:
        return None, None
    name = m.group(1).strip()
    nearby = text[m.start(): m.start() + 120]
    mp = _RE_PHONE.search(nearby)
    phone = mp.group(1) if mp else None
    return name, phone

_RE_SUPERVISOR    = re.compile(r'작업\s*책임\s*자[^\n]*?([가-힣]{2,4})\s*\(')
_RE_SUPERVISOR2   = re.compile(r'(?:책임건설사업기술인|사업소장|시설팀장|선임장)\s+([가-힣]{2,4})\s*\(')
_RE_SAFETY_MGR    = re.compile(r'철도운행\s*안전\s*관리\s*자[^\n]*?([가-힣]{2,4})\s*\(')
_RE_ELECTRIC_SAFETY = re.compile(r'전기\s*철도\s*안전\s*관리\s*자[^\n]*?([가-힣]{2,4})\s*\(')
_RE_DEPT_HEAD     = re.compile(r'시행\s*부서\s*장[^\n]*?([가-힣]{2,4})\s*\(')
_RE_DEPT_HEAD2    = re.compile(r'(?:본부장|단장|소장)\s+([가-힣]{2,4})\s*\(')
_RE_CONTRACTOR    = re.compile(r'시공\s*사\s*[:\s]+([^\n\(]{2,50}?)(?:\s*\(|\s*\n|$)')
_RE_TRAIN_WATCHER = re.compile(r'열차\s*감시\s*원[^\n]*?([가-힣]{2,4})\s*\(')
_RE_FIELD_COVER   = re.compile(r'분야\s*[:\s]*([시설전기건축]{2,3})')

# 관련사업명: "관련사업명 : 경부선 안양-의왕간 ..." 형식
_RE_PROJECT_NAME = re.compile(r'관련\s*사업\s*명?\s*[:\s]+([^\n\r]{5,200})')

# 승인일자: 공문 하단 "시 행  2026. 4. 15." 형식
_RE_APPROVED_DATE = re.compile(
    r'시\s*행\s+(20\d{2})[.\-년]\s*(0?\d|1[0-2])[.\-월]\s*([012]?\d|3[01])\s*[일.]?'
)
_RE_APPROVED_DATE2 = re.compile(
    r'(?:승인일|발행일|작성일)\s*[:\s]*(20\d{2})[.\-년]\s*(0?\d|1[0-2])[.\-월]\s*([012]?\d|3[01])\s*[일.]?'
)

# 동원장비 섹션
_RE_EQUIP_SECTION = re.compile(r'동원\s*장비')
_RE_HAS_MACHINE   = re.compile(r'(?:모터카|트롤리|평판화차|1종장비|굴착기|자갈화차|장대레일)')
_RE_HAS_LABOR     = re.compile(r'인력\s*(?:트롤리|밀차)')
# 장비명 추출: 동원장비 키워드 이후 200자 범위에서 구체적 장비 이름 추출
_RE_EQUIP_NAMES   = re.compile(
    r'(?:모터카|레일교환기|레일운반차|스파이크박기|도상다짐기|멀티플타이탬퍼|'
    r'자갈살포차|자갈굴착기|롤러|백호|불도저|굴삭기|그라우팅|트롤리|장대레일운반차)'
)

# ── 고속선 전용 패턴 ─────────────────────────────────────────────────────────

_RE_BLOCK_METHOD  = re.compile(r'차단\s*방법\s*[:\s]*(SSS?)\b', re.IGNORECASE)
_RE_BLOCK_METHOD2 = re.compile(r'\b(SSS?)\b')  # 표 셀 단독 값

_RE_ZEP  = re.compile(r'\bZEP\s*[:\s#]?\s*([A-Z]{1,3}\d*[-_]?[A-Z0-9]*)', re.IGNORECASE)
_RE_ZCP  = re.compile(r'\bZCP\s*[:\s#]?\s*([A-Z]{1,3}\d*[-_]?[A-Z0-9]*)', re.IGNORECASE)
_RE_CPT  = re.compile(r'\bCPT\s*[:\s#]?\s*([A-Z]{1,3}\d*[-_]?[A-Z0-9]*)', re.IGNORECASE)
_RE_TZEP = re.compile(r'\bTZEP\s*[:\s#]?\s*([A-Z]{1,3}\d*[-_]?[A-Z0-9]*)', re.IGNORECASE)

# ── 세부내역 표 파싱 패턴 ─────────────────────────────────────────────────────

_RE_SECTION = re.compile(r'◐([^◐◑]+)[◐◑]|[◐●○]\s*([가-힣\s]+(?:차단|사용중지|단전))\s*[◑◐●○]')

_RE_DATE = re.compile(r'(20\d{2})[-./](0?\d|1[0-2])[-./]([012]?\d|3[01])')
_RE_TIME = re.compile(r'(\d{1,2})[:\s시](\d{2})(?:\s*분)?')
_RE_KM   = re.compile(r'\b(\d{1,4}\.\d{1,3})\b')

# 역간구간 파싱용: "안양역~의왕역" / "금천구청~가산디지털단지"
# SP/SS 변전소명은 section_note로 별도 처리
_RE_STATION_RANGE = re.compile(
    r'^([가-힣A-Za-z0-9\s·]+?)(?:역)?\s*[~∼－\-]\s*([가-힣A-Za-z0-9\s·]+?)(?:역)?\s*$'
)
# 전차선 변전소 약칭: 한글 뒤에 붙는 SP/SS/SSP/ATP/PP (단어 경계 없이도 탐지)
_RE_SUBSTATION_NAME = re.compile(r'(?:SP|SSP|ATP|PP)\b|SS(?!S)')

# 선로 열 방향 매핑 — 일반선 + 고속선(T번호)
_TRACKS_MAP: dict[str, list[str]] = {
    # 일반선
    '상하선': ['상선', '하선'],
    '상하':   ['상선', '하선'],
    '상선':   ['상선'],
    '하선':   ['하선'],
    '상1하1': ['상1', '하1'],
    '상1':    ['상1'],
    '상2':    ['상2'],
    '상3':    ['상3'],
    '하1':    ['하1'],
    '하2':    ['하2'],
    '하3':    ['하3'],
    '단선':   ['상선'],
    '구내':   ['상선'],
    # 고속선 T번호 (단독 및 조합)
    'T1T2':  ['T1', 'T2'],
    'T3T4':  ['T3', 'T4'],
    'T5T6':  ['T5', 'T6'],
    'T7T8':  ['T7', 'T8'],
    'T1T2T3T4': ['T1', 'T2', 'T3', 'T4'],
    'T1':    ['T1'],
    'T2':    ['T2'],
    'T3':    ['T3'],
    'T4':    ['T4'],
    'T5':    ['T5'],
    'T6':    ['T6'],
    'T7':    ['T7'],
    'T8':    ['T8'],
}


# ── 분야 추론 ─────────────────────────────────────────────────────────────────

_FIELD_RULES: list[tuple[list[str], str, str]] = [
    (['전차선', '단전', '전기', '전철', 'SP', 'SS', 'SSP', '급전'], '전기', 'high'),
    (['레일', '침목', '분기기', '궤도', '재설정', '테르밋', '용접', '선로재료', '노후레일'], '시설', 'high'),
    (['유지보수', '점검', '교환', '선로', '장비', '인력', '기계', '상하차'], '시설', 'medium'),
]

def _infer_field(reason_text: str) -> tuple[str, str]:
    for keywords, field, conf in _FIELD_RULES:
        if any(kw in reason_text for kw in keywords):
            return field, conf
    return '시설', 'low'


# ── 역간구간 파싱 헬퍼 ───────────────────────────────────────────────────────

def _parse_station_range(range_text: str) -> tuple[Optional[str], Optional[str]]:
    """
    역간구간 텍스트에서 시작역/종료역을 파싱한다.

    "안양역~의왕역"       → ("안양", "의왕")
    "금천구청~가산디지털" → ("금천구청", "가산디지털")
    "청도SP~밀양SS"       → (None, None)  ← 변전소 구간은 section_note 처리
    """
    t = range_text.strip()
    if not t:
        return None, None
    # 변전소명(SP/SS/SSP/ATP/PP) 포함 시 section_note 대상 — 스킵
    if _RE_SUBSTATION_NAME.search(t):
        return None, None
    m = _RE_STATION_RANGE.match(t)
    if m:
        start = m.group(1).strip()
        end   = m.group(2).strip()
        if start and end and start != end:
            return start, end
    return None, None


# ── 텍스트 추출 ───────────────────────────────────────────────────────────────

def _words_to_text(words: list[dict]) -> str:
    if not words:
        return ''
    lines: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (round(w['top'] / 5), w['x0'])):
        if lines and abs(w['top'] - lines[-1][0]['top']) < 5:
            lines[-1].append(w)
        else:
            lines.append([w])
    return '\n'.join(' '.join(w['text'] for w in line) for line in lines)


def _tables_to_text(tables: list[list[list]]) -> str:
    parts = []
    for table in tables:
        for row in table:
            cleaned = [str(cell).strip() if cell is not None else '' for cell in row]
            parts.append('\t'.join(cleaned))
    return '\n'.join(parts)


def _open_with_pdfplumber(data: bytes) -> list[str]:
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
    pdf_obj = pikepdf.open(io.BytesIO(file_bytes))
    buf = io.BytesIO()
    pdf_obj.save(buf)
    buf.seek(0)
    return buf.read()


def _extract_pages(file_bytes: bytes) -> list[str]:
    try:
        pages = _open_with_pdfplumber(file_bytes)
        if any(p.strip() for p in pages):
            return pages
    except Exception:
        pages = []
    try:
        recovered = _recover_with_pikepdf(file_bytes)
        pages = _open_with_pdfplumber(recovered)
        return pages
    except Exception:
        pass
    return []


def _extract_pages_with_tables(file_bytes: bytes) -> list[dict]:
    try:
        pages = _open_with_pdfplumber_rich(file_bytes)
        if any(p['text'].strip() or p['tables'] for p in pages):
            return pages
    except Exception:
        pages = []
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
    'both'   — 두 유형 모두 포함
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


def _is_highspeed_doc(text: str) -> bool:
    """고속선(KTX) 차단명령 문서 여부 — T번호 또는 ZEP/ZCP/CPT/TZEP 포함 시."""
    return bool(
        re.search(r'\bT[1-8]\b', text) or
        re.search(r'\b(?:ZEP|ZCP|CPT|TZEP)\b', text, re.IGNORECASE)
    )


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
        'contractor_phone': None,
        'train_watcher': None,
        'train_watcher_phone': None,
        'field': None,
        'has_equipment': False,
        'has_labor': True,
        'project_name': None,
        'approved_date': None,
        'equipment_name': None,
        # 고속선 보호조치
        'block_method': None,
        'zep': None,
        'zcp': None,
        'cpt': None,
        'tzep': None,
    }

    # 노선명
    m = _RE_ROUTE_TITLE.search(text)
    if m:
        result['route_name'] = m.group(1).strip()
    else:
        m = _RE_ROUTE_BODY.search(text)
        if m:
            result['route_name'] = m.group(1).strip()

    # 문서번호 (전체 형식 "작업관리센터TF-XXXXXX" 저장)
    m = _RE_DOC_NO.search(text)
    if m:
        result['doc_no'] = m.group(1).replace('–', '-').replace(' ', '')

    # 관련사업명
    m = _RE_PROJECT_NAME.search(text)
    if m:
        result['project_name'] = m.group(1).strip().rstrip('.')

    # 승인일자 (시행 날짜)
    m = _RE_APPROVED_DATE.search(text)
    if not m:
        m = _RE_APPROVED_DATE2.search(text)
    if m:
        y  = m.group(1)
        mo = m.group(2).zfill(2)
        d  = m.group(3).zfill(2)
        result['approved_date'] = f'{y}-{mo}-{d}'

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

    # 시공사 + 연락처
    m = _RE_CONTRACTOR.search(text)
    if m:
        result['contractor'] = m.group(1).strip()
        # 시공사명 이후 150자 범위에서 연락처 추출
        search_start = m.start()
        nearby = text[search_start: search_start + 150]
        mp = _RE_PHONE.search(nearby)
        if mp:
            result['contractor_phone'] = mp.group(1)

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

    # 동원장비 섹션
    equip_m = _RE_EQUIP_SECTION.search(text)
    if equip_m:
        equip_text = text[equip_m.start(): equip_m.start() + 500]
        if _RE_HAS_MACHINE.search(equip_text):
            result['has_equipment'] = True
            # 장비명 추출 (쉼표/개행 구분 목록 → 첫 번째 대표명)
            names = _RE_EQUIP_NAMES.findall(equip_text)
            if names:
                result['equipment_name'] = ', '.join(dict.fromkeys(names))
        if _RE_HAS_LABOR.search(equip_text):
            result['has_labor'] = True

    # 고속선 보호조치 (시행문에 포함된 경우)
    m = _RE_BLOCK_METHOD.search(text)
    if m:
        result['block_method'] = m.group(1).upper()
    for key, pat in [('zep', _RE_ZEP), ('zcp', _RE_ZCP), ('cpt', _RE_CPT), ('tzep', _RE_TZEP)]:
        m = pat.search(text)
        if m:
            result[key] = m.group(1).upper()

    return result


# ── 세부내역 표 파싱 ──────────────────────────────────────────────────────────

def _parse_tracks(line_text: str) -> Optional[list[str]]:
    """선로 열 값에서 tracks 목록 반환. 매핑 실패 시 None."""
    # 공백 제거 후 매핑 시도 (긴 키 우선)
    normalized = re.sub(r'\s+', '', line_text)
    for key in sorted(_TRACKS_MAP, key=len, reverse=True):
        if key in normalized:
            return _TRACKS_MAP[key]
    return None


def _needs_review(row: dict) -> bool:
    if row.get('tracks') is None:
        return True
    if row.get('start_km') is None and not row.get('section_note'):
        return True
    if row.get('field_confidence') == 'low':
        return True
    return False


def _is_power_section(section: str) -> bool:
    """전차선 단전 섹션 여부 — km 대신 SP/SS 구간명 사용."""
    return '단전' in section


def _extract_highspeed_codes(cell_texts: list[str]) -> dict:
    """
    고속선 세부내역 표 셀에서 ZEP/ZCP/CPT/TZEP 코드를 추출한다.
    """
    joined = ' '.join(cell_texts)
    codes: dict = {}
    for key, pat in [('zep', _RE_ZEP), ('zcp', _RE_ZCP), ('cpt', _RE_CPT), ('tzep', _RE_TZEP)]:
        m = pat.search(joined)
        if m:
            codes[key] = m.group(1).upper()
    # 차단방법 (SS/SSS)
    m = _RE_BLOCK_METHOD.search(joined)
    if not m:
        m = _RE_BLOCK_METHOD2.search(joined)
    if m:
        codes['block_method'] = m.group(1).upper()
    return codes


def _parse_table_rows(
    raw_rows: list[list],
    current_section: str,
    route_name: Optional[str],
    cover_highspeed_codes: Optional[dict] = None,
) -> list[dict]:
    """
    extract_tables() 결과에서 차단명령 목록을 추출.

    표 컬럼 순서 (세부내역 표):
      [0]빈칸  [1]날짜  [2]구분  [3]시각  [4]역간구간  [5]지점km  [6]선로  [7]사유/시행사항

    시작행: 날짜+구분+시각+역간+km+선로+사유 모두 있음
    종료행: 날짜만 있고 시각+km+시행사항(비고)만 있음

    전차선 단전 섹션:
      역간구간 열에 SP/SS 변전소명 사용, km 열 비어있음
      → start_km=None, end_km=None, section_note="시작변전소~종료변전소"

    고속선 문서:
      선로 열에 T번호, 시행사항 열에 ZEP/ZCP/CPT/TZEP 코드 포함
    """
    rows: list[dict] = []
    current_row: Optional[dict] = None
    is_power = _is_power_section(current_section)

    for raw in raw_rows:
        cells = [str(c).strip() if c is not None else '' for c in raw]
        while len(cells) < 8:
            cells.append('')

        col_date   = cells[1]
        col_gubun  = cells[2]
        col_time   = cells[3]
        col_range  = cells[4]   # 역간구간
        col_km     = cells[5]
        col_line   = cells[6]   # 선로 / T번호
        col_reason = cells[7]

        m_date = _RE_DATE.search(col_date)

        if m_date and col_gubun:
            # ── 시작행 ──
            current_row = None
            y, mo, d = m_date.group(1), m_date.group(2).zfill(2), m_date.group(3).zfill(2)
            work_date = f'{y}-{mo}-{d}'

            m_time = _RE_TIME.search(col_time)
            start_time = f'{m_time.group(1).zfill(2)}:{m_time.group(2)}' if m_time else None

            km_vals = _RE_KM.findall(col_km)
            start_km = float(km_vals[0]) if km_vals else None

            tracks = _parse_tracks(col_line)
            reason = col_reason.strip()
            field, field_conf = _infer_field(reason + ' ' + col_range + ' ' + current_section)

            # 역간구간 파싱 (일반 선로차단) vs 변전소명 (전차선 단전)
            start_station = end_station = None
            section_note_val = None
            if is_power and not km_vals:
                section_note_val = col_range.strip() or None
            elif not is_power:
                start_station, end_station = _parse_station_range(col_range)

            # 고속선 코드 추출 (사유 셀 + 전체 행)
            hs_codes = _extract_highspeed_codes([col_line, col_reason, col_range])

            current_row = {
                'work_date': work_date,
                'is_day': '당일' in col_gubun,
                'start_time': start_time,
                'end_time': None,
                'start_km': start_km,
                'end_km': None,
                'section_note': section_note_val,
                'start_station_name': start_station,
                'end_station_name': end_station,
                'tracks': tracks,
                'block_type': current_section,
                'reason': reason,
                'field': field,
                'field_confidence': field_conf,
                'route_name': route_name,
                'work_supervisor': None,
                'safety_manager': None,
                # 고속선 코드 (커버에서 없으면 행에서 추출)
                'block_method': hs_codes.get('block_method') or (cover_highspeed_codes or {}).get('block_method'),
                'zep':  hs_codes.get('zep')  or (cover_highspeed_codes or {}).get('zep'),
                'zcp':  hs_codes.get('zcp')  or (cover_highspeed_codes or {}).get('zcp'),
                'cpt':  hs_codes.get('cpt')  or (cover_highspeed_codes or {}).get('cpt'),
                'tzep': hs_codes.get('tzep') or (cover_highspeed_codes or {}).get('tzep'),
            }

        elif current_row is not None:
            # ── 종료행 ──
            m_time = _RE_TIME.search(col_time)
            if m_time:
                current_row['end_time'] = f'{m_time.group(1).zfill(2)}:{m_time.group(2)}'

            km_vals = _RE_KM.findall(col_km)
            if km_vals:
                current_row['end_km'] = float(km_vals[0])

            # 전차선 단전: 종료 변전소명 → section_note "시작~종료" 형식
            if is_power and not km_vals and col_range.strip():
                start_loc = current_row.get('section_note') or ''
                end_loc = col_range.strip()
                current_row['section_note'] = f'{start_loc}~{end_loc}' if start_loc else end_loc
            elif not is_power and col_range.strip():
                # 종료역 파싱 (시작역은 시작행에서 이미 파싱)
                _, end_st = _parse_station_range(col_range)
                if end_st and not current_row.get('end_station_name'):
                    current_row['end_station_name'] = end_st

            # 비고/추가 시행사항
            extra = col_reason.strip() or col_range.strip()
            if extra and not is_power:
                current_row['reason'] = (current_row['reason'] + ' ' + extra).strip()
                field, conf = _infer_field(current_row['reason'])
                if conf != 'low' or current_row['field_confidence'] == 'low':
                    current_row['field'] = field
                    current_row['field_confidence'] = conf

            # 종료행에서도 고속선 코드 보완
            hs_extra = _extract_highspeed_codes([col_reason, col_range])
            for k in ('block_method', 'zep', 'zcp', 'cpt', 'tzep'):
                if hs_extra.get(k) and not current_row.get(k):
                    current_row[k] = hs_extra[k]

            current_row['needs_review'] = _needs_review(current_row)
            rows.append(current_row)
            current_row = None

    return rows


def parse_detail(pages_raw: list, route_name: Optional[str] = None,
                 cover_highspeed_codes: Optional[dict] = None) -> list[dict]:
    """
    세부내역에서 차단명령 행 목록을 파싱.

    pages_raw: _extract_pages_with_tables()의 반환값
    cover_highspeed_codes: 시행문에서 추출한 고속선 보호코드 딕셔너리 (없으면 None)
    """
    rows: list[dict] = []
    current_section = '선로일시사용중지'

    for page in pages_raw:
        text = page.get('text', '')
        tables = page.get('tables', [])

        for line in text.split('\n'):
            m_sec = _RE_SECTION.search(line)
            if m_sec:
                raw = (m_sec.group(1) or m_sec.group(2) or '').strip()
                current_section = re.sub(r'\s+', '', raw)

        if tables:
            for table in tables:
                data_rows = []
                for row in table:
                    cells = [str(c).strip() if c is not None else '' for c in row]
                    joined = ''.join(cells)
                    m_sec = _RE_SECTION.search(joined)
                    if m_sec:
                        raw = (m_sec.group(1) or m_sec.group(2) or '').strip()
                        current_section = re.sub(r'\s+', '', raw)
                        continue
                    data_rows.append(row)
                rows.extend(_parse_table_rows(data_rows, current_section, route_name,
                                              cover_highspeed_codes))
        else:
            # 텍스트 기반 폴백 파싱
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
                    tracks = _parse_tracks(rest)
                    start_station, end_station = _parse_station_range(rest)
                    is_power = _is_power_section(current_section)
                    hs_codes = _extract_highspeed_codes([rest])
                    current_row = {
                        'work_date': f'{y}-{mo}-{d}',
                        'is_day': '당일' in line,
                        'start_time': f'{m_time.group(1).zfill(2)}:{m_time.group(2)}' if m_time else None,
                        'end_time': None,
                        'start_km': float(km_vals[0]) if km_vals else None,
                        'end_km': None,
                        'section_note': rest.strip() if is_power and not km_vals else None,
                        'start_station_name': None if is_power else start_station,
                        'end_station_name': None if is_power else end_station,
                        'tracks': tracks,
                        'block_type': current_section,
                        'reason': rest.split()[-1] if rest.split() else '',
                        'field': field,
                        'field_confidence': conf,
                        'route_name': route_name,
                        'work_supervisor': None,
                        'safety_manager': None,
                        'block_method': hs_codes.get('block_method') or (cover_highspeed_codes or {}).get('block_method'),
                        'zep':  hs_codes.get('zep')  or (cover_highspeed_codes or {}).get('zep'),
                        'zcp':  hs_codes.get('zcp')  or (cover_highspeed_codes or {}).get('zcp'),
                        'cpt':  hs_codes.get('cpt')  or (cover_highspeed_codes or {}).get('cpt'),
                        'tzep': hs_codes.get('tzep') or (cover_highspeed_codes or {}).get('tzep'),
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
          rows: list[dict],
          error: str | None,
        }
    """
    try:
        pages_rich = _extract_pages_with_tables(file_bytes)
    except Exception as exc:
        return {'doc_type': 'unknown', 'rows': [], 'error': f'PDF 읽기 실패: {exc}'}
    if not any(p['text'].strip() or p['tables'] for p in pages_rich):
        return {'doc_type': 'unknown', 'rows': [], 'error': '텍스트를 추출할 수 없습니다 (스캔본 불가)'}

    text_pages = [p['text'] for p in pages_rich]
    doc_type = detect_doc_type(text_pages)

    cover_meta: dict = {}
    if doc_type in ('cover', 'both'):
        cover_meta = parse_cover(text_pages)
        if not route_name and cover_meta.get('route_name'):
            route_name = cover_meta['route_name']

    rows = []
    if doc_type in ('detail', 'both'):
        # 고속선 보호코드를 cover_meta에서 전달
        hs_codes = {k: cover_meta.get(k) for k in ('block_method', 'zep', 'zcp', 'cpt', 'tzep')}
        rows = parse_detail(pages_rich, route_name=route_name,
                            cover_highspeed_codes=hs_codes if any(hs_codes.values()) else None)

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
    - cover_result의 담당자·장비·고속선 코드 정보를 각 row에 주입
    """
    meta: dict = cover_result or {}
    rows: list[dict] = (detail_result or {}).get('rows', [])

    final_route = route_name or meta.get('route_name') or None

    supervisor   = meta.get('work_supervisor')
    safety_mgr   = meta.get('safety_manager')
    has_equipment = meta.get('has_equipment', False)
    has_labor     = meta.get('has_labor', True)

    for row in rows:
        row['route_name'] = final_route

        # 시행문 공통 필드 주입 (row에 없는 경우만)
        for field_key in (
            'doc_no',
            'dept_head', 'dept_head_phone',
            'electric_safety_manager', 'electric_safety_manager_phone',
            'contractor', 'contractor_phone',
            'train_watcher', 'train_watcher_phone',
            # tc11
            'project_name', 'approved_date', 'equipment_name',
            # 고속선 (시행문에만 있고 세부내역 행에 없는 경우 보완)
            'block_method', 'zep', 'zcp', 'cpt', 'tzep',
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

    fields = ['route_name', 'tracks', 'start_km', 'end_km',
              'work_date', 'start_time', 'end_time', 'field',
              'block_type', 'work_supervisor', 'safety_manager']

    out = {
        'route_name':    first.get('route_name') or meta.get('route_name'),
        'tracks':        first.get('tracks'),
        'start_km':      first.get('start_km'),
        'end_km':        first.get('end_km'),
        'work_date':     first.get('work_date'),
        'start_time':    first.get('start_time'),
        'end_time':      first.get('end_time'),
        'field':         first.get('field') or meta.get('field'),
        'block_type':    first.get('block_type'),
        'work_supervisor': first.get('work_supervisor') or meta.get('work_supervisor'),
        'safety_manager':  first.get('safety_manager') or meta.get('safety_manager'),
        'train_safety_coordinator': None,
        'train_watcher': None,
        'error': result.get('error'),
    }
    filled = sum(1 for k in fields if out.get(k) is not None)
    out['confidence'] = round(filled / len(fields), 2)
    return out
