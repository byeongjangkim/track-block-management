"""add signal general and comm rs classifications

Revision ID: b2c3d4e5f6a7
Revises: z5a6b7c8d9e0
Create Date: 2026-05-28

추가 분류 코드:
  ELEC_SIGNAL_GENERAL  — 전기설비 > 신호설비 > 신호기계실 (3차 분류 없음, sort_order=400)
  ELEC_COMM_RS         — 전기설비 > 통신설비 > 무선기지국 / RS (sort_order=520)
"""
from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "a0b1c2d3e4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO rail_facility_classifications
            (code, major_category, sub_category, detail_category, tertiary_category, geometry_type, sort_order, is_active)
        VALUES
            ('ELEC_SIGNAL_GENERAL', '전기설비', '신호설비', '신호기계실', NULL, 'point', 400, 1),
            ('ELEC_COMM_RS',        '전기설비', '통신설비', '무선기지국',  'RS',  'point', 520, 1)
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM rail_facility_classifications
        WHERE code IN ('ELEC_SIGNAL_GENERAL', 'ELEC_COMM_RS')
    """)
