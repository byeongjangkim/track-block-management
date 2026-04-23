import { api } from './client';
import type { FacilityResponse } from './adminTypes';

// ── SHP import 타입 ───────────────────────────────────────────────────────

export interface ShpRouteInfo {
  route_code: string;
  name_kr: string;
  shp_class: string;        // 고속철도 | 보통철도 | 도시철도
  record_count: number;     // SHP 레코드 수
  in_db: boolean;           // routes 테이블 등록 여부
  has_geometry: boolean;    // route_geometry 존재 여부
}

export interface ShpImportResult {
  route_code: string;
  status: string;           // '완료' | 'SHP에 데이터 없음' | '병합 실패'
  segments: number;
  total_pts: number;
}

export interface ShpImportResponse {
  ok: boolean;
  total: number;
  success: number;
  results: ShpImportResult[];
}

export type { FacilityResponse };

export async function fetchAdminFacilities(routeCode: string): Promise<FacilityResponse[]> {
  const res = await api.get<FacilityResponse[]>(`/admin/routes/${routeCode}/facilities`);
  return res.data;
}

export async function createFacility(
  routeCode: string,
  body: Omit<FacilityResponse, 'id' | 'route_id'>
): Promise<FacilityResponse> {
  const res = await api.post<FacilityResponse>(`/admin/routes/${routeCode}/facilities`, body);
  return res.data;
}

export async function updateFacility(
  id: number,
  body: Partial<Omit<FacilityResponse, 'id' | 'route_id'>>
): Promise<FacilityResponse> {
  const res = await api.put<FacilityResponse>(`/admin/facilities/${id}`, body);
  return res.data;
}

export async function deleteFacility(id: number): Promise<void> {
  await api.delete(`/admin/facilities/${id}`);
}

export async function uploadCsv(
  routeCode: string,
  file: File
): Promise<{
  route_code: string;
  row_count: number;
  errors: string[];
  anchor_count: number;
  facility_count: number;
  deployed: boolean;
}> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post(`/admin/routes/${routeCode}/upload-csv`, form);
  return res.data;
}

export async function deployRoute(routeCode: string): Promise<{
  ok: boolean;
  anchor_count: number;
  facility_count: number;
}> {
  const res = await api.post(`/admin/routes/${routeCode}/deploy`);
  return res.data;
}

export async function fetchShpRoutes(): Promise<{ shp_available: boolean; routes: ShpRouteInfo[] }> {
  const res = await api.get('/admin/shp/routes');
  return res.data;
}

export async function importShpRoutes(routeCodes: string[]): Promise<ShpImportResponse> {
  const res = await api.post<ShpImportResponse>('/admin/shp/import', { route_codes: routeCodes });
  return res.data;
}

export async function downloadCsvTemplate(routeCode: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
  const res = await fetch(`${base}/api/v1/admin/routes/${routeCode}/csv-template`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('템플릿 다운로드 실패');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${routeCode}_facilities.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 노선도 geometry 관리 ──────────────────────────────────────────────────

export interface GeometryStat {
  exists: boolean;
  segments: number;
  points: number;
  km_min: number | null;
  km_max: number | null;
}

export interface GeometryStatus {
  route_code: string;
  route_name: string;
  shp: GeometryStat;
  user: GeometryStat;
}

export interface GeometryPoint {
  id: number;
  segment: number;
  seq: number;
  lat: number;
  lon: number;
  km: number | null;
}

export interface GeometryPointsResponse {
  total: number;
  page: number;
  per_page: number;
  pages: number;
  items: GeometryPoint[];
}

export async function fetchGeometryStatus(): Promise<GeometryStatus[]> {
  const res = await api.get<GeometryStatus[]>('/admin/routes/geometry-status');
  return res.data;
}

async function _downloadFile(url: string, filename: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
  const res = await fetch(`${base}/api/v1${url}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`다운로드 실패: ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

/** 현재 USER geometry CSV 다운로드 */
export async function downloadGeometryUser(routeCode: string): Promise<void> {
  await _downloadFile(
    `/admin/routes/${routeCode}/geometry-download`,
    `${routeCode}_geometry.csv`,
  );
}

/** SHP 기반 km 추정값 포함 템플릿 다운로드 */
export async function downloadGeometryTemplate(routeCode: string): Promise<void> {
  await _downloadFile(
    `/admin/routes/${routeCode}/geometry-template`,
    `${routeCode}_geometry.csv`,
  );
}

/** geometry CSV 업로드 → user geometry 저장 */
export async function uploadGeometryCsv(
  routeCode: string,
  file: File,
): Promise<{ route_code: string; route_name: string; rows_saved: number; errors: string[] }> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post(`/admin/routes/${routeCode}/geometry-upload`, form);
  return res.data;
}

/** 포인트 목록 (페이지네이션) */
export async function fetchGeometryPoints(
  routeCode: string,
  page: number = 1,
  perPage: number = 100,
): Promise<GeometryPointsResponse> {
  const res = await api.get<GeometryPointsResponse>(
    `/admin/routes/${routeCode}/geometry-points`,
    { params: { page, per_page: perPage } },
  );
  return res.data;
}

/** 포인트 단건 추가 */
export async function createGeometryPoint(
  routeCode: string,
  body: { segment: number; lat: number; lon: number; km: number },
): Promise<GeometryPoint> {
  const res = await api.post<GeometryPoint>(`/admin/routes/${routeCode}/geometry-points`, body);
  return res.data;
}

/** 포인트 단건 수정 */
export async function updateGeometryPoint(
  routeCode: string,
  pointId: number,
  body: Partial<{ segment: number; lat: number; lon: number; km: number }>,
): Promise<GeometryPoint> {
  const res = await api.put<GeometryPoint>(`/admin/routes/${routeCode}/geometry-points/${pointId}`, body);
  return res.data;
}

/** 포인트 단건 삭제 */
export async function deleteGeometryPoint(routeCode: string, pointId: number): Promise<void> {
  await api.delete(`/admin/routes/${routeCode}/geometry-points/${pointId}`);
}

/** SHP 파일 업로드 → user geometry 저장 */
export async function importShpFile(
  routeCode: string,
  shpFile: File,
  dbfFile: File,
  prjFile?: File,
): Promise<{ route_code: string; route_name: string; rows_saved: number }> {
  const form = new FormData();
  form.append('shp_file', shpFile);
  form.append('dbf_file', dbfFile);
  if (prjFile) form.append('prj_file', prjFile);
  const res = await api.post(`/admin/routes/${routeCode}/import-shp`, form);
  return res.data;
}

