"""add rail_computed_geometry table

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-05-27

변경 내용:
  rail_computed_geometry 테이블 신설

  목적:
    - rail_baseline_points(역·시설물 anchor)에서 보간하여 생성한 노선 좌표 계열 저장
    - 기존 route_geometry(shp/user CSV 기반)를 단계적으로 대체
    - line_type 역정규화로 고속선/일반선 조회 성능 확보
    - lod 3단계(high/mid/low) 자동 생성으로 줌 레벨별 최적 렌더링 지원

  source 컬럼 값:
    'station'       역 KP·GPS anchor 에서 직접 채용
    'facility'      시설물 KP·GPS anchor 에서 직접 채용
    'interpolated'  인접 anchor 간 선형 보간
    'manual'        수동 보정점

  lod 컬럼 값:
    'high'   원본 해상도 (~500 m 간격)
    'mid'    중간 (~2 km 간격)
    'low'    간략 (~10 km 간격)
"""
import sqlalchemy as sa
from alembic import op

revision = "b7c8d9e0f1a2"
down_revision = "a6b7c8d9e0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rail_computed_geometry",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "rail_route_id",
            sa.Integer(),
            sa.ForeignKey("rail_routes.id"),
            nullable=False,
        ),
        # 역정규화: 조회 시 JOIN 없이 고속선/일반선 필터 가능
        sa.Column(
            "line_type",
            sa.String(20),
            nullable=False,
            server_default="일반선",
        ),
        sa.Column("kp", sa.Float(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        # 이 좌표의 원천: station | facility | interpolated | manual
        sa.Column(
            "source",
            sa.String(20),
            nullable=False,
            server_default="interpolated",
        ),
        # LOD: high | mid | low
        sa.Column(
            "lod",
            sa.String(10),
            nullable=False,
            server_default="high",
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.UniqueConstraint("rail_route_id", "lod", "seq", name="uq_rcg_route_lod_seq"),
    )

    op.create_index(
        "idx_rcg_route_lod",
        "rail_computed_geometry",
        ["rail_route_id", "lod"],
    )
    op.create_index(
        "idx_rcg_line_type_lod",
        "rail_computed_geometry",
        ["line_type", "lod"],
    )


def downgrade() -> None:
    op.drop_index("idx_rcg_line_type_lod", table_name="rail_computed_geometry")
    op.drop_index("idx_rcg_route_lod", table_name="rail_computed_geometry")
    op.drop_table("rail_computed_geometry")
