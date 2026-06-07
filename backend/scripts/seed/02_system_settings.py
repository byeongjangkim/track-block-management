"""
시스템 설정 시드 데이터 (24개 색상·지도 설정)

실행: cd backend && python scripts/seed/02_system_settings.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from sqlalchemy import text
from app.core.database import SessionLocal

SETTINGS = [
    # (category, key, value, default_value, label, sort_order)
    # 노선 색상
    ('route_colors', 'highway',         '#dc2626', '#dc2626', '고속선',        1),
    ('route_colors', 'electrified',     '#000000', '#000000', '일반선 전철화',  2),
    ('route_colors', 'non_electrified', '#9ca3af', '#9ca3af', '일반선 비전철',  3),
    ('route_colors', 'catenary_cut',    '#16a34a', '#16a34a', '전차선단전',     4),
    # 차단 색상
    ('block_colors', 'track_block',     '#ca8a04', '#ca8a04', '선로차단',      1),
    ('block_colors', 'danger_zone',     '#ca8a04', '#ca8a04', '위험/보호지구', 2),
    # 위험등급 색상
    ('danger_colors', 'level_a', '#ef4444', '#ef4444', 'A등급(위험)', 1),
    ('danger_colors', 'level_b', '#f59e0b', '#f59e0b', 'B등급(주의)', 2),
    ('danger_colors', 'level_c', '#10b981', '#10b981', 'C등급(일반)', 3),
    ('danger_colors', 'none',    '#6b7280', '#6b7280', '미지정',      4),
    # 시설물 색상 (12개)
    ('facility_colors', 'station_master',    '#1d4ed8', '#1d4ed8', '관리역',    1),
    ('facility_colors', 'station_general',   '#2563eb', '#2563eb', '보통역',    2),
    ('facility_colors', 'station_unmanned',  '#60a5fa', '#60a5fa', '무인역',    3),
    ('facility_colors', 'station_signal',    '#93c5fd', '#93c5fd', '신호장',    4),
    ('facility_colors', 'station_signalbox', '#bfdbfe', '#bfdbfe', '신호소',    5),
    ('facility_colors', 'tunnel',            '#78716c', '#78716c', '터널',      6),
    ('facility_colors', 'bridge',            '#a78bfa', '#a78bfa', '교량',      7),
    ('facility_colors', 'overpass',          '#c4b5fd', '#c4b5fd', '과선교',    8),
    ('facility_colors', 'crossing',          '#fca5a5', '#fca5a5', '건널목',    9),
    ('facility_colors', 'junction',          '#fb923c', '#fb923c', '분기',     10),
    ('facility_colors', 'substation',        '#facc15', '#facc15', '변전소',   11),
    ('facility_colors', 'other',             '#9ca3af', '#9ca3af', '기타',     12),
    # 지도 설정
    ('map_settings', 'station_points_mode', 'center_only', 'center_only', '역 좌표 모드', 1),
    ('map_settings', 'stroke_cap_zoom',     '5',           '5',           '선두께 포화배율', 2),
]


def run():
    db = SessionLocal()
    try:
        for cat, key, val, default, label, so in SETTINGS:
            existing = db.execute(
                text("SELECT id FROM system_settings WHERE category=:c AND key=:k"),
                {"c": cat, "k": key}
            ).fetchone()
            if existing:
                db.execute(
                    text("UPDATE system_settings SET value=:v, default_value=:d, label=:l, sort_order=:so WHERE category=:c AND key=:k"),
                    {"v": val, "d": default, "l": label, "so": so, "c": cat, "k": key}
                )
            else:
                db.execute(
                    text("""
                        INSERT INTO system_settings (category, key, value, default_value, label, sort_order)
                        VALUES (:c, :k, :v, :d, :l, :so)
                    """),
                    {"c": cat, "k": key, "v": val, "d": default, "l": label, "so": so}
                )
        db.commit()
        print(f"시스템 설정 {len(SETTINGS)}개 시드 완료")
    finally:
        db.close()


if __name__ == "__main__":
    run()
