import { api } from './client';

export interface RouteFeature {
  type: 'Feature';
  // segment: linemerge 결과 조각 — 노선당 여러 개일 수 있음
  // source: 'shp' = 국가기본도 참조 (점선), 'user' = 관리자 업로드 (실선)
  properties: { route_code: string; source: string; segment: number; point_count: number };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface RouteFeatureCollection {
  type: 'FeatureCollection';
  features: RouteFeature[];
}

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

export async function fetchAllGeometry(): Promise<RouteFeatureCollection> {
  const res = await api.get<RouteFeatureCollection>('/map/routes/all/geometry');
  return res.data;
}

export async function fetchRouteGeometry(code: string): Promise<RouteFeature> {
  const res = await api.get<RouteFeature>(`/map/routes/${code}/geometry`);
  return res.data;
}

export async function fetchOrgBoundaries(orgId: number): Promise<OrgBoundaryCollection> {
  const res = await api.get<OrgBoundaryCollection>(`/map/organizations/${orgId}/boundaries`);
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
  type: 'STATION' | 'GENERAL_STATION' | 'TUNNEL' | 'BRIDGE' | 'OVERPASS' | 'CROSSING' | 'SUBSTATION' | 'JUNCTION';
  name: string;
  km: number;
  km_end: number | null;
  direction: string | null;
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

export async function fetchRouteFacilities(routeCode: string): Promise<FacilityCollection> {
  const res = await api.get<FacilityCollection>(`/map/routes/${routeCode}/facilities`);
  return res.data;
}

// ── 차단명령 구간 GeoJSON ──────────────────────────────────────────────────

export interface BlockSegmentProps {
  id: number;
  route_id: number;
  route_code: string;
  route_name: string;
  direction: 'UP' | 'DOWN';
  section_type: 'normal' | 'power_cut';
  start_km: number | null;
  end_km: number | null;
  section_note: string | null;
  display_km: string;
  work_date: string;
  start_time: string;
  end_time: string;
  field: string;
  block_type: string;
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
}): Promise<BlockSegmentCollection> {
  const res = await api.get<BlockSegmentCollection>('/map/block-orders/segments', { params });
  return res.data;
}
