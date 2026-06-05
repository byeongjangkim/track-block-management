"""
조직 및 뷰포트 시드 데이터
14개 조직 (지역본부 12 + 사업단 2) + 지역본부별 HQ 역 뷰포트

실행: cd backend && python scripts/seed/01_organizations.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from sqlalchemy import text
from app.core.database import SessionLocal

ORGANIZATIONS = [
    # (code, name, org_type, sort_order)
    ('seoul',       '서울본부',       'regional', 1),
    ('metro_west',  '수도권서부본부', 'regional', 2),
    ('metro_east',  '수도권동부본부', 'regional', 3),
    ('gangwon',     '강원본부',       'regional', 4),
    ('chungbuk',    '충북본부',       'regional', 5),
    ('daejeon',     '대전충남본부',   'regional', 6),
    ('jeonbuk',     '전북본부',       'regional', 7),
    ('gwangju',     '광주본부',       'regional', 8),
    ('jeonnam',     '전남본부',       'regional', 9),
    ('gyeongbuk',   '경북본부',       'regional', 10),
    ('daegu',       '대구본부',       'regional', 11),
    ('busan',       '부산경남본부',   'regional', 12),
    ('hsfacility',  '고속시설사업단', 'special',  13),
    ('hselectric',  '고속전기사업단', 'special',  14),
]

# 조직별 HQ 역 GPS (zoom_level=3.0)
ORG_VIEWPORTS = {
    '서울본부':       (37.5546, 126.9706),  # 서울역
    '수도권서부본부': (37.5157, 126.9076),  # 영등포역
    '수도권동부본부': (37.6016, 127.0675),  # 신이문역
    '강원본부':       (37.4983, 129.1232),  # 동해역
    '충북본부':       (37.1276, 128.2050),  # 제천역
    '대전충남본부':   (36.3320, 127.4345),  # 대전역
    '전북본부':       (35.9402, 126.9458),  # 익산역
    '광주본부':       (35.1658, 126.9094),  # 광주역
    '전남본부':       (34.9459, 127.5039),  # 순천역
    '경북본부':       (36.8105, 128.6259),  # 영주역
    '대구본부':       (35.8791, 128.6285),  # 동대구역
    '부산경남본부':   (35.1152, 129.0426),  # 부산역
    '고속시설사업단': (36.6198, 127.3279),  # 오송역
    '고속전기사업단': (36.6198, 127.3279),  # 오송역
}


def run():
    db = SessionLocal()
    try:
        for code, name, org_type, sort_order in ORGANIZATIONS:
            existing = db.execute(
                text("SELECT id FROM organizations WHERE code = :code"),
                {"code": code}
            ).fetchone()
            if existing:
                db.execute(
                    text("UPDATE organizations SET name=:name, sort_order=:so WHERE code=:code"),
                    {"name": name, "so": sort_order, "code": code}
                )
            else:
                db.execute(
                    text("""
                        INSERT INTO organizations (code, name, org_type, is_active, sort_order)
                        VALUES (:code, :name, :type, TRUE, :so)
                    """),
                    {"code": code, "name": name, "type": org_type, "so": sort_order}
                )

        db.commit()

        # 뷰포트 설정
        for code, name, _, _ in ORGANIZATIONS:
            if name not in ORG_VIEWPORTS:
                continue
            lat, lon = ORG_VIEWPORTS[name]
            org_id = db.execute(
                text("SELECT id FROM organizations WHERE code = :code"), {"code": code}
            ).scalar()
            existing = db.execute(
                text("SELECT id FROM org_viewport WHERE organization_id = :oid"), {"oid": org_id}
            ).fetchone()
            if existing:
                db.execute(
                    text("UPDATE org_viewport SET center_lat=:lat, center_lon=:lon, zoom_level=3.0 WHERE organization_id=:oid"),
                    {"lat": lat, "lon": lon, "oid": org_id}
                )
            else:
                db.execute(
                    text("INSERT INTO org_viewport (organization_id, center_lat, center_lon, zoom_level) VALUES (:oid, :lat, :lon, 3.0)"),
                    {"oid": org_id, "lat": lat, "lon": lon}
                )

        db.commit()
        print(f"조직 {len(ORGANIZATIONS)}개, 뷰포트 {len(ORG_VIEWPORTS)}개 시드 완료")
    finally:
        db.close()


if __name__ == "__main__":
    run()
