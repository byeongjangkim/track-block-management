import { api } from './client';
import type { LoginRequest, TokenResponse, UserInfo } from '../types';

export async function login(body: LoginRequest): Promise<TokenResponse> {
  const res = await api.post<TokenResponse>('/auth/login', body);
  return res.data;
}

export async function getMe(): Promise<UserInfo> {
  const res = await api.get<UserInfo>('/auth/me');
  return res.data;
}
