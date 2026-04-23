"""block_order_add_facility_fk

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-04-18 11:00:00.000000

변경 내용:
  - block_orders.start_facility_id (INTEGER, FK→facilities.id, nullable)
    : 전차선 단전 시작 변전소/SP/SSP
  - block_orders.end_facility_id   (INTEGER, FK→facilities.id, nullable)
    : 전차선 단전 종료 변전소/SP/SSP

설계 배경:
  전차선 단전 차단명령은 start_km/end_km 대신 변전소 구간명(section_note)을 사용한다.
  지도 표시 시 변전소 km 값을 facilities 테이블에서 조회하여 구간 좌표를 계산하기 위해
  facilities 레코드에 대한 FK를 직접 저장한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite는 ALTER TABLE ADD COLUMN 시 ForeignKey 제약 추가 불가.
    # FK 참조는 ORM 모델 레벨에서만 선언하고, DDL은 INTEGER 컬럼만 추가한다.
    op.add_column('block_orders', sa.Column('start_facility_id', sa.Integer(), nullable=True))
    op.add_column('block_orders', sa.Column('end_facility_id',   sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('block_orders', 'end_facility_id')
    op.drop_column('block_orders', 'start_facility_id')
