"""
분기점(환승) 역 누락 레코드 보완 스크립트
같은 물리적 역이 여러 노선에 걸치는 경우, 각 노선 기준 km로 별도 등록한다.

근거:
- 경전선: 삼랑진(0.0) ~ 광주송정(277.7)
- 전라선: 익산(0.0) ~ 여수엑스포(180.4)
- 경북선: 김천(0.0) ~ 점촌(47.0) 방향, 영주(115.4) 종점
- 대구선: 동대구(0.0) ~ 영천(58.0)
- 강릉선: 만종(0.0) ~ 강릉(120.7) — 원주/만종 분기
- 경춘선: 망우(0.0 기준) ~ 춘천(80.7)
- 광주선: 광주송정(0.0) ~ 광주(14.1)
- 가야선: 삼랑진(0.0) ~ 진주(7.1)
- 진해선: 창원(0.0) ~ 진해(21.3)
- 영동선: 영주(0.0) ~ 동해(162.0), 강릉(192.6) 방향
- 태백선: 제천(0.0) ~ 백산(93.2)
- 함백선: 예미 분기
- 충북선: 조치원(0.0) ~ 봉양(115.0)
- 동해선: 부산(0.0 기준) ~ 동해(188.6)
- 분당선: 왕십리(0.0) ~ 수원(52.7)
- 수인선: 수원(0.0) ~ 인천(52.8)
- 화순선: 효천(0.0) ~ 화순(15.0)
- 군산선: 익산(0.0) ~ 군산(21.7)
- 부전마산선: 부전(0.0) ~ 마산(29.4)
- 부산신항선: 신선대(0.0) 기준
"""
import sqlite3

DB_PATH = "backend/db.sqlite3"

def get_route_id(cur, code):
    cur.execute("SELECT id FROM routes WHERE code=?", (code,))
    row = cur.fetchone()
    return row[0] if row else None

def get_facility(cur, route_id, name):
    cur.execute("SELECT id FROM facilities WHERE route_id=? AND name=?", (route_id, name))
    return cur.fetchone()

