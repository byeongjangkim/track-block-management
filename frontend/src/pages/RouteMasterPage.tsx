import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchReferenceRoutes,
  fetchReferenceSummary,
  type RailReferenceRoute,
} from '../api/railReference';

type StatusFilter = 'all' | 'active' | 'inactive';
type RenderFilter = 'all' | 'renderable' | 'check' | 'missing';

function formatKp(value: number | null) {
  return value == null ? '—' : value.toFixed(3);
}

function formatLength(value: number | null) {
  return value == null ? '—' : `${value.toFixed(3)} KP`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return value.slice(0, 10);
}

function gpsText(lat: number | null, lon: number | null) {
  if (lat == null || lon == null) return '—';
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

function renderStatus(route: RailReferenceRoute) {
  if (route.render_anchor_count >= 2) {
    return { label: '가능', cls: 'bg-green-100 text-green-700' };
  }
  if (route.baseline_point_count > 0) {
    return { label: '점검', cls: 'bg-orange-100 text-orange-700' };
  }
  return { label: '없음', cls: 'bg-gray-100 text-gray-500' };
}

function matchesRenderFilter(route: RailReferenceRoute, filter: RenderFilter) {
  if (filter === 'all') return true;
  if (filter === 'renderable') return route.render_anchor_count >= 2;
  if (filter === 'check') return route.baseline_point_count > 0 && route.render_anchor_count < 2;
  return route.baseline_point_count === 0;
}

function RouteDetail({ route }: { route: RailReferenceRoute | null }) {
  if (!route) {
    return (
      <aside className="border rounded-lg bg-white p-4 text-sm text-gray-400">
        노선을 선택하세요.
      </aside>
    );
  }

  const status = renderStatus(route);
  const rows = [
    ['노선ID', String(route.id)],
    ['노선코드', route.korail_route_code],
    ['노선명', route.name],
    ['노선구분', route.route_category ?? '—'],
    ['시점역', route.start_station_name ?? '—'],
    ['종점역', route.end_station_name ?? '—'],
    ['시점 GPS', gpsText(route.start_lat, route.start_lon)],
    ['종점 GPS', gpsText(route.end_lat, route.end_lon)],
    ['시작 KP', formatKp(route.start_kp)],
    ['종료 KP', formatKp(route.end_kp)],
    ['연장', formatLength(route.length_kp)],
    ['역/KP', `${route.station_point_count.toLocaleString()}개`],
    ['기준선', `${route.baseline_point_count.toLocaleString()}개`],
    ['렌더 앵커', `${route.render_anchor_count.toLocaleString()}개`],
    ['기준선 KP', `${formatKp(route.baseline_kp_min)} ~ ${formatKp(route.baseline_kp_max)}`],
    ['산정 기준', route.calculation_basis ?? '—'],
    ['원천 파일', route.source_file ?? '—'],
    ['등록일', formatDate(route.imported_at)],
  ];

  return (
    <aside className="border rounded-lg bg-white overflow-auto">
      <div className="p-4 border-b flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800">{route.name}</h2>
          <div className="text-xs text-gray-400 mt-1">{route.korail_route_code}</div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs ${status.cls}`}>
          렌더링 {status.label}
        </span>
      </div>
      <dl className="divide-y">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[88px_1fr] gap-3 px-4 py-2.5 text-sm">
            <dt className="text-gray-500">{label}</dt>
            <dd className="text-gray-800 break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

export default function RouteMasterPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [renderFilter, setRenderFilter] = useState<RenderFilter>('all');
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);

  const { data: routes = [], isLoading: routesLoading } = useQuery({
    queryKey: ['reference-routes'],
    queryFn: fetchReferenceRoutes,
  });

  const { data: summary } = useQuery({
    queryKey: ['reference-summary'],
    queryFn: fetchReferenceSummary,
  });

  const filteredRoutes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return routes.filter((route) => {
      const text = [
        route.id,
        route.korail_route_code,
        route.name,
        route.route_category,
        route.start_station_name,
        route.end_station_name,
      ]
        .filter((value) => value != null)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !keyword || text.includes(keyword);
      const matchesStatus =
        statusFilter === 'all'
        || (statusFilter === 'active' && route.is_active)
        || (statusFilter === 'inactive' && !route.is_active);

      return matchesSearch && matchesStatus && matchesRenderFilter(route, renderFilter);
    });
  }, [routes, search, statusFilter, renderFilter]);

  const selectedRoute =
    filteredRoutes.find((route) => route.id === selectedRouteId)
    ?? filteredRoutes[0]
    ?? null;

  const activeCount = routes.filter((route) => route.is_active).length;
  const renderableCount = routes.filter((route) => route.render_anchor_count >= 2).length;
  const stationMappedCount = routes.filter((route) => route.station_point_count > 0).length;

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-hidden">
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <h1 className="text-lg font-semibold text-gray-800">노선원장</h1>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="노선명, 코드, 시종점 검색"
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-60"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">전체 상태</option>
          <option value="active">사용</option>
          <option value="inactive">미사용</option>
        </select>
        <select
          value={renderFilter}
          onChange={(event) => setRenderFilter(event.target.value as RenderFilter)}
          className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">전체 렌더링</option>
          <option value="renderable">렌더링 가능</option>
          <option value="check">점검 필요</option>
          <option value="missing">기준선 없음</option>
        </select>
        <span className="text-sm text-gray-400">
          {routesLoading ? '조회 중...' : `표시 ${filteredRoutes.length.toLocaleString()}개 / 전체 ${routes.length.toLocaleString()}개`}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
        <div className="border rounded-lg px-4 py-3 bg-white">
          <div className="text-xs text-gray-500">노선원장</div>
          <div className="mt-1 text-xl font-semibold text-gray-800 tabular-nums">
            {(summary?.counts.rail_routes ?? routes.length).toLocaleString()}
          </div>
        </div>
        <div className="border rounded-lg px-4 py-3 bg-white">
          <div className="text-xs text-gray-500">사용 노선</div>
          <div className="mt-1 text-xl font-semibold text-gray-800 tabular-nums">
            {activeCount.toLocaleString()}
          </div>
        </div>
        <div className="border rounded-lg px-4 py-3 bg-white">
          <div className="text-xs text-gray-500">역/KP 연결</div>
          <div className="mt-1 text-xl font-semibold text-gray-800 tabular-nums">
            {stationMappedCount.toLocaleString()}
          </div>
        </div>
        <div className="border rounded-lg px-4 py-3 bg-white">
          <div className="text-xs text-gray-500">기준선 포인트</div>
          <div className="mt-1 text-xl font-semibold text-gray-800 tabular-nums">
            {(summary?.counts.rail_baseline_points ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="border rounded-lg px-4 py-3 bg-white">
          <div className="text-xs text-gray-500">렌더링 가능</div>
          <div className="mt-1 text-xl font-semibold text-gray-800 tabular-nums">
            {renderableCount.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4 flex-1 overflow-hidden">
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['ID', '노선코드', '노선명', '구분', '시점역', '종점역', 'KP 범위', '연장', '역/KP', '기준선', '렌더링', '상태'].map((header) => (
                  <th key={header} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {routesLoading && (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-gray-400">
                    조회 중...
                  </td>
                </tr>
              )}
              {!routesLoading && filteredRoutes.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-gray-400">
                    조회 결과가 없습니다.
                  </td>
                </tr>
              )}
              {!routesLoading && filteredRoutes.map((route) => {
                const status = renderStatus(route);
                const isSelected = selectedRoute?.id === route.id;
                return (
                  <tr
                    key={route.id}
                    onClick={() => setSelectedRouteId(route.id)}
                    className={`border-b cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
                  >
                    <td className="px-3 py-2.5 tabular-nums text-gray-500">{route.id}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-700 whitespace-nowrap">{route.korail_route_code}</td>
                    <td className="px-3 py-2.5 font-semibold text-gray-800 whitespace-nowrap">{route.name}</td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{route.route_category ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{route.start_station_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{route.end_station_name ?? '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-600 whitespace-nowrap">
                      {formatKp(route.start_kp)} ~ {formatKp(route.end_kp)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-500 whitespace-nowrap">{formatLength(route.length_kp)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-600">{route.station_point_count.toLocaleString()}</td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-600">{route.baseline_point_count.toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${status.cls}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {route.is_active ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">사용</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">미사용</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <RouteDetail route={selectedRoute} />
      </div>
    </div>
  );
}
