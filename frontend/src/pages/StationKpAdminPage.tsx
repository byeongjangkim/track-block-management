import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchRouteSummaries,
  fetchRouteStationPoints,
  type RouteListSummary,
  type RailRouteStationPoint,
} from '../api/railReference';

// ── 검증 유틸 ────────────────────────────────────────────────────────────────

type ValidationFilter = 'all' | 'error' | 'missing-gps' | 'missing-kp' | 'range' | 'unclassified';

interface ValidationResult {
  status: 'ok' | 'warn' | 'error';
  label: string;
  issues: string[];
}

function validateStationPoint(point: RailRouteStationPoint): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (point.center_kp == null) errors.push('중심 KP 없음');
  if (point.yard_start_kp == null || point.yard_end_kp == null) errors.push('구내 KP 없음');
  if (point.center_kp != null && point.yard_start_kp != null && point.yard_start_kp > point.center_kp) errors.push('구내 시작 > 중심');
  if (point.center_kp != null && point.yard_end_kp != null && point.yard_end_kp < point.center_kp) errors.push('구내 종료 < 중심');
  if (point.yard_start_kp != null && point.yard_end_kp != null && point.yard_start_kp > point.yard_end_kp) errors.push('구내 시작 > 종료');
  if (point.lat == null || point.lon == null) warnings.push('GPS 없음');
  if (!point.station_role || !point.station_type) warnings.push('역 구분 미지정');
  if (errors.length > 0) return { status: 'error', label: '오류', issues: [...errors, ...warnings] };
  if (warnings.length > 0) return { status: 'warn', label: '보완', issues: warnings };
  return { status: 'ok', label: '정상', issues: [] };
}

function matchesFilter(point: RailRouteStationPoint, filter: ValidationFilter) {
  const v = validateStationPoint(point);
  if (filter === 'all') return true;
  if (filter === 'error') return v.status === 'error';
  if (filter === 'missing-gps') return point.lat == null || point.lon == null;
  if (filter === 'missing-kp') return point.center_kp == null || point.yard_start_kp == null || point.yard_end_kp == null;
  if (filter === 'range') return (
    (point.center_kp != null && point.yard_start_kp != null && point.yard_start_kp > point.center_kp)
    || (point.center_kp != null && point.yard_end_kp != null && point.yard_end_kp < point.center_kp)
    || (point.yard_start_kp != null && point.yard_end_kp != null && point.yard_start_kp > point.yard_end_kp)
  );
  return !point.station_role || !point.station_type;
}

