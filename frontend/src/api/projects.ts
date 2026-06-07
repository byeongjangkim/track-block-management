import { api } from './client';
import type { Project, ProjectCreate } from '../types';

export async function fetchProjects(params?: {
  organization_id?: number;
  status?: string;
  project_type?: string;
  name?: string;
}): Promise<Project[]> {
  const res = await api.get('/projects', { params });
  return res.data;
}

export async function createProject(body: ProjectCreate): Promise<Project> {
  const res = await api.post('/projects', body);
  return res.data;
}

export async function updateProject(id: number, body: Partial<ProjectCreate>): Promise<Project> {
  const res = await api.patch(`/projects/${id}`, body);
  return res.data;
}

export async function deleteProject(id: number): Promise<void> {
  await api.delete(`/projects/${id}`);
}

/** PDF 파싱된 관련사업명으로 기존 프로젝트 조회 (자동 연결용) */
export async function lookupProjectByName(name: string): Promise<Project | null> {
  const res = await api.get('/projects/lookup/by-name', { params: { name } });
  return res.data ?? null;
}
