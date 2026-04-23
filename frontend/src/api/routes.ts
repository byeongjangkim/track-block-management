import { api } from './client';
import type { Route } from '../types';

export async function fetchRoutes(): Promise<Route[]> {
  const res = await api.get<Route[]>('/routes');
  return res.data;
}
