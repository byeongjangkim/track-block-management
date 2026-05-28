"""
facility_service.py — 시설물 CSV 파싱 및 DB 저장

DB SOT 원칙: 시설물 데이터는 facilities 테이블에만 저장.
노선도 geometry는 rail_computed_geometry 테이블 (KP 보간) 단독 사용.
"""

import csv

from sqlalchemy.orm import Session

from app.models.facility import Facility
from app.models.route import Route

VALID_TYPES      = {"역", "변전소", "구조물", "소속경계"}
VALID_DIRECTIONS = {"UP", "DOWN", "BOTH"}

# 헤더 정규화: 한글 헤더 → 내부 키
HEADER_MAP = {
    "종류":    "type",
    "소분류":  "station_type",
    "이름":    "name",
    "시작km":  "km",
    "km_start": "km",
    "종료km":  "km_end",
    "시작위도": "lat",
    "시작경도": "lon",
    "위도":    "lat",   # 구버전 호환
    "경도":    "lon",   # 구버전 호환
    "방향":    "direction",
    "역배선도": "has_station_map",
    "비고":    "note",
}

# CSV 템플릿 헤더
CSV_TEMPLATE_HEADER = "종류,소분류,이름,시작km,종료km,시작위도,시작경도,방향,역배선도,비고"
CSV_TEMPLATE_COMMENTS = """\
# ───────────────────────────────────────────────────────────────────────
# 선로차단작업 관리 - 시설물 CSV 입력 템플릿
# ───────────────────────────────────────────────────────────────────────
# 컬럼 설명:
#   종류      : 역 | 변전소 | 구조물 | 소속경계  (대분류, 필수)
#   소분류    : 대분류에 따라 아래 값 입력 (선택)
#             역     → 관리역 | 보통역 | 무인역 | 신호장 | 신호소
#             변전소 → ss | sp | ssp | atp | pp | 전기실 | 통신실 | 신호기계실
#             구조물 → 터널 | 교량 | 과선교 | 건널목 | 분기
#   이름      : 시설물 공식 명칭 (필수)
#   시작km    : KORAIL 공식 거리정, 소수점 1자리 (필수)
#   종료km    : 터널·교량·과선교의 종점 거리정 (선형 구조물만 입력)
#   시작위도  : 시점 WGS84 위도 (선택, 노선도 표시에 직접 사용)
#   시작경도  : 시점 WGS84 경도 (선택)
#   방향      : UP(상선) | DOWN(하선) | BOTH(상하선공용) | 빈칸(방향무관)
#   역배선도  : 1(있음) | 0 또는 빈칸(없음)
#   비고      : 메모
# ───────────────────────────────────────────────────────────────────────
# 입력 예시 (아래 예시 행 이후부터 실제 데이터 입력):
# 역,관리역,서울역,0.0,,37.5547,126.9707,BOTH,1,
# 역,보통역,수색역,10.2,,37.5701,126.8965,,0,
# 역,신호장,개화신호장,12.5,,,,,0,
# 변전소,ss,서울SS,5.0,,37.5550,126.9710,,0,
# 변전소,전기실,수도권전기실,6.0,,37.5560,126.9720,,0,
# 변전소,통신실,서울통신실,7.0,,37.5570,126.9730,,0,
# 변전소,신호기계실,서울신호기계실,8.0,,37.5580,126.9740,,0,
# 구조물,터널,우면산터널,100.0,102.5,,,,0,
# 구조물,건널목,금정건널목,50.0,,37.0,127.0,BOTH,0,
# ───────────────────────────────────────────────────────────────────────
"""


def parse_csv_text(text: str) -> tuple[list[dict], list[str]]:
    """
    CSV 텍스트 → 행 목록 + 오류 목록.
    한글/영문 헤더 모두 허용. '#'으로 시작하는 줄은 무시.
    """
    lines = [l for l in text.splitlines() if not l.lstrip().startswith("#") and l.strip()]
    if not lines:
        return [], ["빈 파일"]

    reader = csv.DictReader(lines)
    rows, errors = [], []

    for lineno, raw in enumerate(reader, start=2):
        row: dict = {}
        for k, v in raw.items():
            if k is None:
                continue
            norm_key = HEADER_MAP.get(k.strip(), k.strip())
            row[norm_key] = v.strip() if v else ""

        if row.get("type") not in VALID_TYPES:
            errors.append(f"행 {lineno}: 알 수 없는 type '{row.get('type')}'")
            continue
        if not row.get("name"):
            errors.append(f"행 {lineno}: name 없음")
            continue
        if not row.get("km"):
            errors.append(f"행 {lineno}: km(시작거리정) 없음")
            continue

        try:
            row["km"]     = float(row["km"])
            row["km_end"] = float(row["km_end"]) if row.get("km_end") else None
            row["lat"]    = float(row["lat"])    if row.get("lat")    else None
            row["lon"]    = float(row["lon"])    if row.get("lon")    else None
        except ValueError as e:
            errors.append(f"행 {lineno}: 숫자 변환 오류 — {e}")
            continue

        direction = row.get("direction") or None
        if direction and direction not in VALID_DIRECTIONS:
            errors.append(f"행 {lineno}: direction '{direction}' 은 UP/DOWN/BOTH 중 하나")
            continue
        row["direction"] = direction

        row["has_station_map"] = row.get("has_station_map", "").lower() in ("1", "true", "yes")
        row["station_type"]    = row.get("station_type") or None
        row["note"]            = row.get("note") or None
        rows.append(row)

    return sorted(rows, key=lambda r: r["km"]), errors


def save_facilities_to_db(
    db: Session,
    route: Route,
    rows: list[dict],
    replace: bool = True,
) -> list[Facility]:
    if replace:
        db.query(Facility).filter(Facility.route_id == route.id).delete()

    facilities = []
    for row in rows:
        f = Facility(
            route_id        = route.id,
            type            = row["type"],
            station_type    = row.get("station_type"),
            name            = row["name"],
            km              = row["km"],
            km_end          = row.get("km_end"),
            lat             = row.get("lat"),
            lon             = row.get("lon"),
            direction       = row.get("direction"),
            has_station_map = row["has_station_map"],
            note            = row.get("note"),
        )
        db.add(f)
        facilities.append(f)

    db.commit()
    for f in facilities:
        db.refresh(f)
    return facilities
