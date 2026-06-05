"""v1: 초기 스키마 — 전체 테이블 정의 (PostgreSQL)

tc01~tc09 + 이전 모든 마이그레이션을 단일 파일로 통합.
개발 완료 기준점: PostgreSQL 16, 2026-06-05

Revision ID: v1_initial_schema
Revises:
Create Date: 2026-06-05
"""

revision = 'v1_initial_schema'
down_revision = None
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    # ── routes (legacy) ────────────────────────────────────────────────────
    op.create_table('routes',
        sa.Column('id',               sa.Integer(),     primary_key=True),
        sa.Column('code',             sa.String(30),    nullable=False, unique=True),
        sa.Column('name',             sa.String(100),   nullable=False),
        sa.Column('start_km',         sa.Float(),       nullable=True),
        sa.Column('end_km',           sa.Float(),       nullable=True),
        sa.Column('start_station',    sa.String(50),    nullable=True),
        sa.Column('end_station',      sa.String(50),    nullable=True),
        sa.Column('up_direction',     sa.String(50),    nullable=True),
        sa.Column('down_direction',   sa.String(50),    nullable=True),
        sa.Column('default_track_count', sa.Integer(),  nullable=False, server_default='2'),
    )

    # ── organizations ──────────────────────────────────────────────────────
    op.create_table('organizations',
        sa.Column('id',         sa.Integer(),    primary_key=True),
        sa.Column('code',       sa.String(30),   nullable=False, unique=True),
        sa.Column('name',       sa.String(100),  nullable=False),
        sa.Column('org_type',   sa.String(20),   nullable=False),
        sa.Column('is_active',  sa.Boolean(),    nullable=False, server_default='true'),
        sa.Column('sort_order', sa.Integer(),    nullable=False, server_default='99'),
    )

    # ── users ──────────────────────────────────────────────────────────────
    op.create_table('users',
        sa.Column('id',               sa.Integer(),    primary_key=True),
        sa.Column('username',         sa.String(100),  nullable=False, unique=True),
        sa.Column('hashed_password',  sa.String(255),  nullable=False),
        sa.Column('full_name',        sa.String(100),  nullable=False),
        sa.Column('role',             sa.String(30),   nullable=False, server_default='user'),
        sa.Column('field',            sa.String(20),   nullable=True),
        sa.Column('organization_id',  sa.Integer(),    sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('is_active',        sa.Boolean(),    nullable=False, server_default='true'),
        sa.Column('created_at',       sa.DateTime(),   nullable=True),
    )

    # ── org_viewport ────────────────────────────────────────────────────────
    op.create_table('org_viewport',
        sa.Column('id',              sa.Integer(), primary_key=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False, unique=True),
        sa.Column('center_lat',      sa.Float(),   nullable=False),
        sa.Column('center_lon',      sa.Float(),   nullable=False),
        sa.Column('zoom_level',      sa.Float(),   nullable=False, server_default='3.0'),
    )

    # ── facilities (legacy) ─────────────────────────────────────────────────
    op.create_table('facilities',
        sa.Column('id',          sa.Integer(),    primary_key=True),
        sa.Column('route_id',    sa.Integer(),    sa.ForeignKey('routes.id'), nullable=False),
        sa.Column('type',        sa.String(30),   nullable=False),
        sa.Column('name',        sa.String(100),  nullable=False),
        sa.Column('km',          sa.Float(),      nullable=False),
        sa.Column('has_station_map', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('station_type',sa.String(30),   nullable=True),
    )

    # ── system_settings ────────────────────────────────────────────────────
    op.create_table('system_settings',
        sa.Column('id',            sa.Integer(),    primary_key=True),
        sa.Column('category',      sa.String(50),   nullable=False),
        sa.Column('key',           sa.String(50),   nullable=False),
        sa.Column('value',         sa.String(255),  nullable=False),
        sa.Column('default_value', sa.String(255),  nullable=False),
        sa.Column('label',         sa.String(100),  nullable=True),
        sa.Column('description',   sa.String(255),  nullable=True),
        sa.Column('sort_order',    sa.Integer(),    nullable=False, server_default='0'),
        sa.Column('updated_by',    sa.Integer(),    sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at',    sa.DateTime(),   nullable=True),
        sa.UniqueConstraint('category', 'key', name='uq_setting_category_key'),
    )

    # ── rail_routes ────────────────────────────────────────────────────────
    op.create_table('rail_routes',
        sa.Column('id',                    sa.Integer(),    primary_key=True),
        sa.Column('korail_route_code',     sa.String(20),   nullable=False, unique=True),
        sa.Column('name',                  sa.String(100),  nullable=False),
        sa.Column('line_type',             sa.String(20),   nullable=False),
        sa.Column('route_category',        sa.String(50),   nullable=True),
        sa.Column('start_station_name',    sa.String(100),  nullable=True),
        sa.Column('end_station_name',      sa.String(100),  nullable=True),
        sa.Column('start_lat',             sa.Float(),      nullable=True),
        sa.Column('start_lon',             sa.Float(),      nullable=True),
        sa.Column('end_lat',               sa.Float(),      nullable=True),
        sa.Column('end_lon',               sa.Float(),      nullable=True),
        sa.Column('start_kp',              sa.Float(),      nullable=True),
        sa.Column('end_kp',                sa.Float(),      nullable=True),
        sa.Column('length_kp',             sa.Float(),      nullable=True),
        sa.Column('default_track_count',   sa.Integer(),    nullable=False, server_default='2'),
        sa.Column('default_has_catenary',  sa.Boolean(),    nullable=False, server_default='true'),
        sa.Column('is_active',             sa.Boolean(),    nullable=False, server_default='true'),
    )

    # ── rail_track_sections ────────────────────────────────────────────────
    op.create_table('rail_track_sections',
        sa.Column('id',            sa.Integer(), primary_key=True),
        sa.Column('rail_route_id', sa.Integer(), sa.ForeignKey('rail_routes.id'), nullable=False),
        sa.Column('start_kp',      sa.Float(),   nullable=False),
        sa.Column('end_kp',        sa.Float(),   nullable=False),
        sa.Column('track_count',   sa.Integer(), nullable=False),
        sa.Column('has_catenary',  sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('note',          sa.String(200), nullable=True),
    )

    # ── rail_stations ──────────────────────────────────────────────────────
    op.create_table('rail_stations',
        sa.Column('id',            sa.Integer(),    primary_key=True),
        sa.Column('station_code',  sa.String(20),   nullable=True),
        sa.Column('name',          sa.String(100),  nullable=False),
        sa.Column('lat',           sa.Float(),      nullable=True),
        sa.Column('lon',           sa.Float(),      nullable=True),
        sa.Column('station_role',  sa.String(30),   nullable=True),
        sa.Column('station_type',  sa.String(30),   nullable=True),
    )

    # ── rail_route_station_points ──────────────────────────────────────────
    op.create_table('rail_route_station_points',
        sa.Column('id',                  sa.Integer(), primary_key=True),
        sa.Column('rail_route_id',       sa.Integer(), sa.ForeignKey('rail_routes.id'), nullable=False),
        sa.Column('station_id',          sa.Integer(), sa.ForeignKey('rail_stations.id'), nullable=False),
        sa.Column('route_sequence_no',   sa.Integer(), nullable=True),
        sa.Column('center_kp',           sa.Float(),   nullable=True),
        sa.Column('yard_start_kp',       sa.Float(),   nullable=True),
        sa.Column('yard_end_kp',         sa.Float(),   nullable=True),
        sa.Column('regional_org',        sa.String(50), nullable=True),
        sa.Column('is_baseline_anchor',  sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('match_note',          sa.String(200), nullable=True),
    )

    # ── rail_baseline_points ───────────────────────────────────────────────
    op.create_table('rail_baseline_points',
        sa.Column('id',                       sa.Integer(),  primary_key=True),
        sa.Column('rail_route_id',            sa.Integer(),  sa.ForeignKey('rail_routes.id'), nullable=False),
        sa.Column('kp',                       sa.Float(),    nullable=False),
        sa.Column('lat',                      sa.Float(),    nullable=True),
        sa.Column('lon',                      sa.Float(),    nullable=True),
        sa.Column('point_type',               sa.String(30), nullable=True),
        sa.Column('is_render_anchor',         sa.Boolean(),  nullable=False, server_default='false'),
        sa.Column('is_interpolation_anchor',  sa.Boolean(),  nullable=False, server_default='false'),
        sa.Column('seq',                      sa.Integer(),  nullable=True),
        sa.Column('segment_no',               sa.Integer(),  nullable=True, server_default='0'),
        sa.Column('source',                   sa.String(50), nullable=True),
        sa.UniqueConstraint('rail_route_id', 'kp', 'point_type', 'seq',
                            name='uq_rail_baseline_route_kp_type_seq'),
    )
    op.create_index('idx_rbp_route_kp', 'rail_baseline_points', ['rail_route_id', 'kp'])

    # ── rail_computed_geometry ─────────────────────────────────────────────
    op.create_table('rail_computed_geometry',
        sa.Column('id',            sa.Integer(),    primary_key=True),
        sa.Column('rail_route_id', sa.Integer(),    sa.ForeignKey('rail_routes.id'), nullable=False),
        sa.Column('lod',           sa.String(10),   nullable=False),
        sa.Column('seq',           sa.Integer(),    nullable=False),
        sa.Column('kp',            sa.Float(),      nullable=False),
        sa.Column('lat',           sa.Float(),      nullable=False),
        sa.Column('lon',           sa.Float(),      nullable=False),
        sa.Column('line_type',     sa.String(20),   nullable=True),
        sa.UniqueConstraint('rail_route_id', 'lod', 'seq', name='uq_rcg_route_lod_seq'),
    )

    # ── rail_facility_classifications ──────────────────────────────────────
    op.create_table('rail_facility_classifications',
        sa.Column('id',                 sa.Integer(),    primary_key=True),
        sa.Column('code',               sa.String(20),   nullable=False, unique=True),
        sa.Column('major_category',     sa.String(50),   nullable=False),
        sa.Column('sub_category',       sa.String(50),   nullable=True),
        sa.Column('detail_category',    sa.String(50),   nullable=True),
        sa.Column('tertiary_category',  sa.String(50),   nullable=True),
        sa.Column('geometry_type',      sa.String(20),   nullable=False, server_default='point'),
        sa.Column('is_active',          sa.Boolean(),    nullable=False, server_default='true'),
    )

    # ── rail_facility_management_offices ──────────────────────────────────
    op.create_table('rail_facility_management_offices',
        sa.Column('id',           sa.Integer(),    primary_key=True),
        sa.Column('region_name',  sa.String(50),   nullable=False),
        sa.Column('office_name',  sa.String(100),  nullable=False),
        sa.Column('phone',        sa.String(30),   nullable=True),
    )

    # ── rail_facilities ────────────────────────────────────────────────────
    op.create_table('rail_facilities',
        sa.Column('id',                      sa.Integer(),    primary_key=True),
        sa.Column('rail_route_id',           sa.Integer(),    sa.ForeignKey('rail_routes.id'), nullable=False),
        sa.Column('facility_code',           sa.String(30),   nullable=True),
        sa.Column('name',                    sa.String(200),  nullable=False),
        sa.Column('classification_id',       sa.Integer(),    sa.ForeignKey('rail_facility_classifications.id'), nullable=False),
        sa.Column('kp_start',                sa.Float(),      nullable=False),
        sa.Column('kp_end',                  sa.Float(),      nullable=True),
        sa.Column('lat',                     sa.Float(),      nullable=True),
        sa.Column('lon',                     sa.Float(),      nullable=True),
        sa.Column('lat_end',                 sa.Float(),      nullable=True),
        sa.Column('lon_end',                 sa.Float(),      nullable=True),
        sa.Column('direction',               sa.String(10),   nullable=True),
        sa.Column('section_from',            sa.String(100),  nullable=True),
        sa.Column('section_to',              sa.String(100),  nullable=True),
        sa.Column('address',                 sa.String(200),  nullable=True),
        sa.Column('road_width_m',            sa.Float(),      nullable=True),
        sa.Column('is_paved',                sa.Boolean(),    nullable=True),
        sa.Column('bus_accessible',          sa.Boolean(),    nullable=True),
        sa.Column('entrance_passage_type',   sa.String(30),   nullable=True),
        sa.Column('entrance_lock_type',      sa.String(30),   nullable=True),
        sa.Column('nearest_station_id',      sa.Integer(),    sa.ForeignKey('rail_stations.id'), nullable=True),
        sa.Column('management_office_id',    sa.Integer(),    sa.ForeignKey('rail_facility_management_offices.id'), nullable=True),
        sa.Column('bore_type',               sa.String(20),   nullable=False, server_default='복선'),
        sa.Column('use_as_baseline_anchor',  sa.Boolean(),    nullable=False, server_default='false'),
        sa.Column('is_active',               sa.Boolean(),    nullable=False, server_default='true'),
        sa.Column('note',                    sa.Text(),       nullable=True),
        sa.Column('created_at',              sa.DateTime(),   nullable=True),
        sa.Column('updated_at',              sa.DateTime(),   nullable=True),
    )

    # ── rail_route_region_boundaries ──────────────────────────────────────
    op.create_table('rail_route_region_boundaries',
        sa.Column('id',              sa.Integer(),  primary_key=True),
        sa.Column('rail_route_id',   sa.Integer(),  sa.ForeignKey('rail_routes.id'), nullable=False),
        sa.Column('organization_id', sa.Integer(),  sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('field',           sa.String(20), nullable=False, server_default='all'),
        sa.Column('start_kp',        sa.Float(),    nullable=False),
        sa.Column('end_kp',          sa.Float(),    nullable=False),
    )

    # ── rail_station_management_groups ────────────────────────────────────
    op.create_table('rail_station_management_groups',
        sa.Column('id',                  sa.Integer(),    primary_key=True),
        sa.Column('managing_station_id', sa.Integer(),    sa.ForeignKey('rail_stations.id'), nullable=False),
        sa.Column('organization_id',     sa.Integer(),    sa.ForeignKey('organizations.id'), nullable=True),
        sa.Column('name',                sa.String(100),  nullable=True),
    )

    # ── rail_station_management_members ───────────────────────────────────
    op.create_table('rail_station_management_members',
        sa.Column('id',         sa.Integer(), primary_key=True),
        sa.Column('group_id',   sa.Integer(), sa.ForeignKey('rail_station_management_groups.id'), nullable=False),
        sa.Column('station_id', sa.Integer(), sa.ForeignKey('rail_stations.id'), nullable=False),
    )

    # ── rail_route_baseline_points (legacy alias) ─────────────────────────
    op.create_table('rail_route_baseline_points',
        sa.Column('id',                       sa.Integer(), primary_key=True),
        sa.Column('rail_route_id',            sa.Integer(), sa.ForeignKey('rail_routes.id'), nullable=True),
        sa.Column('kp',                       sa.Float(),   nullable=False),
        sa.Column('lat',                      sa.Float(),   nullable=True),
        sa.Column('lon',                      sa.Float(),   nullable=True),
        sa.Column('point_type',               sa.String(30), nullable=True),
        sa.Column('is_render_anchor',         sa.Boolean(), server_default='false'),
        sa.Column('is_interpolation_anchor',  sa.Boolean(), server_default='false'),
    )

    # ── organization_route_ranges ──────────────────────────────────────────
    op.create_table('organization_route_ranges',
        sa.Column('id',              sa.Integer(), primary_key=True),
        sa.Column('organization_id', sa.Integer(), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('rail_route_id',   sa.Integer(), sa.ForeignKey('rail_routes.id'), nullable=False),
        sa.Column('field',           sa.String(20), nullable=False, server_default='all'),
        sa.Column('start_km',        sa.Float(),    nullable=False),
        sa.Column('end_km',          sa.Float(),    nullable=False),
        sa.UniqueConstraint('organization_id', 'rail_route_id', 'field',
                            name='uq_org_railroute_field'),
    )

    # ── block_orders ───────────────────────────────────────────────────────
    op.create_table('block_orders',
        sa.Column('id',                         sa.Integer(),    primary_key=True),
        sa.Column('organization_id',            sa.Integer(),    sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('route_id',                   sa.Integer(),    sa.ForeignKey('routes.id'), nullable=True),
        sa.Column('rail_route_id',              sa.Integer(),    sa.ForeignKey('rail_routes.id'), nullable=True),
        sa.Column('tracks',                     sa.Text(),       nullable=False, server_default='["상선"]'),
        sa.Column('start_km',                   sa.Float(),      nullable=True),
        sa.Column('end_km',                     sa.Float(),      nullable=True),
        sa.Column('start_kp',                   sa.Float(),      nullable=True),
        sa.Column('end_kp',                     sa.Float(),      nullable=True),
        sa.Column('section_note',               sa.String(200),  nullable=True),
        sa.Column('start_facility_id',          sa.Integer(),    sa.ForeignKey('facilities.id'), nullable=True),
        sa.Column('end_facility_id',            sa.Integer(),    sa.ForeignKey('facilities.id'), nullable=True),
        sa.Column('start_rail_facility_id',     sa.Integer(),    sa.ForeignKey('rail_facilities.id'), nullable=True),
        sa.Column('end_rail_facility_id',       sa.Integer(),    sa.ForeignKey('rail_facilities.id'), nullable=True),
        sa.Column('work_date',                  sa.Date(),       nullable=False),
        sa.Column('start_time',                 sa.Time(),       nullable=False),
        sa.Column('end_time',                   sa.Time(),       nullable=False),
        sa.Column('field',                      sa.String(30),   nullable=False),
        sa.Column('block_type',                 sa.String(30),   nullable=False),
        sa.Column('work_type',                  sa.String(10),   nullable=True),
        sa.Column('has_equipment',              sa.Boolean(),    nullable=False, server_default='false'),
        sa.Column('has_labor',                  sa.Boolean(),    nullable=False, server_default='true'),
        sa.Column('implementer',                sa.String(20),   nullable=False, server_default='철도공사'),
        sa.Column('is_external',                sa.Boolean(),    nullable=False, server_default='false'),
        sa.Column('doc_no',                     sa.String(30),   nullable=True),
        sa.Column('dept_head',                  sa.String(50),   nullable=True),
        sa.Column('dept_head_phone',            sa.String(20),   nullable=True),
        sa.Column('work_supervisor',            sa.String(50),   nullable=False),
        sa.Column('work_supervisor_phone',      sa.String(20),   nullable=True),
        sa.Column('safety_manager',             sa.String(50),   nullable=False),
        sa.Column('safety_manager_phone',       sa.String(20),   nullable=True),
        sa.Column('electric_safety_manager',    sa.String(50),   nullable=True),
        sa.Column('electric_safety_manager_phone', sa.String(20), nullable=True),
        sa.Column('contractor',                 sa.String(100),  nullable=True),
        sa.Column('train_watcher',              sa.String(50),   nullable=True),
        sa.Column('train_watcher_phone',        sa.String(20),   nullable=True),
        sa.Column('reason',                     sa.Text(),       nullable=True),
        sa.Column('safety_items',               sa.Text(),       nullable=True),
        sa.Column('document_path',              sa.String(255),  nullable=True),
        sa.Column('track_name',                 sa.Text(),       nullable=True),
        sa.Column('danger_level',               sa.String(10),   nullable=True),
        sa.Column('note',                       sa.Text(),       nullable=True),
        sa.Column('created_by',                 sa.Integer(),    sa.ForeignKey('users.id'), nullable=False),
        # tc08 필드
        sa.Column('catenary_protection',        sa.String(20),   nullable=True),
        sa.Column('zep',                        sa.String(30),   nullable=True),
        sa.Column('zcp',                        sa.String(30),   nullable=True),
        sa.Column('cpt',                        sa.String(30),   nullable=True),
        sa.Column('tzep',                       sa.String(30),   nullable=True),
        sa.Column('worker_count',               sa.Integer(),    nullable=True),
        # tc09 필드
        sa.Column('parent_id',                  sa.Integer(),    nullable=True),
        sa.Column('equipment_name',             sa.String(100),  nullable=True),
        sa.Column('speed_restriction',          sa.Integer(),    nullable=True),
        sa.Column('speed_restriction_note',     sa.String(200),  nullable=True),
    )
    op.create_index('idx_bo_rail_route_kp', 'block_orders',
                    ['rail_route_id', 'start_kp', 'end_kp'])


def downgrade():
    op.drop_table('block_orders')
    op.drop_table('organization_route_ranges')
    op.drop_table('rail_route_baseline_points')
    op.drop_table('rail_station_management_members')
    op.drop_table('rail_station_management_groups')
    op.drop_table('rail_route_region_boundaries')
    op.drop_table('rail_facilities')
    op.drop_table('rail_facility_management_offices')
    op.drop_table('rail_facility_classifications')
    op.drop_table('rail_computed_geometry')
    op.drop_table('rail_baseline_points')
    op.drop_table('rail_route_station_points')
    op.drop_table('rail_stations')
    op.drop_table('rail_track_sections')
    op.drop_table('rail_routes')
    op.drop_table('system_settings')
    op.drop_table('facilities')
    op.drop_table('org_viewport')
    op.drop_table('users')
    op.drop_table('organizations')
    op.drop_table('routes')
