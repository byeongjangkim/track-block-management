import { api } from './client';

export interface UserRecord {
  id: number;
  username: string;
  full_name: string;
  role: string;
  field: string | null;
  organization_id: number | null;
  organization_name: string | null;
  is_active: boolean;
  can_register: boolean;
}

export interface UserCreate {
  username: string;
  password: string;
  full_name: string;
  role: string;
  field: string | null;
  organization_id: number | null;
  can_register?: boolean;
}

export interface UserUpdate {
  full_name?: string;
  role?: string;
  field?: string | null;
  organization_id?: number | null;
  password?: string;
  is_active?: boolean;
  can_register?: boolean;
}

export async function fetchUsers(): Promise<UserRecord[]> {
  const res = await api.get<UserRecord[]>('/users');
  return res.data;
}

export async function createUser(body: UserCreate): Promise<UserRecord> {
  const res = await api.post<UserRecord>('/users', body);
  return res.data;
}

export async function updateUser(id: number, body: UserUpdate): Promise<UserRecord> {
  const res = await api.put<UserRecord>(`/users/${id}`, body);
  return res.data;
}

export async function deactivateUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}
