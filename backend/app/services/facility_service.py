"""
facility_service.py — 시설물 CSV 파싱 및 DB 저장

DB SOT 원칙: 시설물 데이터는 facilities 테이블에만 저장.
route_geometry 자동 생성(배포) 기능 없음 — 노선도 geometry는
SHP import 또는 관리자 CSV 업로드(geometry_service.py)로만 채운다.
"""

import csv

from sqlalchemy.orm import Session

from app.models.facility import Facility
from app.models.route import Route

VALID_TYPES      = {"STATION", "TUNNEL", "BRIDGE", "OVERPASS", "CROSSING", "SUBSTATION", "JUNCTION"}
VALID_DIRECTIONS = {"UP", "DOWN", "BOTH"}

# 헤더 정규화: 한글 헤더 → 내부 키
HEADER_MAP = {
    "종류":    "type",
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
CSV_TEMPLATE_HEADER = "종류,이름,시작km,종료km,시작위도,시작경도,방향,역배선도,비고"
CSV_TEMPLATE_COMMENTS = """\
# ───────────────────────────────────────────────────────────────────────
# 선로차단작업 관리 - 시설물 CSV 입력 템플릿
# ───────────────────────────────────────────────────────────────────────
# 컬럼 설명:
#   종류      : STATION(역) | TUNNEL(터널) | BRIDGE(교량) | CROSSING(건널목)
#               OVERPASS(과선교) | SUBSTATION(변전소) | JUNCTION(분기)
#   이름      : 시설물 공식 명칭 (필수)
#   시작km    : KORAIL 공식 거리정 - 소수점 1자리 (필수)
#   종료km    : 터널·교량·과선교의 종점 거리정 (해당 없으면 빈칸)
#   시작위도  : 시점 WGS84 위도 (입력 시 노선도 표시에 직접 사용)
#   시작경도  : 시점 WGS84 경도 (미입력 시 route_geometry km 보간으로 계산)
#   방향      : UP(상선) | DOWN(하선) | BOTH(상하선공용) | 빈칸(방향무관)
#   역배선도  : 1(있음) | 0 또는 빈칸(없음)
#   비고      : 메모
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
