"""rename_facility_types_to_korean

Revision ID: i8j9k0l1m2n3
Revises: h7i8j9k0l1m2
Create Date: 2026-04-24 00:00:00.000000

변경 내용:
  - facilities.type 값을 영문 코드 → 한글 대분류로 전환
    STATION → 역 | SUBSTATION → 변전소
    TUNNEL/BRIDGE/OVERPASS/CROSSING → 구조물
    JUNCTION → 구조물 | BOUNDARY → 소속경계
  - 신규 대분류: 역, 변전소, 구조물, 소속경계
  - station_type 컬럼: 역 소분류 (관리역/보통역/무인역/신호장/신호소) 및
    구조물 소분류 (터널/교량/과선교/건널목), 변전소 소분류 (ss/sp/ssp/atp/pp)로 확장
"""
from typing import Sequence, Union
from alembic import op


revision: str = 'i8j9k0l1m2n3'
down_revision: Union[str, Sequence[str], None] = 'h7i8j9k0l1m2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE facilities SET type='역' WHERE type='STATION'")
    op.execute("UPDATE facilities SET type='역' WHERE type='GENERAL_STATION'")
    op.execute("UPDATE facilities SET type='변전소' WHERE type='SUBSTATION'")
    op.execute("UPDATE facilities SET type='구조물', station_type='터널' WHERE type='TUNNEL'")
    op.execute("UPDATE facilities SET type='구조물', station_type='교량' WHERE type='BRIDGE'")
    op.execute("UPDATE facilities SET type='구조물', station_type='과선교' WHERE type='OVERPASS'")
    op.execute("UPDATE facilities SET type='구조물', station_type='건널목' WHERE type='CROSSING'")
    op.execute("UPDATE facilities SET type='구조물', station_type='분기' WHERE type='JUNCTION'")
    op.execute("UPDATE facilities SET type='소속경계' WHERE type='BOUNDARY'")


def downgrade() -> None:
    op.execute("UPDATE facilities SET type='STATION' WHERE type='역' AND (station_type IN ('관리역','보통역','무인역','신호장','신호소') OR station_type IS NULL)")
    op.execute("UPDATE facilities SET type='SUBSTATION' WHERE type='변전소'")
    op.execute("UPDATE facilities SET type='TUNNEL' WHERE type='구조물' AND station_type='터널'")
    op.execute("UPDATE facilities SET type='BRIDGE' WHERE type='구조물' AND station_type='교량'")
    op.execute("UPDATE facilities SET type='OVERPASS' WHERE type='구조물' AND station_type='과선교'")
    op.execute("UPDATE facilities SET type='CROSSING' WHERE type='구조물' AND station_type='건널목'")
    op.execute("UPDATE facilities SET type='JUNCTION' WHERE type='구조물' AND station_type='분기'")
    op.execute("UPDATE facilities SET type='BOUNDARY' WHERE type='소속경계'")
