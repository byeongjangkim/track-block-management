"""tc07: organizations.sort_order — 지역본부 표시 순서 컬럼 추가

서울→수도권서부→수도권동부→강원→충북→대전충남→전북→광주→전남→경북→대구→부산경남→고속시설→고속전기

Revision ID: tc07_org_sort_order
Revises: tc06_org_ranges_rail_route
Create Date: 2026-06-04
"""

revision = 'tc07_org_sort_order'
down_revision = 'tc06_org_ranges_rail_route'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa

# (org_id, sort_order) 매핑
_SORT_MAP = [
    (1,  1),   # 서울본부
    (12, 2),   # 수도권서부본부
    (11, 3),   # 수도권동부본부
    (10, 4),   # 강원본부
    (2,  5),   # 충북본부
    (3,  6),   # 대전충남본부
    (4,  7),   # 전북본부
    (5,  8),   # 광주본부
    (6,  9),   # 전남본부
    (7,  10),  # 경북본부
    (8,  11),  # 대구본부
    (9,  12),  # 부산경남본부
    (13, 13),  # 고속시설사업단
    (14, 14),  # 고속전기사업단
]


def upgrade():
    op.add_column('organizations', sa.Column('sort_order', sa.Integer(), nullable=True))
    for org_id, sort_order in _SORT_MAP:
        op.execute(f"UPDATE organizations SET sort_order = {sort_order} WHERE id = {org_id}")
    # 미지정 조직은 sort_order=99로 fallback
    op.execute("UPDATE organizations SET sort_order = 99 WHERE sort_order IS NULL")


def downgrade():
    op.drop_column('organizations', 'sort_order')
