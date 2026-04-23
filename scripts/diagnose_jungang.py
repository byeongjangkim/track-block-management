"""
중앙선 GPS 좌표 진단 스크립트
- 시설물 km순 목록 출력
- 연속 구간 거리·비율 계산
- 이상 구간 플래그
"""
import sqlite3
import math

DB_PATH = "backend/db.sqlite3"

def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lon2 - lon1)
    a = math.sin(Δφ/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin(Δλ/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def main():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("SELECT id FROM routes WHERE code='jungang'")
    route_id = cur.fetchone()[0]

    cur.execute("""
        SELECT name, km, lat, lon, type
        FROM facilities
        WHERE route_id=? AND lat IS NOT NULL AND lon IS NOT NULL
        ORDER BY km
    """, (route_id,))
    rows = cur.fetchall()
    conn.close()

    print(f"총 {len(rows)}개 앵커 (GPS 있음)\n")
    print(f"{'km':>8}  {'이름':<12}  {'lat':>10}  {'lon':>11}  {'거리→다음':>10}  {'km차':>6}  {'비율':>6}  {'상태'}")
    print("-" * 95)

    RATIO_WARN = 5.0   # 거리/km 비율이 이 이상이면 경고

    for i, (name, km, lat, lon, typ) in enumerate(rows):
        if i < len(rows) - 1:
            nname, nkm, nlat, nlon, _ = rows[i+1]
            dist = haversine(lat, lon, nlat, nlon)
            km_diff = nkm - km
            ratio = dist / km_diff if km_diff > 0 else 999
            flag = " ⚠⚠⚠" if ratio > RATIO_WARN else (" ⚠" if ratio > 2.5 else "")
            print(f"{km:>8.1f}  {name:<12}  {lat:>10.6f}  {lon:>11.6f}  {dist:>10.3f}km  {km_diff:>6.1f}  {ratio:>6.2f}  {flag}")
        else:
            print(f"{km:>8.1f}  {name:<12}  {lat:>10.6f}  {lon:>11.6f}  {'':>10}  {'':>6}  {'':>6}")

    print("\n⚠ = 비율>2.5 (거리가 km차의 2.5배 이상), ⚠⚠⚠ = 비율>5.0")

if __name__ == "__main__":
    main()
