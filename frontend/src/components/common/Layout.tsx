import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

const NAV_MAIN = [
  { to: '/block-map',    label: '차단현황도' },
  { to: '/block-orders', label: '차단명령' },
  { to: '/calendar',     label: '캘린더' },
];

const NAV_ADMIN = [
  { to: '/admin/reference', label: '기준정보 관리' },
];

// 시스템 관리 서브메뉴
const NAV_SYSTEM = [
  { to: '/admin/users',    label: '사용자 관리' },
  { to: '/admin/settings', label: '시스템 설정' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const [sysMenuOpen, setSysMenuOpen] = useState(false);
  const sysMenuRef = useRef<HTMLDivElement>(null);

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sysMenuRef.current && !sysMenuRef.current.contains(e.target as Node)) {
        setSysMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isAdmin      = user?.role === 'org_admin' || user?.role === 'system_superuser';
  const isSuperuser  = user?.role === 'system_superuser';

  const activeClass  = 'bg-white text-blue-700 font-medium';
  const normalClass  = 'text-blue-100 hover:bg-blue-600';
  const adminNormal  = 'text-blue-200 hover:bg-blue-600';

  function navCls(isActive: boolean, isAdminMenu = false) {
    return `text-sm px-3 py-1 rounded transition-colors ${isActive ? activeClass : isAdminMenu ? adminNormal : normalClass}`;
  }

  // 현재 경로가 시스템 관리 서브메뉴에 포함되는지 확인
  const isSysMenuActive = NAV_SYSTEM.some(({ to }) => window.location.pathname.startsWith(to));

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

          {/* 그룹 3 — 시스템 관리 드롭다운 (superuser) */}
          {isSuperuser && (
            <>
              <span className="text-blue-500 text-xs mx-1">|</span>
              <div ref={sysMenuRef} className="relative">
                <button
                  onClick={() => setSysMenuOpen((v) => !v)}
                  className={`text-sm px-3 py-1 rounded transition-colors flex items-center gap-1 ${
                    isSysMenuActive ? activeClass : adminNormal
                  }`}
                >
                  시스템 관리
                  <span className="text-[10px]">{sysMenuOpen ? '▲' : '▼'}</span>
                </button>

                {sysMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50 min-w-[8rem]">
                    {NAV_SYSTEM.map(({ to, label }) => (
                      <NavLink
                        key={to}
                        to={to}
                        onClick={() => setSysMenuOpen(false)}
                        className={({ isActive }) =>
                          `block px-4 py-2 text-sm transition-colors ${
                            isActive
                              ? 'bg-blue-50 text-blue-700 font-medium'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`
                        }
                      >
                        {label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
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

      <main className="flex-1 overflow-hidden min-h-0">
        {children}
      </main>
    </div>
  );
}
