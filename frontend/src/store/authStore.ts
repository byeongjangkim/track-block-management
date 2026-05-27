import { create } from 'zustand';
import type { UserInfo } from '../types';

interface AuthState {
  user: UserInfo | null;
  token: string | null;
  setAuth: (token: string, user: UserInfo) => void;
  clearAuth: () => void;
}

function loadUser(): UserInfo | null {
  try {
    const s = localStorage.getItem('auth_user');
    return s ? (JSON.parse(s) as UserInfo) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: loadUser(),
  token: localStorage.getItem('access_token'),

  setAuth: (token, user) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
    set({ token, user });
  },

  clearAuth: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('auth_user');
    set({ token: null, user: null });
  },
}));
