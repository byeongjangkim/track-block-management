"""cleanup facilities and fix field codes

- facilities: use_as_anchor, boundary, lat_end, lon_end 컬럼 제거
- block_orders.field: '궤도' → '건축' 데이터 정정
- users.field: 빈문자열('') → NULL 데이터 정정

Revision ID: a9b1c2d3e4f5
Revises: 6f112792a0fb
Create Date: 2026-04-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a9b1c2d3e4f5'
down_revision: Union[str, Sequence[str], None] = 'f5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. facilities: 레거시 컬럼 제거
    #    - use_as_anchor: 구 route_geometry 자동 생성 로직 잔재 — 현재 불필요
    #    - boundary:      관할 경계 정보는 organization_route_ranges 에서 관리 — 중복
    #    - lat_end, lon_end: km_end + route_geometry 보간으로 대체 — 모든 데이터 NULL
    with op.batch_alter_table("facilities") as batch_op:
        batch_op.drop_column("use_as_anchor")
        batch_op.drop_column("boundary")
        batch_op.drop_column("lat_end")
        batch_op.drop_column("lon_end")

    # 2. block_orders.field: '궤도' → '건축' (분야 코드 정정)
    op.execute("UPDATE block_orders SET field = '건축' WHERE field = '궤도'")

    # 3. users.field: 빈문자열 → NULL 정정
    op.execute("UPDATE users SET field = NULL WHERE field = ''")


def downgrade() -> None:
    # lat_end, lon_end, boundary 복원
    with op.batch_alter_table("facilities") as batch_op:
        batch_op.add_column(sa.Column("lon_end", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("lat_end", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("boundary", sa.String(length=8), nullable=True))
        batch_op.add_column(sa.Column("use_as_anchor", sa.Boolean(), nullable=False,
                                      server_default=sa.text("1")))

    # block_orders.field 원복 불가 (어떤 레코드가 '궤도'였는지 알 수 없음)
    # users.field 원복 불가 (어떤 레코드가 ''였는지 알 수 없음)
