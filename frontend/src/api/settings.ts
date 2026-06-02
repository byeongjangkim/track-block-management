import { api } from './client';

export interface SettingItem {
  key:           string;
  value:         string;   // 현재 값 (#RRGGBB)
  default_value: string;   // 기본값
  label:         string;
  description:   string | null;
  sort_order:    number;
  updated_at:    string | null;
}

// 카테고리별 설정 그룹
export interface AllSettings {
  route_colors?:    SettingItem[];
  block_colors?:    SettingItem[];
  danger_colors?:   SettingItem[];
  facility_colors?: SettingItem[];
  map_settings?:    SettingItem[];
}

export async function fetchAllSettings(): Promise<AllSettings> {
  const res = await api.get<AllSettings>('/settings');
  return res.data;
}

export async function updateSetting(category: string, key: string, value: string): Promise<SettingItem> {
  const res = await api.patch<SettingItem>(`/settings/${category}/${key}`, { value });
  return res.data;
}

export async function resetSetting(category: string, key: string): Promise<{ ok: boolean; message: string }> {
  const res = await api.post(`/settings/${category}/${key}/reset`);
  return res.data;
}

export async function resetAllSettings(): Promise<{ ok: boolean; message: string }> {
  const res = await api.post('/settings/reset-all');
  return res.data;
}
