import { api } from './client';

export interface Organization {
  id: number;
  code: string;
  name: string;
  org_type: 'regional' | 'special';
  is_active: boolean;
}

export interface RouteRange {
  id: number;
  organization_id: number;
  rail_route_id: number;
  route_code: string;
  route_name: string;
  field: string;
  start_km: number;
  end_km: number;
}

export async function fetchOrganizations(): Promise<Organization[]> {
  const res = await api.get<Organization[]>('/organizations');
  return res.data;
}

export async function fetchRouteRanges(orgId: number): Promise<RouteRange[]> {
  const res = await api.get<RouteRange[]>(`/organizations/${orgId}/route-ranges`);
  return res.data;
}

export interface RouteRangeBody {
  rail_route_id: number;
  field: string;
  start_km: number;
  end_km: number;
}

export async function createRouteRange(orgId: number, body: RouteRangeBody): Promise<RouteRange> {
  const res = await api.post<RouteRange>(`/organizations/${orgId}/route-ranges`, body);
  return res.data;
}

export async function updateRouteRange(
  orgId: number,
  rangeId: number,
  body: Partial<RouteRangeBody>,
): Promise<RouteRange> {
  const res = await api.put<RouteRange>(`/organizations/${orgId}/route-ranges/${rangeId}`, body);
  return res.data;
}

export async function deleteRouteRange(orgId: number, rangeId: number): Promise<void> {
  await api.delete(`/organizations/${orgId}/route-ranges/${rangeId}`);
}
