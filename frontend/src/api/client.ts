import axios from 'axios';

const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_ORIGIN}${normalized}`;
}

export const api = axios.create({
  baseURL: apiUrl('/api/v1'),
});

// 요청마다 Authorization 헤더 자동 추가
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 401 응답 시 로그인 페이지로 리다이렉트
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('access_token');
      // BASE_URL: 개발='/', 프로덕션 경로 배포 시='/track/' 등 Vite가 자동 주입
      window.location.href = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') + '/login';
    }
    return Promise.reject(err);
  }
);
