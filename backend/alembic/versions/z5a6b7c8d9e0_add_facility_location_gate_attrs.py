"""add facility location and gate attributes

Revision ID: z5a6b7c8d9e0
Revises: y4z5a6b7c8d9
Create Date: 2026-05-16

추가 컬럼:
  공통 (모든 시설물)
    section_from          TEXT  — 역간 시작역명
    section_to            TEXT  — 역간 종료역명
    address               TEXT  — 시설물 주소
  선로출입문 전용 (STRUCTURE_GATE_UP / STRUCTURE_GATE_DOWN)
    road_width_m          REAL  — 도로폭 (m)
    is_paved              INTEGER(bool) — 포장 유무
    bus_accessible        INTEGER(bool) — 버스 진입 가능여부
    entrance_passage_type TEXT  — 통로 형태
    entrance_lock_type    TEXT  — 잠금방식 (번호키/일반열쇠/전자키 등)
"""
import sqlalchemy as sa
from alembic import op

revision = "z5a6b7c8d9e0"
down_revision = "y4z5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rail_facilities") as batch_op:
        batch_op.add_column(sa.Column("section_from", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("section_to", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("address", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("road_width_m", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("is_paved", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("bus_accessible", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("entrance_passage_type", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("entrance_lock_type", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("rail_facilities") as batch_op:
        batch_op.drop_column("entrance_lock_type")
        batch_op.drop_column("entrance_passage_type")
        batch_op.drop_column("bus_accessible")
        batch_op.drop_column("is_paved")
        batch_op.drop_column("road_width_m")
        batch_op.drop_column("address")
        batch_op.drop_column("section_to")
        batch_op.drop_column("section_from")
