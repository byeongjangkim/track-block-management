import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/admin/reference/routes', label: '노선원장' },
  { to: '/admin/reference/stations-kp', label: '역/KP 관리' },
  { to: '/admin/reference/facilities', label: '시설물 관리' },
  { to: '/admin/reference/region-boundaries', label: '지역본부 경계/담당구역 관리' },
  { to: '/admin/reference/baseline-validation', label: '기준선/렌더링 관리' },
];

function tabClass(isActive: boolean) {
  return [
    'h-9 px-3 rounded-lg text-sm flex items-center transition-colors whitespace-nowrap',
    isActive
      ? 'bg-blue-600 text-white font-medium'
      : 'text-gray-600 hover:bg-gray-100',
  ].join(' ');
}

export default function ReferenceDataLayout() {
  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <div className="shrink-0 border-b bg-white px-6 py-3">
        <div className="flex items-center gap-3 overflow-x-auto">
          <h1 className="text-base font-semibold text-gray-800 shrink-0 mr-1">기준정보 관리</h1>
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => tabClass(isActive)}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
