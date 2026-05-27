"""redesign facility classifications

Revision ID: y4z5a6b7c8d9
Revises: x3y4z5a6b7c8
Create Date: 2026-05-16

변경 내용:
- tertiary_category 컬럼 추가 (3차 분류: 건널목 1/2/3종, 신호기계실 IEC/InEC)
- UNIQUE 제약 (major, sub, detail, tertiary) 로 확장
- 대분류 재편: 구조물 / 전기설비 2개로 통합
  - 선로 출입문 → 구조물/선로출입문
  - 철도건널목   → 구조물/건널목 (유인/무인 → 2차, 1~3종 → 3차)
  - 철도변전소   → 전기설비/변전설비
- 신규: 터널사갱·수직구·집수정, 배전소, IEC·InEC, 통신기계실 (7개)
- 기존 17개 → 변경 후 24개
"""
import sqlalchemy as sa
from alembic import op


revision = "y4z5a6b7c8d9"
down_revision = "x3y4z5a6b7c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── Step 1: 테이블 재생성 (tertiary_category + 새 UNIQUE 제약) ─────────────
    conn.execute(sa.text("DROP TABLE IF EXISTS rail_facility_classifications_new"))

    conn.execute(sa.text("""
        CREATE TABLE rail_facility_classifications_new (
            id                INTEGER  PRIMARY KEY,
            code              TEXT(50) UNIQUE NOT NULL,
            major_category    TEXT(30) NOT NULL,
            sub_category      TEXT(50) NOT NULL,
            detail_category   TEXT(30),
            tertiary_category TEXT(30),
            geometry_type     TEXT(20) NOT NULL,
            sort_order        INTEGER  NOT NULL,
            is_active         BOOLEAN  NOT NULL DEFAULT 1,
            created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (major_category, sub_category, detail_category, tertiary_category)
        )
    """))

    conn.execute(sa.text("""
        INSERT INTO rail_facility_classifications_new
            (id, code, major_category, sub_category, detail_category,
             tertiary_category, geometry_type, sort_order, is_active, created_at)
        SELECT
            id, code, major_category, sub_category, detail_category,
            NULL, geometry_type, sort_order, is_active, created_at
        FROM rail_facility_classifications
    """))

    conn.execute(sa.text("DROP TABLE rail_facility_classifications"))
    conn.execute(sa.text(
        "ALTER TABLE rail_facility_classifications_new RENAME TO rail_facility_classifications"
    ))

    # ── Step 2: 기존 13개 코드 업데이트 ───────────────────────────────────────
    updates = [
        # 선로출입문 → 구조물/선로출입문
        ("STRUCTURE_GATE_UP",             "구조물",   "선로출입문", "상선", None,   50,  "TRACK_GATE_UP"),
        ("STRUCTURE_GATE_DOWN",           "구조물",   "선로출입문", "하선", None,   51,  "TRACK_GATE_DOWN"),
        # 건널목 → 구조물/건널목/유인·무인 (3차에 종별)
        ("STRUCTURE_CROSSING_STAFFED_1",   "구조물",  "건널목", "유인", "1종", 40, "CROSSING_STAFFED_CLASS1"),
        ("STRUCTURE_CROSSING_STAFFED_2",   "구조물",  "건널목", "유인", "2종", 41, "CROSSING_STAFFED_CLASS2"),
        ("STRUCTURE_CROSSING_STAFFED_3",   "구조물",  "건널목", "유인", "3종", 42, "CROSSING_STAFFED_CLASS3"),
        ("STRUCTURE_CROSSING_UNSTAFFED_1", "구조물",  "건널목", "무인", "1종", 43, "CROSSING_UNSTAFFED_CLASS1"),
        ("STRUCTURE_CROSSING_UNSTAFFED_2", "구조물",  "건널목", "무인", "2종", 44, "CROSSING_UNSTAFFED_CLASS2"),
        ("STRUCTURE_CROSSING_UNSTAFFED_3", "구조물",  "건널목", "무인", "3종", 45, "CROSSING_UNSTAFFED_CLASS3"),
        # 철도변전소 → 전기설비/변전설비
        ("ELEC_SUBSTATION_SS",  "전기설비", "변전설비", "SS",  None, 310, "SUBSTATION_SS"),
        ("ELEC_SUBSTATION_SP",  "전기설비", "변전설비", "SP",  None, 320, "SECTIONING_POST_SP"),
        ("ELEC_SUBSTATION_SSP", "전기설비", "변전설비", "SSP", None, 330, "SUB_SECTIONING_POST_SSP"),
        ("ELEC_SUBSTATION_PP",  "전기설비", "변전설비", "PP",  None, 340, "PARALLEL_POST_PP"),
        ("ELEC_SUBSTATION_ATP", "전기설비", "변전설비", "ATP", None, 350, "ATP"),
    ]

    for new_code, major, sub, detail, tertiary, sort, old_code in updates:
        tertiary_val = f"'{tertiary}'" if tertiary else "NULL"
        conn.execute(sa.text(f"""
            UPDATE rail_facility_classifications
            SET code              = '{new_code}',
                major_category    = '{major}',
                sub_category      = '{sub}',
                detail_category   = '{detail}',
                tertiary_category = {tertiary_val},
                sort_order        = {sort}
            WHERE code = '{old_code}'
        """))

    # STRUCTURE_OTHER: sort_order 40 → 60 (40~45 범위를 건널목이 점유)
    conn.execute(sa.text(
        "UPDATE rail_facility_classifications SET sort_order = 60 WHERE code = 'STRUCTURE_OTHER'"
    ))

    # ── Step 3: 신규 7개 삽입 ─────────────────────────────────────────────────
    new_rows = [
        ("STRUCTURE_TUNNEL_SGANG",    "구조물",   "터널",    "사갱",      None,    "point", 21),
        ("STRUCTURE_TUNNEL_VERTICAL", "구조물",   "터널",    "수직구",    None,    "point", 22),
        ("STRUCTURE_TUNNEL_SUMP",     "구조물",   "터널",    "집수정",    None,    "point", 23),
        ("ELEC_POWER_DIST",  "전기설비", "전력설비", "배전소",    None,    "point", 360),
        ("ELEC_SIGNAL_IEC",  "전기설비", "신호설비", "신호기계실", "IEC",  "point", 410),
        ("ELEC_SIGNAL_INEC", "전기설비", "신호설비", "신호기계실", "InEC", "point", 420),
        ("ELEC_COMM_ROOM",   "전기설비", "통신설비", "통신기계실", None,   "point", 510),
    ]

    for code, major, sub, detail, tertiary, geom, sort in new_rows:
        tertiary_val = f"'{tertiary}'" if tertiary else "NULL"
        conn.execute(sa.text(f"""
            INSERT INTO rail_facility_classifications
                (code, major_category, sub_category, detail_category,
                 tertiary_category, geometry_type, sort_order)
            VALUES
                ('{code}', '{major}', '{sub}', '{detail}',
                 {tertiary_val}, '{geom}', {sort})
        """))


def downgrade() -> None:
    raise NotImplementedError("이 마이그레이션은 되돌릴 수 없습니다.")