def insert(cur, route_id, ftype, name, km, lat, lon):
    if get_facility(cur, route_id, name):
        return False  # 이미 존재
    cur.execute(
        "INSERT INTO facilities (route_id, type, name, km, has_station_map, lat, lon) VALUES (?,?,?,?,0,?,?)",
        (route_id, ftype, name, km, lat, lon)
    )
    return True

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    count = 0

    # ── 경전선 (gyeongjeon, id=3) ─────────────────────────────────────────
    # 시점: 삼랑진(0.0), 종점: 광주송정(277.7)
    r = get_route_id(cur, 'gyeongjeon')
    rows = [
        ('STATION', '삼랑진역',    0.0,   35.3822,    128.7191),
        ('STATION', '광주송정역',  277.7, 35.1377072, 126.7901098),
        # 경전선 상 주요 분기점
        ('STATION', '순천역',      156.5, 34.9458107, 127.5040597),  # 전라선과 교차
        ('STATION', '보성역',      209.3, 34.7667691, 127.0821389),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 전라선 (jeolla, id=8) ─────────────────────────────────────────────
    # 시점: 익산(0.0), 종점: 여수엑스포(180.4)
    r = get_route_id(cur, 'jeolla')
    rows = [
        ('STATION', '익산역',  0.0, 35.9412564, 126.9459134),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 경북선 (gyeongbuk, id=24) ─────────────────────────────────────────
    # 시점: 김천(0.0), 종점: 영주(115.4)
    r = get_route_id(cur, 'gyeongbuk')
    rows = [
        ('STATION', '김천역',  0.0,   None, None),
        ('STATION', '영주역',  115.4, 36.8109445, 128.625578),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 대구선 (daegu_line, id=30) ────────────────────────────────────────
    # 시점: 동대구(0.0), 종점: 영천(58.0)
    r = get_route_id(cur, 'daegu_line')
    rows = [
        ('STATION', '동대구역', 0.0,  35.8791851, 128.6283056),
        ('STATION', '영천역',   57.0, 35.9590454, 128.9388909),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 강릉선 (gangneung, id=20) ─────────────────────────────────────────
    # 시점: 만종(0.0, 중앙선 만종역 분기), 종점: 강릉(120.7)
    r = get_route_id(cur, 'gangneung')
    rows = [
        ('STATION', '만종역', 0.0, None, None),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 경춘선 (gyeongchun, id=17) ────────────────────────────────────────
    # 시점: 망우(0.0), 종점: 춘천(80.7)
    r = get_route_id(cur, 'gyeongchun')
    rows = [
        ('STATION', '망우역',  0.0,  37.5996345, 127.0918581),
        ('STATION', '춘천역',  80.7, 37.8845604, 127.716664),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 광주선 (gwangju_line, id=25) ─────────────────────────────────────
    # 시점: 광주송정(0.0), 종점: 광주(14.1)
    r = get_route_id(cur, 'gwangju_line')
    rows = [
        ('STATION', '광주송정역', 0.0,  35.1377072, 126.7901098),
        ('STATION', '광주역',     14.1, 35.1653215, 126.9093193),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 가야선 (gaya, id=6) ───────────────────────────────────────────────
    # 시점: 삼랑진(0.0), 종점: 가야(7.1)
    r = get_route_id(cur, 'gaya')
    rows = [
        ('STATION', '삼랑진역', 0.0, 35.3822, 128.7191),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 진해선 (jinhae, id=5) ─────────────────────────────────────────────
    # 시점: 창원역(0.0), 종점: 진해(21.3)
    r = get_route_id(cur, 'jinhae')
    rows = [
        ('STATION', '창원역', 0.0, None, None),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 영동선 (yeongdong, id=11) ─────────────────────────────────────────
    # 시점: 영주(0.0), 종점: 강릉(192.6) 방향 동해(162.0)까지 주요 운행
    r = get_route_id(cur, 'yeongdong')
    rows = [
        ('STATION', '영주역', 0.0, 36.8109445, 128.625578),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 태백선 (taebaek, id=10) ───────────────────────────────────────────
    # 시점: 제천(0.0), 종점: 백산(93.2)
    r = get_route_id(cur, 'taebaek')
    rows = [
        ('STATION', '제천역', 0.0, 37.1270743, 128.2059637),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 충북선 (chungbuk, id=12) ──────────────────────────────────────────
    # 시점: 조치원(0.0), 종점: 봉양(115.0)
    r = get_route_id(cur, 'chungbuk')
    rows = [
        ('STATION', '조치원역', 0.0, 36.60102, 127.2958888),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 동해선 (donghae, id=4) ────────────────────────────────────────────
    # 시점: 부전(0.0 기준) → 실제 부전역 km 확인 필요, 종점: 동해(188.6)
    # 현재 부전역이 동해선에 140.0으로 등록돼 있음 → 이는 포항 기점 기준
    # 실제 동해선: 부전(0.0) ~ 동해(188.6) 단일 체계로 관리
    # 시점/종점역은 이미 등록됨(부전 140.0, 태화강 127.0)
    # 포항역(88.0) 기준 하단은 별도 확인 필요 — 현재 유지

    # ── 분당선 (bundang, id=51) ───────────────────────────────────────────
    # 시점: 왕십리(0.0), 종점: 수원(52.7) 방향
    # 왕십리는 이미 STATION으로 등록됨 (km=0.0)
    r = get_route_id(cur, 'bundang')
    rows = [
        ('STATION', '수원역', 52.7, 37.2658097, 126.9999102),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 수인선 (suin, id=50) ──────────────────────────────────────────────
    # 시점: 수원(0.0), 종점: 인천(52.8)
    r = get_route_id(cur, 'suin')
    rows = [
        ('STATION', '수원역', 0.0, 37.2658097, 126.9999102),
        ('STATION', '인천역', 52.8, 37.4766821, 126.6168874),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 화순선 (hwasun, id=48) ────────────────────────────────────────────
    # 시점: 효천(0.0, 경전선 분기), 종점: 화순(15.0)
    r = get_route_id(cur, 'hwasun')
    rows = [
        ('STATION', '효천역',  0.0,  None, None),
        ('STATION', '화순역',  15.0, None, None),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 군산선 (gunsan, id=28) ────────────────────────────────────────────
    # 시점: 익산(0.0), 종점: 군산(21.7)
    r = get_route_id(cur, 'gunsan')
    rows = [
        ('STATION', '익산역',  0.0,  35.9412564, 126.9459134),
        ('STATION', '군산역',  21.7, None, None),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    # ── 부전마산선 (bujeon_masan, id=36) ──────────────────────────────────
    # 시점: 부전(0.0), 종점: 마산(29.4)
    r = get_route_id(cur, 'bujeon_masan')
    rows = [
        ('STATION', '부전역', 0.0,  35.1626001, 129.0629411),
        ('STATION', '마산역', 29.4, 35.2363635, 128.576728),
    ]
    for ftype, name, km, lat, lon in rows:
        if insert(cur, r, ftype, name, km, lat, lon): count += 1

    conn.commit()
    conn.close()
    print(f"완료: {count}건 삽입")

if __name__ == "__main__":
    main()
