import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchReferenceRoutes,
  fetchRouteStationPoints,
  type RailReferenceRoute,
  type RailRouteStationPoint,
} from '../api/railReference';

type ValidationFilter = 'all' | 'error' | 'missing-gps' | 'missing-kp' | 'range' | 'unclassified';

interface ValidationResult {
  status: 'ok' | 'warn' | 'error';
  label: string;
  issues: string[];
}

function formatKp(value: number | null) {
  return value == null ? '—' : value.toFixed(3);
}

function formatGps(lat: number | null, lon: number | null) {
  if (lat == null || lon == null) return '—';
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

function routeLabel(route: RailReferenceRoute) {
  const code = route.korail_route_code ? ` · ${route.korail_route_code}` : '';
  return `${route.name}${code}`;
}

function validateStationPoint(point: RailRouteStationPoint): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (point.center_kp == null) errors.push('중심 KP 없음');
  if (point.yard_start_kp == null || point.yard_end_kp == null) errors.push('구내 KP 없음');

  if (point.center_kp != null && point.yard_start_kp != null && point.yard_start_kp > point.center_kp) {
    errors.push('구내 시작 > 중심');
  }
  if (point.center_kp != null && point.yard_end_kp != null && point.yard_end_kp < point.center_kp) {
    errors.push('구내 종료 < 중심');
  }
  if (point.yard_start_kp != null && point.yard_end_kp != null && point.yard_start_kp > point.yard_end_kp) {
    errors.push('구내 시작 > 종료');
  }

  if (point.lat == null || point.lon == null) warnings.push('GPS 없음');
  if (!point.station_role || !point.station_type) warnings.push('역 구분 미지정');

  if (errors.length > 0) return { status: 'error', label: '오류', issues: [...errors, ...warnings] };
  if (warnings.length > 0) return { status: 'warn', label: '보완', issues: warnings };
  return { status: 'ok', label: '정상', issues: [] };
}

function matchesFilter(point: RailRouteStationPoint, filter: ValidationFilter) {
  const validation = validateStationPoint(point);
  if (filter === 'all') return true;
  if (filter === 'error') return validation.status === 'error';
  if (filter === 'missing-gps') return point.lat == null || point.lon == null;
  if (filter === 'missing-kp') return point.center_kp == null || point.yard_start_kp == null || point.yard_end_kp == null;
  if (filter === 'range') {
    return (
      (point.center_kp != null && point.yard_start_kp != null && point.yard_start_kp > point.center_kp)
      || (point.center_kp != null && point.yard_end_kp != null && point.yard_end_kp < point.center_kp)
      || (point.yard_start_kp != null && point.yard_end_kp != null && point.yard_start_kp > point.yard_end_kp)
    );
  }
  return !point.station_role || !point.station_type;
}

function validationBadge(validation: ValidationResult) {
  if (validation.status === 'ok') return 'bg-green-100 text-green-700';
  if (validation.status === 'warn') return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

export default function StationKpAdminPage() {
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>('all');

  const { data: routes = [], isLoading: routesLoading } = useQuery({
    queryKey: ['reference-routes'],
    queryFn: fetchReferenceRoutes,
  });

  useEffect(() => {
    if (selectedRouteId == null && routes.length > 0) {
      setSelectedRouteId(routes[0].id);
    }
  }, [routes, selectedRouteId]);

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  );

  const { data: stationPoints = [], isLoading: pointsLoading } = useQuery({
    queryKey: ['reference-station-points', selectedRouteId],
    queryFn: () => fetchRouteStationPoints(selectedRouteId as number),
    enabled: selectedRouteId != null,
  });

  const withCenterKp = stationPoints.filter((point) => point.center_kp != null).length;
  const withGps = stationPoints.filter((point) => point.lat != null && point.lon != null).length;
  const validationRows = stationPoints.map((point) => ({ point, validation: validateStationPoint(point) }));
  const errorCount = validationRows.filter((row) => row.validation.status === 'error').length;
  const warnCount = validationRows.filter((row) => row.validation.status === 'warn').length;
  const filteredStationPoints = stationPoints.filter((point) => matchesFilter(point, validationFilter));

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-hidden">
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <h1 className="text-lg font-semibold text-gray-800">역/KP 관리</h1>
        <select
          value={selectedRouteId ?? ''}
          onChange={(event) => {
            setSelectedRouteId(Number(event.target.value));
            setValidationFilter('all');
          }}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-48 bg-white"
        >
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {routeLabel(route)}
            </option>
          ))}
        </select>
        <select
          value={validationFilter}
          onChange={(event) => setValidationFilter(event.target.value as ValidationFilter)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        >
          <option value="all">전체 검증</option>
          <option value="error">오류</option>
          <option value="range">구내 범위 오류</option>
          <option value="missing-kp">KP 누락</option>
          <option value="missing-gps">GPS 누락</option>
          <option value="unclassified">역 구분 미지정</option>
        </select>
        <span className="text-sm text-gray-400">
          {routesLoading ? '노선 조회 중...' : `표시 ${filteredStationPoints.length.toLocaleString()}개 / 전체 ${stationPoints.length.toLocaleString()}개`}
        </span>
      </div>

      {selectedRoute && (
        <div className="flex gap-2 flex-wrap shrink-0">
          <span className="px-2.5 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-100">
            역 포인트 {stationPoints.length.toLocaleString()}개
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs bg-green-50 text-green-700 border border-green-100">
            중심 KP {withCenterKp.toLocaleString()}개
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs bg-slate-50 text-slate-700 border border-slate-200">
            GPS {withGps.toLocaleString()}개
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs bg-red-50 text-red-700 border border-red-100">
            오류 {errorCount.toLocaleString()}개
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-100">
            보완 {warnCount.toLocaleString()}개
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs bg-gray-50 text-gray-600 border border-gray-200">
            {selectedRoute.start_station_name ?? '시점 미지정'} → {selectedRoute.end_station_name ?? '종점 미지정'}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['검증', '순번', '역명', '중심 KP', '구내 시작 KP', '구내 종료 KP', 'GPS', '역 구분', '지역본부', '기준선'].map((header) => (
                <th key={header} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pointsLoading && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                  조회 중...
                </td>
              </tr>
            )}
            {!pointsLoading && filteredStationPoints.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                  조회 결과가 없습니다.
                </td>
              </tr>
            )}
            {!pointsLoading && filteredStationPoints.map((point) => {
              const validation = validateStationPoint(point);
              return (
                <tr key={point.id} className="border-b hover:bg-blue-50 transition-colors">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span title={validation.issues.join(', ')} className={`px-2 py-0.5 rounded-full text-xs ${validationBadge(validation)}`}>
                      {validation.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500">
                    {point.route_sequence_no ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                    {point.station_name}
                    <span className="ml-1 text-xs text-gray-400">{point.station_code}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-700">{formatKp(point.center_kp)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500">{formatKp(point.yard_start_kp)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500">{formatKp(point.yard_end_kp)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500 whitespace-nowrap">{formatGps(point.lat, point.lon)}</td>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                    {[point.station_role, point.station_type].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{point.regional_org ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {point.is_baseline_anchor ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">사용</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">제외</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
