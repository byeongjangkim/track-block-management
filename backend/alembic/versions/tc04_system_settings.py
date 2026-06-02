"""system_settings: 시스템 설정 테이블 및 초기 색상 설정

Revision ID: tc04_system_settings
Revises: tc03_bore_type
Create Date: 2026-06-02

카테고리:
  route_colors    — 노선 색상
  block_colors    — 차단구간 색상
  danger_colors   — 위험등급 색상
  facility_colors — 시설물 색상
"""
from alembic import op
import sqlalchemy as sa

revision = 'tc04_system_settings'
down_revision = 'tc03_bore_type'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'system_settings',
        sa.Column('id',          sa.Integer(), primary_key=True),
        sa.Column('category',    sa.String(50),  nullable=False),
        sa.Column('key',         sa.String(50),  nullable=False),
        sa.Column('value',       sa.String(255), nullable=False),
        sa.Column('default_value', sa.String(255), nullable=False),  # 기본값 복원용
        sa.Column('label',       sa.String(100), nullable=True),
        sa.Column('description', sa.String(255), nullable=True),
        sa.Column('sort_order',  sa.Integer(),   nullable=False, server_default='0'),
        sa.Column('updated_by',  sa.Integer(),   sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at',  sa.DateTime(),  server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint('category', 'key', name='uq_setting_category_key'),
    )

    # 초기 색상 설정 시드
    op.execute("""
        INSERT INTO system_settings (category, key, value, default_value, label, description, sort_order)
        VALUES
        -- 노선 색상
        ('route_colors', 'highway',         '#dc2626', '#dc2626', '고속선',           '고속선(KTX) 노선 색상', 10),
        ('route_colors', 'electrified',     '#f97316', '#f97316', '일반선 (전철화)',    '전차선이 있는 일반선 노선 색상', 20),
        ('route_colors', 'non_electrified', '#9ca3af', '#9ca3af', '일반선 (비전철)',    '전차선이 없는 일반선 노선 색상', 30),
        ('route_colors', 'catenary_cut',    '#16a34a', '#16a34a', '전차선단전 구간',   '전차선단전 시 노선 위에 표시되는 녹색 오버레이', 40),

        -- 차단구간 색상
        ('block_colors', 'track_block',     '#ca8a04', '#ca8a04', '선로차단',          '선로차단 구간 표시 색상', 10),
        ('block_colors', 'danger_zone',     '#ca8a04', '#ca8a04', '위험/보호지구',      '위험지구·보호지구 배경 색상', 20),

        -- 위험등급 색상
        ('danger_colors', 'level_a', '#ef4444', '#ef4444', 'A등급 (위험)', '차단작업 A등급 색상', 10),
        ('danger_colors', 'level_b', '#f59e0b', '#f59e0b', 'B등급 (주의)', '차단작업 B등급 색상', 20),
        ('danger_colors', 'level_c', '#10b981', '#10b981', 'C등급 (일반)', '차단작업 C등급 색상', 30),
        ('danger_colors', 'none',    '#6b7280', '#6b7280', '미지정',       '위험등급 미지정 색상', 40),

        -- 시설물 색상
        ('facility_colors', 'station_master',  '#1d4ed8', '#1d4ed8', '관리역',      '관리역 마커 색상', 10),
        ('facility_colors', 'station_general', '#3b82f6', '#3b82f6', '보통역',      '보통역 마커 색상', 20),
        ('facility_colors', 'station_unmanned','#60a5fa', '#60a5fa', '무인역',      '무인역 마커 색상', 30),
        ('facility_colors', 'signal_yard',     '#818cf8', '#818cf8', '신호장',      '신호장 마커 색상', 40),
        ('facility_colors', 'signal_post',     '#a78bfa', '#a78bfa', '신호소',      '신호소 마커 색상', 50),
        ('facility_colors', 'tunnel_bridge',   '#111111', '#111111', '터널·교량',   '터널·교량 심볼 윤곽선 색상', 60),
        ('facility_colors', 'substation',      '#7c3aed', '#7c3aed', '변전소',      '변전소 마커 색상', 70),
        ('facility_colors', 'elec_room',       '#0284c7', '#0284c7', '전기실',      '전기실 마커 색상', 80),
        ('facility_colors', 'comm_room',       '#16a34a', '#16a34a', '통신실',      '통신실 마커 색상', 90),
        ('facility_colors', 'signal_room',     '#b45309', '#b45309', '신호기계실',   '신호기계실 마커 색상', 100),
        ('facility_colors', 'crossing',        '#f59e0b', '#f59e0b', '건널목',      '건널목 마커 색상', 110),
        ('facility_colors', 'junction',        '#059669', '#059669', '분기',        '분기 마커 색상', 120)
    """)


def downgrade() -> None:
    op.drop_table('system_settings')
