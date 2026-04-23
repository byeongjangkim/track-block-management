import { api } from './client';
import type { Facility } from '../types';

export async function fetchFacilities(params?: {
  route_id?: number;
  type?: string;
}): Promise<Facility[]> {
  const res = await api.get<Facility[]>('/facilities', { params });
  return res.data;
}