function formatKp(v: number | null) { return v == null ? '—' : v.toFixed(3); }
function formatGps(lat: number | null, lon: number | null) {
  if (lat == null || lon == null) return '—';
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}
function validationBadge(v: ValidationResult) {
  if (v.status === 'ok') return 'bg-green-100 text-green-700';
  if (v.status === 'warn') return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

// ── 1단계: 노선 목록 ──────────────────────────────────────────────────────────

function RouteListView({ onSelect }: { onSelect: (r: RouteListSummary) => void }) {
  const [search, setSearch] = useState('');
  const [lineFilter, setLineFilter] = useState<'all' | '고속선' | '일반선' | '기지'>('all');
  const [errFilter, setErrFilter] = useState(false);

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['route-summaries'],
    queryFn: fetchRouteSummaries,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => routes.filter(r => {
    if (lineFilter !== 'all' && r.line_type !== lineFilter) return false;
    if (errFilter && r.station_error === 0) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return r.name.toLowerCase().includes(q)
        || (r.korail_route_code ?? '').toLowerCase().includes(q)
        || (r.start_station_name ?? '').toLowerCase().includes(q)
        || (r.end_station_name ?? '').toLowerCase().includes(q);
    }
    return true;
  }), [routes, lineFilter, errFilter, search]);

  const totalStation = routes.reduce((s, r) => s + r.station_total, 0);
  const totalError   = routes.reduce((s, r) => s + r.station_error, 0);

  return (
    <div className="h-full flex flex-col gap-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <h1 className="text-lg font-semibold text-gray-800">역/KP 관리</h1>
        <input
          type="text"
          placeholder="노선명, 코드, 시종점 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-64"
        />
        <select
          value={lineFilter}
          onChange={e => setLineFilter(e.target.value as typeof lineFilter)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        >
          <option value="all">전체 구분</option>
          <option value="고속선">고속선</option>
          <option value="일반선">일반선</option>
          <option value="기지">기지</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={errFilter}
            onChange={e => setErrFilter(e.target.checked)}
            className="accent-red-500"
          />
          <span className="text-red-600 font-medium">오류 있는 노선만</span>
        </label>
        <span className="text-sm text-gray-400 ml-auto">
          표시 {filtered.length.toLocaleString()}개 / 전체 {routes.length.toLocaleString()}개
        </span>
      </div>

      {/* 집계 요약 */}
      <div className="flex gap-3 shrink-0">
        {[
          { label: '노선 수', val: routes.length, cls: 'bg-blue-50 text-blue-700' },
          { label: '전체 역', val: totalStation, cls: 'bg-green-50 text-green-700' },
          { label: '오류 역', val: totalError, cls: totalError > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500' },
        ].map(item => (
          <div key={item.label} className={`rounded-lg border px-4 py-2.5 ${item.cls}`}>
            <div className="text-xs opacity-70">{item.label}</div>
            <div className="text-lg font-bold">{item.val.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* 노선 목록 테이블 */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['노선코드', '노선명', '구분', '시종점', 'KP 범위', '역 수', 'GPS', '오류'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">조회 중...</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">검색 결과가 없습니다.</td></tr>
            )}
            {!isLoading && filtered.map(r => (
              <tr
                key={r.id}
                onClick={() => onSelect(r)}
                className="border-b hover:bg-blue-50 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">{r.korail_route_code ?? '—'}</td>
                <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{r.name}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${r.line_type === '고속선' ? 'bg-red-100 text-red-700' : r.line_type === '기지' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
                    {r.line_type}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                  {r.start_station_name ?? '—'} → {r.end_station_name ?? '—'}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-gray-500 text-xs whitespace-nowrap">
                  {r.start_kp != null && r.end_kp != null ? `${r.start_kp.toFixed(1)}~${r.end_kp.toFixed(1)}` : '—'}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-center">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700">{r.station_total}</span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${r.station_gps === r.station_total && r.station_total > 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                    {r.station_gps}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-center">
                  {r.station_error > 0
                    ? <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 font-medium">{r.station_error}</span>
                    : <span className="text-gray-300 text-xs">—</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 2단계: 노선 상세 (역/KP 목록) ────────────────────────────────────────────

function StationDetailView({
  route,
  onBack,
}: {
  route: RouteListSummary;
  onBack: () => void;
}) {
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>('all');

  const { data: stationPoints = [], isLoading } = useQuery({
    queryKey: ['reference-station-points', route.id],
    queryFn: () => fetchRouteStationPoints(route.id),
  });

  const withCenterKp = stationPoints.filter(p => p.center_kp != null).length;
  const withGps      = stationPoints.filter(p => p.lat != null && p.lon != null).length;
  const validationRows = stationPoints.map(p => ({ point: p, validation: validateStationPoint(p) }));
  const errorCount = validationRows.filter(r => r.validation.status === 'error').length;
  const warnCount  = validationRows.filter(r => r.validation.status === 'warn').length;
  const filtered   = stationPoints.filter(p => matchesFilter(p, validationFilter));

  return (
    <div className="h-full flex flex-col gap-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          ← 목록
        </button>
        <h1 className="text-lg font-semibold text-gray-800">{route.name}</h1>
        <span className="text-sm text-gray-400">{route.korail_route_code}</span>
        <select
          value={validationFilter}
          onChange={e => setValidationFilter(e.target.value as ValidationFilter)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white ml-auto"
        >
          <option value="all">전체 검증</option>
          <option value="error">오류</option>
          <option value="range">구내 범위 오류</option>
          <option value="missing-kp">KP 누락</option>
          <option value="missing-gps">GPS 누락</option>
          <option value="unclassified">역 구분 미지정</option>
        </select>
        <span className="text-sm text-gray-400">
          표시 {filtered.length.toLocaleString()}개 / 전체 {stationPoints.length.toLocaleString()}개
        </span>
      </div>

      {/* 집계 배지 */}
      <div className="flex gap-2 flex-wrap shrink-0">
        <span className="px-2.5 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-100">역 포인트 {stationPoints.length.toLocaleString()}개</span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-green-50 text-green-700 border border-green-100">중심 KP {withCenterKp.toLocaleString()}개</span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-slate-50 text-slate-700 border border-slate-200">GPS {withGps.toLocaleString()}개</span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-red-50 text-red-700 border border-red-100">오류 {errorCount.toLocaleString()}개</span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-100">보완 {warnCount.toLocaleString()}개</span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-gray-50 text-gray-600 border border-gray-200">
          {route.start_station_name ?? '시점 미지정'} → {route.end_station_name ?? '종점 미지정'}
        </span>
      </div>

      {/* 역 테이블 */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['검증', '순번', '역명', '중심 KP', '구내 시작 KP', '구내 종료 KP', 'GPS', '역 구분', '지역본부', '기준선'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">조회 중...</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">조회 결과가 없습니다.</td></tr>
            )}
            {!isLoading && filtered.map(point => {
              const v = validateStationPoint(point);
              return (
                <tr key={point.id} className="border-b hover:bg-blue-50 transition-colors">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span title={v.issues.join(', ')} className={`px-2 py-0.5 rounded-full text-xs ${validationBadge(v)}`}>{v.label}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500">{point.route_sequence_no ?? '—'}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                    {point.station_name}<span className="ml-1 text-xs text-gray-400">{point.station_code}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-700">{formatKp(point.center_kp)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500">{formatKp(point.yard_start_kp)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500">{formatKp(point.yard_end_kp)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500 whitespace-nowrap">{formatGps(point.lat, point.lon)}</td>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{[point.station_role, point.station_type].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{point.regional_org ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {point.is_baseline_anchor
                      ? <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">사용</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">제외</span>
                    }
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

// ── 메인 ─────────────────────────────────────────────────────────────────────

export default function StationKpAdminPage() {
  const [selectedRoute, setSelectedRoute] = useState<RouteListSummary | null>(null);

  if (selectedRoute) {
    return (
      <div className="h-full flex flex-col p-6 overflow-hidden">
        <StationDetailView route={selectedRoute} onBack={() => setSelectedRoute(null)} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <RouteListView onSelect={setSelectedRoute} />
    </div>
  );
}
