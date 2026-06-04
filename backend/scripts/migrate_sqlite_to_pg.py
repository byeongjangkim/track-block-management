"""
SQLite → PostgreSQL 데이터 이전 스크립트

실행: cd backend && python scripts/migrate_sqlite_to_pg.py

이전 순서 (FK 의존성 고려):
1. routes (legacy)
2. organizations
3. users
4. facilities (legacy)
5. rail_routes
6. rail_stations
7. rail_route_station_points
8. rail_baseline_points
9. rail_computed_geometry
10. rail_track_sections
11. rail_facility_classifications
12. rail_facility_management_offices
13. rail_facilities
14. rail_route_region_boundaries
15. rail_station_management_groups
16. rail_station_management_members
17. organization_route_ranges
18. org_viewport
19. system_settings
20. block_orders
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import sqlalchemy as sa
from sqlalchemy import text

SQLITE_URL = "sqlite:///./db.sqlite3"
PG_URL = None  # settings에서 자동 로드

def get_engines():
    sqlite_engine = sa.create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
    # PostgreSQL URL은 settings에서 로드
    from app.core.config import settings
    pg_engine = sa.create_engine(settings.DATABASE_URL)
    return sqlite_engine, pg_engine


def copy_table(sqlite_conn, pg_conn, table_name: str, batch_size: int = 1000):
    """테이블 데이터를 SQLite에서 PostgreSQL로 복사"""
    rows = sqlite_conn.execute(text(f"SELECT * FROM {table_name}")).mappings().fetchall()
    if not rows:
        print(f"  {table_name}: 0건 (스킵)")
        return 0

    # PostgreSQL에 기존 데이터 삭제 (재실행 안전)
    pg_conn.execute(text(f"DELETE FROM {table_name}"))

    total = len(rows)
    for i in range(0, total, batch_size):
        batch = rows[i:i + batch_size]
        dicts = [dict(row) for row in batch]
        # boolean 타입 변환: SQLite는 0/1, PostgreSQL은 True/False
        for d in dicts:
            for k, v in d.items():
                if isinstance(v, int) and v in (0, 1):
                    # 컬럼명으로 boolean 필드 추정
                    if any(w in k for w in ('is_', 'has_', '_anchor', '_active', '_external', 'catenary')):
                        d[k] = bool(v)

        pg_conn.execute(
            text(f"INSERT INTO {table_name} SELECT * FROM (VALUES {_values_placeholder(dicts[0])}) AS t ({_col_names(dicts[0])})").bindparams(**dicts[0])
            if False else text(f"INSERT INTO {table_name} ({_col_names(dicts[0])}) VALUES ({_val_placeholders(dicts[0])})")
        )
        # bulk insert
        if dicts:
            stmt = sa.text(f"INSERT INTO {table_name} ({_col_names(dicts[0])}) VALUES ({_val_placeholders(dicts[0])})")
            pg_conn.execute(stmt, dicts)

    print(f"  {table_name}: {total}건 이전 완료")
    return total


def _col_names(d: dict) -> str:
    return ", ".join(f'"{k}"' for k in d.keys())


def _val_placeholders(d: dict) -> str:
    return ", ".join(f":{k}" for k in d.keys())


def _values_placeholder(d: dict) -> str:
    return "(" + ", ".join(f":{k}" for k in d.keys()) + ")"


def migrate():
    sqlite_engine, pg_engine = get_engines()

    # 이전 순서 정의
    tables = [
        "routes",
        "organizations",
        "users",
        "facilities",
        "rail_routes",
        "rail_stations",
        "rail_route_station_points",
        "rail_baseline_points",
        "rail_computed_geometry",
        "rail_track_sections",
        "rail_facility_classifications",
        "rail_facility_management_offices",
        "rail_facilities",
        "rail_route_region_boundaries",
        "rail_station_management_groups",
        "rail_station_management_members",
        "organization_route_ranges",
        "org_viewport",
        "system_settings",
        "block_orders",
    ]

    print("=== SQLite → PostgreSQL 데이터 이전 시작 ===\n")
    total_rows = 0

    with sqlite_engine.connect() as sqlite_conn, pg_engine.begin() as pg_conn:
        # FK 제약 임시 비활성화
        pg_conn.execute(text("SET session_replication_role = replica"))

        for table in tables:
            try:
                rows = sqlite_conn.execute(text(f"SELECT * FROM {table}")).mappings().fetchall()
                if not rows:
                    print(f"  {table}: 0건 (스킵)")
                    continue

                pg_conn.execute(text(f'DELETE FROM "{table}"'))

                dicts = []
                for row in rows:
                    d = dict(row)
                    for k, v in list(d.items()):
                        if isinstance(v, int) and v in (0, 1):
                            if any(w in k for w in
                                   ('is_', 'has_', '_anchor', '_active', '_external',
                                    'default_has_catenary', 'is_render', 'is_interpolation',
                                    'is_baseline')):
                                d[k] = bool(v)
                    dicts.append(d)

                col_names = _col_names(dicts[0])
                val_ph = _val_placeholders(dicts[0])
                stmt = text(f'INSERT INTO "{table}" ({col_names}) VALUES ({val_ph})')

                # 1000건씩 batch
                batch_size = 500
                for i in range(0, len(dicts), batch_size):
                    pg_conn.execute(stmt, dicts[i:i+batch_size])

                count = len(dicts)
                total_rows += count
                print(f"  {table}: {count:,}건")

            except Exception as e:
                print(f"  {table}: 오류 — {e}")
                raise

        # FK 제약 복구
        pg_conn.execute(text("SET session_replication_role = DEFAULT"))

        # SERIAL 시퀀스를 최대 ID 값으로 갱신
        print("\n시퀀스 갱신 중...")
        seq_tables = [
            "routes", "organizations", "users", "facilities", "rail_routes",
            "rail_stations", "rail_route_station_points", "rail_baseline_points",
            "rail_computed_geometry", "rail_track_sections", "rail_facility_classifications",
            "rail_facility_management_offices", "rail_facilities",
            "rail_route_region_boundaries", "rail_station_management_groups",
            "rail_station_management_members", "organization_route_ranges",
            "org_viewport", "system_settings", "block_orders",
        ]
        for table in seq_tables:
            try:
                pg_conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                    f"COALESCE(MAX(id), 1)) FROM \"{table}\""
                ))
            except Exception:
                pass  # id 컬럼이 없거나 시퀀스 없는 경우 무시

    print(f"\n=== 이전 완료: 총 {total_rows:,}건 ===")


if __name__ == "__main__":
    migrate()
