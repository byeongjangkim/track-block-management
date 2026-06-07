import { api } from './client';

export interface ReferenceCounts {
  rail_routes: number;
  rail_stations: number;
  rail_route_station_points: number;
  rail_baseline_points: number;
  rail_facilities: number;
  rail_facility_classifications: number;
  rail_route_region_boundaries: number;
}

export interface BaselineTypeSummary {
  point_type: string;
  total: number;
  render_anchor_count: number;
  interpolation_anchor_count: number;
}

export interface ReferenceQuality {
  routes_with_station_points: number;
  routes_with_baseline: number;
  routes_renderable: number;
  station_points_with_center_kp: number;
  station_points_missing_center_kp: number;
  station_points_with_gps: number;
  station_points_missing_gps: number;
}

export interface ReferenceSummary {
  counts: ReferenceCounts;
  baseline_by_type: BaselineTypeSummary[];
  quality: ReferenceQuality;
}

export interface RailReferenceRoute {
  id: number;
  korail_route_code: string;
  name: string;
  line_type: string;
  route_category: string | null;
  start_station_name: string | null;
  end_station_name: string | null;
  start_lat: number | null;
  start_lon: number | null;
  end_lat: number | null;
  end_lon: number | null;
  start_kp: number | null;
  end_kp: number | null;
  length_kp: number | null;
  calculation_basis: string | null;
  is_active: boolean;
  source_file: string | null;
  imported_at: string;
  station_point_count: number;
  baseline_point_count: number;
  render_anchor_count: number;
  baseline_kp_min: number | null;
  baseline_kp_max: number | null;
  default_track_count: number;
  default_has_catenary: boolean;
}

// ── 선로 구성·전차선 관련 타입 ──────────────────────────────────────────────

