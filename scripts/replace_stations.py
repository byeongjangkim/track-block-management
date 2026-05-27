"""
역 시설물 전체 교체 스크립트 v2
- maps/data/stations.csv → facilities 테이블 전체 교체
- 일산선 routes 테이블 신규 등록
- 경강선 CSV → gyeonggang(판교~여주) / gangneung(서원주~강릉) 분리
- station_type: 관리역|보통역|신호장|신호소 (직제규정 [별표2] 기준)
"""
import csv
import sqlite3
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "backend" / "db.sqlite3"
CSV_PATH = ROOT / "maps" / "data" / "stations.csv"

# ── 직제규정 [별표2] 3.가 관리역 목록 (사용자 확인 기준) ──────────────────
GWANRI_YEK = {
    # 서울본부 (5)
    "문산", "능곡", "수색", "서울", "용산",
    # 수도권서부본부 (11)
    "영등포", "구로", "부천", "광명", "안양", "오봉", "수원",
    "평택", "안산", "송도", "인천",
    # 수도권동부본부 (12)
    "청량리", "광운대", "의정부", "동두천", "수서", "경기광주",
    "왕십리", "죽전", "망우", "춘천", "양평", "원주",
    # 강원본부 (5)
    "강릉", "동해", "평창", "태백", "울진",
    # 충북본부 (5)
    "충주", "제천", "제천조차장", "도담", "민둥산",
    # 대전충남본부 (9)
    "천안", "오송", "조치원", "대전", "천안아산", "홍성", "대천",
    "서대전", "대전조차장",
    # 전북본부 (3)
    "익산", "정읍", "전주",
    # 광주본부 (3)
    "광주", "목포", "광주송정",
    # 전남본부 (3)
    "순천", "여수엑스포", "광양",
    # 경북본부 (4)
    "영주", "점촌", "안동", "춘양",
    # 대구본부 (8)
    "김천구미", "구미", "대구", "동대구", "경산", "영천", "경주", "포항",
    # 부산경남본부 (9)
    "밀양", "구포", "부산", "태화강", "부전", "마산", "진주", "부산신항", "부산진",
}

# ── CSV 노선명 → DB routes.name ──────────────────────────────────────────
ROUTE_NAME_MAP = {
    "경부고속선": "경부고속선 (KTX)",
}

# 경강선 CSV에서 강릉선(gangneung) 구간을 분리하는 기준
# CSV에서 서원주역 km = 142.5 (판교 기점)
# 강릉선 DB는 서원주 기점 km=0 → 보정: 강릉선 km = csv_km - 142.5
GYEONGGANG_CUTOFF_KM = 100.0   # 이보다 큰 km → 강릉선 구간
GANGNEUNG_OFFSET_KM  = 142.5   # 강릉선 km 보정값


def add_ilsan_route(cur):
    """일산선 routes 테이블 등록 (없으면)"""
    cur.execute("SELECT id FROM routes WHERE code='ilsan'")
    if cur.fetchone():
        print("일산선: 이미 등록됨 (skip)")
        return
    cur.execute("""INSERT INTO routes
        (code, name, start_km, end_km, up_direction, down_direction,
         start_station, end_station)
        VALUES ('ilsan','일산선',0.0,19.2,'지축 방향','대화 방향','지축역','대화역')
    """)
    print("일산선 route 추가 완료")


def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 1. 일산선 route 등록
    add_ilsan_route(cur)
    conn.commit()

    # 2. DB 노선명 → route_id
    cur.execute("SELECT id, name, code FROM routes")
    route_name_to_id = {name: rid for rid, name, code in cur.fetchall()}
    route_code_to_id = {}
    cur.execute("SELECT id, code FROM routes")
    route_code_to_id = {code: rid for rid, code in cur.fetchall()}

    # 3. CSV 읽기
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    print(f"CSV 총 {len(rows)}개 역")

    # 4. 기존 STATION 전체 삭제
    cur.execute("DELETE FROM facilities WHERE type='STATION'")
    print(f"기존 STATION {cur.rowcount}개 삭제")

    inserted = 0
    skipped = []

    for row in rows:
        line_csv  = row["Line"]
        station   = row["Station"]
        stype_csv = row["Type"]          # 역 | 신호장 | 신호소
        km_val    = float(row["Distance_km"])
        lat       = float(row["Latitude"])
        lon       = float(row["Longitude"])

        # ── 노선 결정 ──────────────────────────────────────────────────
        if line_csv == "경강선":
            if km_val > GYEONGGANG_CUTOFF_KM:
                # 강릉선 구간 (서원주~강릉)
                route_id = route_code_to_id.get("gangneung")
                km_val   = round(km_val - GANGNEUNG_OFFSET_KM, 1)
            else:
                # 경강선 구간 (판교~여주)
                route_id = route_code_to_id.get("gyeonggang")
        else:
            line_db  = ROUTE_NAME_MAP.get(line_csv, line_csv)
            route_id = route_name_to_id.get(line_db)

        if route_id is None:
            skipped.append(line_csv)
            continue

        # ── station_type 결정 ───────────────────────────────────────────
        if stype_csv == "신호장":
            station_type = "신호장"
            name = station + "신호장"
        elif stype_csv == "신호소":
            station_type = "신호소"
            name = station + "신호소"
        elif station in GWANRI_YEK:
            station_type = "관리역"
            name = station + "역"
        else:
            station_type = "보통역"
            name = station + "역"

        cur.execute(
            """INSERT INTO facilities
               (route_id, type, name, km, lat, lon, station_type,
                km_end, direction, has_station_map, note)
               VALUES (?, '역', ?, ?, ?, ?, ?, NULL, NULL, 0, NULL)""",
            (route_id, name, km_val, lat, lon, station_type),
        )
        inserted += 1

    conn.commit()
    conn.close()

    print(f"삽입 완료: {inserted}개")
    if skipped:
        from collections import Counter
        print(f"건너뜀: {dict(Counter(skipped))}")


if __name__ == "__main__":
    main()
