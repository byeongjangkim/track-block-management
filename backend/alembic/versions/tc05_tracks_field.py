"""tc05: direction → tracks, 단선차단/복선차단 → 선로차단

Revision ID: tc05_tracks_field
Revises: tc04_system_settings
Create Date: 2026-06-02

변경사항:
  block_orders.direction (VARCHAR4: UP/DOWN/BOTH)
    → block_orders.tracks (TEXT: JSON 배열, 예: '["상선"]', '["상선","하선"]')

  선로 이름 체계:
    복선(2):    상선, 하선
    2복선(4):   상1, 상2, 하1, 하2
    3복선(6):   상1, 상2, 상3, 하1, 하2, 하3
    단선(1):    상선

  block_type:
    단선차단 → 선로차단
    복선차단 → 선로차단
"""

from alembic import op
import sqlalchemy as sa


revision = 'tc05_tracks_field'
down_revision = 'tc04_system_settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. tracks 컬럼 추가
    with op.batch_alter_table('block_orders') as batch_op:
        batch_op.add_column(sa.Column('tracks', sa.Text(), nullable=True))

    # 2. 기존 direction 값을 tracks JSON으로 변환
    op.execute("""
        UPDATE block_orders
        SET tracks = CASE
            WHEN direction = 'UP'   THEN '["상선"]'
            WHEN direction = 'DOWN' THEN '["하선"]'
            WHEN direction = 'BOTH' THEN '["상선","하선"]'
            ELSE '["상선"]'
        END
    """)

    # 3. tracks NOT NULL 적용 (SQLite batch 방식)
    with op.batch_alter_table('block_orders') as batch_op:
        batch_op.alter_column('tracks', nullable=False)

    # 4. block_type 마이그레이션: 단선차단/복선차단 → 선로차단
    op.execute("""
        UPDATE block_orders
        SET block_type = '선로차단'
        WHERE block_type IN ('단선차단', '복선차단')
    """)

    # 5. direction 컬럼 제거 (SQLite는 batch_alter_table 필요)
    with op.batch_alter_table('block_orders') as batch_op:
        batch_op.drop_column('direction')


def downgrade() -> None:
    # direction 컬럼 복원
    with op.batch_alter_table('block_orders') as batch_op:
        batch_op.add_column(sa.Column('direction', sa.String(4), nullable=True))

    # tracks → direction 역변환 (단순화: 첫 번째 트랙만 사용)
    op.execute("""
        UPDATE block_orders
        SET direction = CASE
            WHEN tracks LIKE '%"상선"%' AND tracks LIKE '%"하선"%' THEN 'BOTH'
            WHEN tracks LIKE '%"상선"%' OR tracks LIKE '%"상1"%' OR tracks LIKE '%"상2"%' OR tracks LIKE '%"상3"%' THEN 'UP'
            ELSE 'DOWN'
        END
    """)

    with op.batch_alter_table('block_orders') as batch_op:
        batch_op.alter_column('direction', nullable=False)
        batch_op.drop_column('tracks')

    # block_type 복원 불가 (선로차단 → 원래 단선/복선 구분 정보 소실됨)
