import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

/**
 * 메뉴 구조 (3개 그룹)
 *
 * [그룹 1] 조회·현황 — 모든 로그인 사용자
 *   노선도 | 차단현황도 | 차단명령 | 캘린더
 *
 * [그룹 2] 기준정보 관리 — org_admin 이상
 *   시설물 관리
 *
 * [그룹 3] 시스템 관리 — system_superuser 전용
 *   노선도 관리 | 사용자 관리
 */

const NAV_MAIN = [
  { to: '/block-map',    label: '차단현황도' },
  { to: '/block-orders', label: '차단명령' },
  { to: '/calendar',     label: '캘린더' },
];

const NAV_ADMIN = [
  { to: '/admin/facilities', label: '시설물 관리' },
];

const NAV_SUPERUSER = [
  { to: '/admin/route-geometry', label: '노선도 관리' },
  { to: '/admin/org-ranges',     label: '담당구역 관리' },
  { to: '/admin/users',          label: '사용자 관리' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, clearAuth } = useAuthStore();
  const navigate = useNavigate();

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  const isAdmin      = user?.role === 'org_admin' || user?.role === 'system_superuser';
  const isSuperuser  = user?.role === 'system_superuser';

  const activeClass  = 'bg-white text-blue-700 font-medium';
  const normalClass  = 'text-blue-100 hover:bg-blue-600';
  const adminNormal  = 'text-blue-200 hover:bg-blue-600';

  function navCls(isActive: boolean, isAdminMenu = false) {
    return `text-sm px-3 py-1 rounded transition-colors ${isActive ? activeClass : isAdminMenu ? adminNormal : normalClass}`;
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-blue-700 text-white flex items-center px-4 py-2 gap-4 shrink-0">
        <span className="font-bold text-sm whitespace-nowrap">선로차단작업 관리</span>

        <nav className="flex gap-1 flex-1 items-center flex-wrap">
          {/* 그룹 1 — 조회·현황 */}
          {NAV_MAIN.map(({ to, label }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => navCls(isActive)}>
              {label}
            </NavLink>
          ))}

          {/* 그룹 2 — 기준정보 관리 (org_admin+) */}
          {isAdmin && (
            <>
              <span className="text-blue-500 text-xs mx-1">|</span>
              {NAV_ADMIN.map(({ to, label }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) => navCls(isActive, true)}>
                  {label}
                </NavLink>
              ))}
            </>
          )}

          {/* 그룹 3 — 시스템 관리 (superuser) */}
          {isSuperuser && (
            <>
              {NAV_SUPERUSER.map(({ to, label }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) => navCls(isActive, true)}>
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="flex items-center gap-3 text-sm shrink-0">
          <span className="text-blue-100 text-xs">{user?.full_name ?? ''}</span>
          <button
            onClick={handleLogout}
            className="text-xs text-blue-200 hover:text-white border border-blue-500 px-2 py-1 rounded"
          >
            로그아웃
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
