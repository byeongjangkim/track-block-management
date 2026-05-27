import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './store/authStore';
import { getMe } from './api/auth';
import Layout from './components/common/Layout';
import LoginPage from './pages/LoginPage';
import BlockMapPage from './pages/BlockMapPage';
import CalendarPage from './pages/CalendarPage';
import BlockOrdersPage from './pages/BlockOrdersPage';
import FacilitiesAdminPage from './pages/FacilitiesAdminPage';
import UsersAdminPage from './pages/UsersAdminPage';
import OrgRangesAdminPage from './pages/OrgRangesAdminPage';
import ReferenceDataLayout from './pages/ReferenceDataLayout';
import RouteMasterPage from './pages/RouteMasterPage';
import StationKpAdminPage from './pages/StationKpAdminPage';
import BaselineValidationPage from './pages/BaselineValidationPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// 페이지 새로고침 시 token은 있지만 user가 없는 경우 /auth/me로 복원
function AuthHydrator() {
  const { token, user, setAuth, clearAuth } = useAuthStore();
  useEffect(() => {
    if (token && !user) {
      getMe()
        .then((me) => setAuth(token, me))
        .catch(() => clearAuth());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthHydrator />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* 조회·현황 (모든 로그인 사용자) */}
          <Route path="/block-map" element={<RequireAuth><BlockMapPage /></RequireAuth>} />
          {/* 구 노선도 경로 → 차단현황도로 리다이렉트 */}
          <Route path="/map" element={<Navigate to="/block-map" replace />} />
          <Route path="/block-orders" element={<RequireAuth><BlockOrdersPage /></RequireAuth>} />
          <Route path="/calendar" element={<RequireAuth><CalendarPage /></RequireAuth>} />

          {/* 기준정보 관리 (org_admin+) */}
          <Route path="/admin/reference" element={<RequireAuth><ReferenceDataLayout /></RequireAuth>}>
            <Route index element={<Navigate to="routes" replace />} />
            <Route path="routes" element={<RouteMasterPage />} />
            <Route path="stations-kp" element={<StationKpAdminPage />} />
            <Route path="facilities" element={<FacilitiesAdminPage />} />
            <Route path="region-boundaries" element={<OrgRangesAdminPage />} />
            <Route path="baseline-validation" element={<BaselineValidationPage />} />
          </Route>

          {/* 시스템 관리 (superuser) */}
          <Route path="/admin/users" element={<RequireAuth><UsersAdminPage /></RequireAuth>} />

          {/* 구 경로 → 기준정보 관리로 리다이렉트 */}
          <Route path="/admin/facilities" element={<Navigate to="/admin/reference/facilities" replace />} />
          <Route path="/admin/route-geometry" element={<Navigate to="/admin/reference/routes" replace />} />
          <Route path="/admin/org-ranges" element={<Navigate to="/admin/reference/region-boundaries" replace />} />
          <Route path="/admin/shp-import" element={<Navigate to="/admin/reference/routes" replace />} />

          <Route path="*" element={<Navigate to="/block-map" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