export interface TrackSection {
  id: number;
  rail_route_id: number;
  start_kp: number;
  end_kp: number;
  track_count: number;    // 1=단선 | 2=복선 | 4=복복선 | 6=삼복선
  has_catenary: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackSectionInput {
  start_kp: number;
  end_kp: number;
  track_count: number;
  has_catenary: boolean;
  note?: string | null;
}

export interface RouteDefaultsInput {
  default_track_count?: number;
  default_has_catenary?: boolean;
}

export async function fetchTrackSections(routeId: number): Promise<TrackSection[]> {
  const res = await api.get<TrackSection[]>(`/rail-reference/routes/${routeId}/track-sections`);
  return res.data;
}

export async function createTrackSection(routeId: number, data: TrackSectionInput): Promise<TrackSection> {
  const res = await api.post<TrackSection>(`/rail-reference/routes/${routeId}/track-sections`, data);
  return res.data;
}

export async function updateTrackSection(sectionId: number, data: Partial<TrackSectionInput>): Promise<TrackSection> {
  const res = await api.put<TrackSection>(`/rail-reference/track-sections/${sectionId}`, data);
  return res.data;
}

export async function deleteTrackSection(sectionId: number): Promise<void> {
  await api.delete(`/rail-reference/track-sections/${sectionId}`);
}

export async function updateRouteDefaults(routeId: number, data: RouteDefaultsInput): Promise<void> {
  await api.patch(`/rail-reference/routes/${routeId}/defaults`, data);
}

export interface RailRouteStationPoint {
  id: number;
  route_sequence_no: number | null;
  center_kp: number | null;
  yard_start_kp: number | null;
  yard_end_kp: number | null;
  regional_org: string | null;
  is_baseline_anchor: boolean;
  match_note: string | null;
  station_code: string;
  station_name: string;
  lat: number | null;
  lon: number | null;
  station_role: string | null;
  station_type: string | null;
}

export interface RailFacilityClassification {
  id: number;
  code: string;
  major_category: string;
  sub_category: string;
  detail_category: string | null;
  tertiary_category: string | null;
  geometry_type: 'point' | 'linear' | string;
  sort_order: number;
  is_active: boolean;
}

export interface RailFacility {
  id: number;
  rail_route_id: number;
  rail_route_name: string;
  korail_route_code: string;
  facility_code: string | null;
  name: string;
  classification_id: number;
  classification_code: string;
  major_category: string;
  sub_category: string;
  detail_category: string | null;
  tertiary_category: string | null;
  geometry_type: 'point' | 'linear' | string;
  kp_start: number;
  kp_end: number | null;
  lat: number | null;
  lon: number | null;
  lat_end: number | null;
  lon_end: number | null;
  direction: string | null;
  section_from: string | null;
  section_to: string | null;
  address: string | null;
  road_width_m: number | null;
  is_paved: boolean | null;
  bus_accessible: boolean | null;
  entrance_passage_type: string | null;
  entrance_lock_type: string | null;
  nearest_station_id: number | null;
  nearest_station_name: string | null;
  management_office_id: number | null;
  management_office_name: string | null;
  bore_type: string;           // 복선 | 단선_상선 | 단선_하선
  use_as_baseline_anchor: boolean;
  is_active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface RailFacilityInput {
  facility_code?: string | null;
  name: string;
  classification_id: number;
  kp_start: number;
  kp_end?: number | null;
  lat?: number | null;
  lon?: number | null;
  lat_end?: number | null;
  lon_end?: number | null;
  direction?: string | null;
  section_from?: string | null;
  section_to?: string | null;
  address?: string | null;
  road_width_m?: number | null;
  is_paved?: boolean | null;
  bus_accessible?: boolean | null;
  entrance_passage_type?: string | null;
  entrance_lock_type?: string | null;
  nearest_station_id?: number | null;
  management_office_id?: number | null;
  bore_type?: string;
  use_as_baseline_anchor?: boolean;
  is_active?: boolean;
  note?: string | null;
}

// ── 노선별 역/KP·시설물 집계 (목록 화면용) ────────────────────────────────
export interface RouteListSummary {
  id: number;
  korail_route_code: string;
  name: string;
  line_type: string;
  start_station_name: string | null;
  end_station_name: string | null;
  start_kp: number | null;
  end_kp: number | null;
  is_active: boolean;
  default_track_count: number;
  // 역/KP
  station_total: number;
  station_gps: number;
  station_error: number;
  // 시설물
  facility_total: number;
  facility_gps: number;
}

export async function fetchRouteSummaries(): Promise<RouteListSummary[]> {
  const res = await api.get<RouteListSummary[]>('/rail-reference/routes/route-summaries');
  return res.data;
}

export async function fetchReferenceSummary(): Promise<ReferenceSummary> {
  const res = await api.get<ReferenceSummary>('/rail-reference/summary');
  return res.data;
}

export async function fetchReferenceRoutes(): Promise<RailReferenceRoute[]> {
  const res = await api.get<RailReferenceRoute[]>('/rail-reference/routes');
  return res.data;
}

export async function fetchRouteStationPoints(
  railRouteId: number,
): Promise<RailRouteStationPoint[]> {
  const res = await api.get<RailRouteStationPoint[]>(
    `/rail-reference/routes/${railRouteId}/station-points`,
  );
  return res.data;
}

export interface StationPointUpdateBody {
  center_kp?: number | null;
  yard_start_kp?: number | null;
  yard_end_kp?: number | null;
  is_baseline_anchor?: boolean;
  lat?: number | null;
  lon?: number | null;
  station_role?: string | null;
  station_type?: string | null;
}

export async function updateStationPoint(
  pointId: number,
  body: StationPointUpdateBody,
): Promise<RailRouteStationPoint> {
  const res = await api.patch<RailRouteStationPoint>(
    `/rail-reference/station-points/${pointId}`,
    body,
  );
  return res.data;
}

export async function fetchFacilityClassifications(): Promise<RailFacilityClassification[]> {
  const res = await api.get<RailFacilityClassification[]>('/rail-reference/facility-classifications');
  return res.data;
}

export async function fetchRailFacilities(railRouteId: number): Promise<RailFacility[]> {
  const res = await api.get<RailFacility[]>(`/rail-reference/routes/${railRouteId}/facilities`);
  return res.data;
}

export async function createRailFacility(
  railRouteId: number,
  body: RailFacilityInput,
): Promise<RailFacility> {
  const res = await api.post<RailFacility>(`/rail-reference/routes/${railRouteId}/facilities`, body);
  return res.data;
}

export async function updateRailFacility(
  facilityId: number,
  body: Partial<RailFacilityInput>,
): Promise<RailFacility> {
  const res = await api.put<RailFacility>(`/rail-reference/facilities/${facilityId}`, body);
  return res.data;
}

export async function deleteRailFacility(facilityId: number): Promise<void> {
  await api.delete(`/rail-reference/facilities/${facilityId}`);
}

export async function downloadFacilityTemplate(railRouteId: number): Promise<Blob> {
  const res = await api.get(`/rail-reference/routes/${railRouteId}/facilities/template`, {
    responseType: 'blob',
  });
  return res.data;
}

export interface BulkUploadResult {
  success: number;
  errors: string[];
}

export async function bulkUploadFacilities(
  railRouteId: number,
  file: File,
): Promise<BulkUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post<BulkUploadResult>(
    `/rail-reference/routes/${railRouteId}/facilities/bulk`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data;
}
