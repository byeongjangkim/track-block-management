import { api } from './client';

export interface OrgBoundaryFeature {
  type: 'Feature';
  properties: {
    organization_id: number;
    organization_name: string;
    route_code: string;
    route_name: string;
    field: string;
    start_km: number;
    end_km: number;
  };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface OrgBoundaryCollection {
  type: 'FeatureCollection';
  features: OrgBoundaryFeature[];
}

// ── rail_computed_geometry 기반 노선 (line_type 포함) ────────────────────

export interface TrackSection {
  start_kp:     number;
  end_kp:       number;
  track_count:  number;   // 1=단선 | 2=복선 | 4=복복선 | 6=삼복선
  has_catenary: boolean;
  note:         string | null;
}

export interface RailRouteFeature {
  type: 'Feature';
  properties: {
    rail_route_id:          number;
    korail_route_code:      string;
    route_name:             string;
    line_type:              '고속선' | '일반선';
    default_track_count:    number;   // 노선 기본 선로 수
    default_has_catenary:   boolean;  // 노선 기본 전차선 유무
    track_sections:         TrackSection[];  // KP 구간별 예외
    lod:                    string;
    point_count:            number;
  };
  // 세 번째 좌표 = KP (GeoJSON 3D 확장)
  geometry: { type: 'LineString'; coordinates: [number, number, number][] };
}

export interface RailRouteFeatureCollection {
  type: 'FeatureCollection';
  features: RailRouteFeature[];
}

// ── 기지 노선 목록 ────────────────────────────────────────────────────────

export interface DepotRoute {
  id: number;
  name: string;
  korail_route_code: string;
  start_kp: number | null;
  end_kp: number | null;
  route_category: string | null;  // '차량기지' | '보수기지' | '전기기지'
}

export async function fetchDepotRoutes(): Promise<DepotRoute[]> {
  const res = await api.get<DepotRoute[]>('/map/rail-routes/depots');
  return res.data;
}

export interface RailSubstation {
  id: number;
  name: string;
  kp: number;
  detail_category: string | null;  // 'SS' | 'SP' | 'SSP' | 'PP' | 'ATP' 등
  lat: number | null;
  lon: number | null;
}

export async function fetchRailSubstations(params: {
  route_id?: number;
  rail_route_id?: number;
}): Promise<RailSubstation[]> {
  const res = await api.get<RailSubstation[]>('/map/rail-routes/substations', { params });
  return res.data;
}

export async function fetchAllRailRouteGeometry(
  lod = 'high',
  stationMode: 'center_only' | 'all_points' = 'center_only',
): Promise<RailRouteFeatureCollection> {
  const res = await api.get<RailRouteFeatureCollection>('/map/rail-routes/all/geometry', {
    params: { lod, station_mode: stationMode },
  });
  return res.data;
}

export async function fetchAllRailStations(): Promise<FacilityCollection> {
  const res = await api.get<FacilityCollection>('/map/rail-routes/all/stations');
  return res.data;
}

export async function fetchAllRailFacilities(): Promise<FacilityCollection> {
  const res = await api.get<FacilityCollection>('/map/rail-routes/all/facility-items');
  return res.data;
}

export async function fetchOrgBoundaries(orgId: number): Promise<OrgBoundaryCollection> {
  const res = await api.get<OrgBoundaryCollection>(`/map/organizations/${orgId}/boundaries`);
  return res.data;
}

export interface RailRegionBoundaryFeature {
  type: 'Feature';
  properties: {
    id: number;
    organization_id: number;
    organization_name: string;
    rail_route_id: number;
    route_code: string;
    route_name: string;
    boundary_type: string;
    start_kp: number;
    end_kp: number;
    source_type: string | null;
    source_id: number | null;
  };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface RailRegionBoundaryCollection {
  type: 'FeatureCollection';
  features: RailRegionBoundaryFeature[];
}

export async function fetchRailRouteRegionBoundaries(params?: {
  rail_route_id?: number;
  organization_id?: number;
}): Promise<RailRegionBoundaryCollection> {
  const res = await api.get<RailRegionBoundaryCollection>('/map/rail-route-region-boundaries', { params });
  return res.data;
}

export interface OrgViewport {
  organization_id: number;
  organization_name: string;
  center_lat: number;
  center_lon: number;
  zoom_level: number;
}

export async function fetchOrgViewport(orgId: number): Promise<OrgViewport> {
  const res = await api.get<OrgViewport>(`/map/organizations/${orgId}/viewport`);
  return res.data;
}

// ── 시설물 GeoJSON ────────────────────────────────────────────────────────

export interface FacilityFeatureProps {
  id: number;
  type: '역' | '변전소' | '구조물' | '소속경계';
  station_type: string | null;  // 역: 관리역/보통역/무인역/신호장/신호소 | 변전소: ss/sp/ssp/atp/pp | 구조물: 터널/교량/과선교/건널목/분기
  name: string;
  km: number;
  km_end: number | null;
  direction: string | null;
  bore_type: string;           // 복선 | 단선_상선 | 단선_하선 (터널·교량 선로 적용 방식)
  has_station_map: boolean;
  note: string | null;
  route_code: string;
  route_name: string;
}

export interface FacilityFeature {
  type: 'Feature';
  properties: FacilityFeatureProps;
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: [number, number][] };
}

export interface FacilityCollection {
  type: 'FeatureCollection';
  features: FacilityFeature[];
}

// ── 차단명령 구간 GeoJSON ──────────────────────────────────────────────────

export interface BlockSegmentProps {
  id: number;
  route_id: number | null;
  rail_route_id: number | null;
  route_code: string | null;
  route_name: string | null;
  track: string;              // 차단 선로 이름: 상선|하선|상1|상2|상3|하1|하2|하3
  route_track_count: number;  // 노선 선로 수 (물리적 위치 계산용)
  section_type: 'normal' | 'power_cut';
  start_km: number | null;
  end_km: number | null;
  start_kp: number | null;
  end_kp: number | null;
  section_note: string | null;
  display_km: string;
  work_date: string;
  start_time: string;
  end_time: string;
  field: string;
  block_type: string;
  work_type: string | null;      // 인력 | 장비 | 기계
  implementer: string;           // 철도공사 | 철도공단 | 외부
  danger_level: string | null;   // 'A'(위험) / 'B'(주의) / 'C'(일반) / null
  organization_id: number | null;
}

export interface BlockSegmentFeature {
  type: 'Feature';
  properties: BlockSegmentProps;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface BlockSegmentCollection {
  type: 'FeatureCollection';
  features: BlockSegmentFeature[];
  work_date: string;
}

export async function fetchBlockSegments(params?: {
  work_date?: string;
  route_id?: number;
  rail_route_id?: number;
}): Promise<BlockSegmentCollection> {
  const res = await api.get<BlockSegmentCollection>('/map/block-orders/segments', { params });
  return res.data;
}

// ── 시군구 배경 지도 ──────────────────────────────────────────────────────────

export interface SigungFeature {
  type: 'Feature';
  properties: {
    sig_cd: string;
    name: string;
    full_name: string;
    admin_level: number;   // 1=시도, 2=시군구
    centroid: [number, number];
  };
  geometry:
    | { type: 'Polygon'; coordinates: [number, number][][] }
    | { type: 'MultiPolygon'; coordinates: [number, number][][][] };
}

export interface SigungCollection {
  type: 'FeatureCollection';
  features: SigungFeature[];
}

export async function fetchSigungu(level: 1 | 2 = 2): Promise<SigungCollection> {
  const res = await api.get<SigungCollection>('/map/sigungu', { params: { level } });
  return res.data;
}
