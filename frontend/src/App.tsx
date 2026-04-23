import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './store/authStore';
import Layout from './components/common/Layout';
import LoginPage from './pages/LoginPage';
import BlockMapPage from './pages/BlockMapPage';
import CalendarPage from './pages/CalendarPage';
import BlockOrdersPage from './pages/BlockOrdersPage';
import FacilitiesAdminPage from './pages/FacilitiesAdminPage';
import UsersAdminPage from './pages/UsersAdminPage';
import RouteGeometryPage from './pages/RouteGeometryPage';
import OrgRangesAdminPage from './pages/OrgRangesAdminPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
          <Route path="/admin/facilities" element={<RequireAuth><FacilitiesAdminPage /></RequireAuth>} />

          {/* 시스템 관리 (superuser) */}
          <Route path="/admin/route-geometry" element={<RequireAuth><RouteGeometryPage /></RequireAuth>} />
          <Route path="/admin/org-ranges" element={<RequireAuth><OrgRangesAdminPage /></RequireAuth>} />
          <Route path="/admin/users" element={<RequireAuth><UsersAdminPage /></RequireAuth>} />

          {/* 구 경로 → 노선도 관리로 리다이렉트 (SHP import가 노선도 관리에 통합됨) */}
          <Route path="/admin/shp-import" element={<Navigate to="/admin/route-geometry" replace />} />

          <Route path="*" element={<Navigate to="/block-map" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
