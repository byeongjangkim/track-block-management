import { api } from './client';
import type { FacilityResponse } from './adminTypes';

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


