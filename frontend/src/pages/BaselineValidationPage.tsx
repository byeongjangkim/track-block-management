import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchReferenceRoutes,
  fetchReferenceSummary,
  type RailReferenceRoute,
} from '../api/railReference';

function formatNumber(value: number | null | undefined) {
  return value == null ? '—' : value.toLocaleString();
}

function formatKp(value: number | null) {
  return value == null ? '—' : value.toFixed(3);
}

function renderStatus(route: RailReferenceRoute) {
  if (route.render_anchor_count >= 2) {
    return { label: '렌더링 가능', cls: 'bg-green-100 text-green-700' };
  }
  if (route.baseline_point_count > 0) {
    return { label: '점검 필요', cls: 'bg-orange-100 text-orange-700' };
  }
  return { label: '기준선 없음', cls: 'bg-gray-100 text-gray-500' };
}

export default function BaselineValidationPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['reference-summary'],
    queryFn: fetchReferenceSummary,
  });

  const { data: routes = [], isLoading: routesLoading } = useQuery({
    queryKey: ['reference-routes'],
    queryFn: fetchReferenceRoutes,
  });

  const sortedRoutes = useMemo(
    () => [...routes].sort((a, b) => {
      const aRenderable = a.render_anchor_count >= 2 ? 1 : 0;
      const bRenderable = b.render_anchor_count >= 2 ? 1 : 0;
      return aRenderable - bRenderable || a.name.localeCompare(b.name, 'ko');
    }),
    [routes],
  );

  const cards = [
    { label: '노선원장', value: summary?.counts.rail_routes },
    { label: '역 원장', value: summary?.counts.rail_stations },
    { label: '노선별 역/KP', value: summary?.counts.rail_route_station_points },
    { label: '기준선 포인트', value: summary?.counts.rail_baseline_points },
    { label: '렌더링 가능 노선', value: summary?.quality.routes_renderable },
  ];

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-hidden">
      <div className="flex items-center gap-3 shrink-0">
        <h1 className="text-lg font-semibold text-gray-800">기준선/렌더링 관리</h1>
        <span className="text-sm text-gray-400">
          {summaryLoading || routesLoading ? '조회 중...' : `전체 ${routes.length}개 노선`}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
        {cards.map((card) => (
          <div key={card.label} className="border rounded-lg px-4 py-3 bg-white">
            <div className="text-xs text-gray-500">{card.label}</div>
            <div className="mt-1 text-xl font-semibold text-gray-800 tabular-nums">
              {formatNumber(card.value)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4 flex-1 overflow-hidden">
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['포인트 유형', '전체', '렌더', '보간'].map((header) => (
                  <th key={header} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(summary?.baseline_by_type ?? []).map((row) => (
                <tr key={row.point_type} className="border-b">
                  <td className="px-3 py-2.5 font-medium text-gray-700">{row.point_type}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-600">{formatNumber(row.total)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-600">{formatNumber(row.render_anchor_count)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-600">{formatNumber(row.interpolation_anchor_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['상태', '노선명', '역/KP', '기준선', '렌더 앵커', '기준선 KP 범위', '노선 KP 범위'].map((header) => (
                  <th key={header} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRoutes.map((route) => {
                const status = renderStatus(route);
                return (
                  <tr key={route.id} className="border-b hover:bg-blue-50 transition-colors">
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${status.cls}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                      {route.name}
                      <span className="ml-1 text-xs text-gray-400">{route.korail_route_code}</span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-600">{formatNumber(route.station_point_count)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-600">{formatNumber(route.baseline_point_count)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-600">{formatNumber(route.render_anchor_count)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-500 whitespace-nowrap">
                      {formatKp(route.baseline_kp_min)} ~ {formatKp(route.baseline_kp_max)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-500 whitespace-nowrap">
                      {formatKp(route.start_kp)} ~ {formatKp(route.end_kp)}
                    </td>
                  </tr>
                );
              })}
              {sortedRoutes.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                    검증할 노선 정보가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
