/**
 * BlockMapPage — 차단현황도 (메인 통합 페이지)
 *
 * 노선도 기능 완전 통합:
 *   - 날짜별 차단명령 오버레이 (메인 기능)
 *   - 노선 레이어 토글
 *   - 시설물 레이어 선택
 *   - 조직 관할 구간 표시
 *
 * 사이드바 구조:
 *   [날짜 선택] [노선 필터] [조직 선택(superuser)]
 *   [지도 설정 ▼] — 시설물·관할구간·노선 토글 (접기/펼치기)
 *   [차단명령 목록] — flex-1 (주 영역)
 */
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { fetchOrganizations } from '../api/organizations';
import { fetchRoutes } from '../api/routes';
import { fetchBlockOrders } from '../api/blockOrders';
import { fetchBlockSegments } from '../api/map';
import type { BlockSegmentCollection } from '../api/map';
import RailwayMap from '../components/map/RailwayMap';
import type { Route } from '../types';

// ── 노선 분류 ────────────────────────────────────────────────────────────────

const HIGH_SPEED_CODES = new Set([
  'gyeongbu_high', 'honam_high', 'gangneung', 'donghae_ktx', 'jungbu_naeryuk', 'suseo_pyeongtaek',
]);
const SUBWAY_CODES = new Set(['suin', 'bundang']);

function classifyRoute(code: string): '고속철도' | '지하철' | '보통철도' {
  if (HIGH_SPEED_CODES.has(code)) return '고속철도';
  if (SUBWAY_CODES.has(code)) return '지하철';
  return '보통철도';
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function fmtTime(t: string) {
  return t.slice(0, 5);
}

const DIR_LABEL: Record<string, string> = { UP: '상선', DOWN: '하선' };
const DIR_COLOR: Record<string, string> = { UP: '#ef4444', DOWN: '#f97316' };

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function BlockMapPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperuser = user?.role === 'system_superuser';
  const [searchParams] = useSearchParams();

  // ── 차단명령 상태 ──
  const [workDate, setWorkDate]           = useState(searchParams.get('date') ?? todayStr());
  const [filterRouteId, setFilterRouteId] = useState<number | null>(null);
  const [selectedId, setSelectedId]       = useState<number | null>(null);

  // ── 지도 설정 상태 (노선도 통합) ──
  const [selectedOrgId, setSelectedOrgId]       = useState<number | null>(
    user?.organization_id ?? null,
  );
  const [showOrgBoundary, setShowOrgBoundary]   = useState(
    user?.role === 'org_admin' || user?.role === 'user',
  );
  const [hiddenRoutes, setHiddenRoutes]   = useState<Set<string>>(new Set());
  const [showFacilities, setShowFacilities] = useState(false);
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);

  // ── 데이터 조회 ──────────────────────────────────────────────────────────────

  const { data: routes = [] } = useQuery({
    queryKey: ['routes'],
    queryFn: fetchRoutes,
    staleTime: Infinity,
  });

  const { data: orgs = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: fetchOrganizations,
    enabled: isSuperuser,
    staleTime: Infinity,
  });

  // 사이드바 차단명령 목록 (geometry 여부 무관, DB 직접 조회)
  const { data: blockOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['block-orders-date', workDate, filterRouteId],
    queryFn: () => fetchBlockOrders({
      date_from: workDate,
      date_to:   workDate,
      route_id:  filterRouteId ?? undefined,
    }),
    staleTime: 30_000,
  });

  // 지도 오버레이 (user geometry 있는 노선만 표시)
  const { data: blockSegments } = useQuery<BlockSegmentCollection>({
    queryKey: ['block-segments', workDate, filterRouteId],
    queryFn: () => fetchBlockSegments({
      work_date: workDate,
      route_id:  filterRouteId ?? undefined,
    }),
    staleTime: 30_000,
  });

  // ── 파생 데이터 ──────────────────────────────────────────────────────────────

  const onMapIds = useMemo(
    () => new Set((blockSegments?.features ?? []).map((f) => f.properties.id)),
    [blockSegments],
  );

  const routeMap = useMemo(
    () => new Map<number, Route>(routes.map((r) => [r.id, r])),
    [routes],
  );

  // 노선 그룹 분류
  const grouped = useMemo(() => {
    const g: Record<'고속철도' | '보통철도' | '지하철', Route[]> = {
      '고속철도': [], '보통철도': [], '지하철': [],
    };
    for (const r of routes) g[classifyRoute(r.code)].push(r);
    return g;
  }, [routes]);

  const mapOrgId = isSuperuser ? selectedOrgId : (user?.organization_id ?? null);

  // ── 노선 토글 ────────────────────────────────────────────────────────────────

  function toggleRoute(code: string) {
    setHiddenRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  function toggleGroup(codes: string[], hide: boolean) {
    setHiddenRoutes((prev) => {
      const next = new Set(prev);
      for (const c of codes) { if (hide) next.add(c); else next.delete(c); }
      return next;
    });
  }

  function handleSelect(id: number) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── 사이드바 ─────────────────────────────────────────────────── */}
      <aside className="w-64 bg-white border-r flex flex-col shrink-0 overflow-hidden">

        {/* 날짜 선택 */}
        <div className="p-3 border-b shrink-0">
          <label className="block text-xs text-gray-500 mb-1">작업 날짜</label>
          <input
            type="date"
            value={workDate}
            onChange={(e) => { setWorkDate(e.target.value); setSelectedId(null); }}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>

        {/* 노선 필터 */}
        <div className="p-3 border-b shrink-0">
          <label className="block text-xs text-gray-500 mb-1">노선 필터</label>
          <select
            value={filterRouteId ?? ''}
            onChange={(e) => {
              setFilterRouteId(e.target.value ? Number(e.target.value) : null);
              setSelectedId(null);
            }}
            className="w-full border rounded px-2 py-1 text-xs"
          >
            <option value="">전체 노선</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        {/* superuser: 조직 선택 */}
        {isSuperuser && (
          <div className="p-3 border-b shrink-0">
            <label className="block text-xs text-gray-500 mb-1">조직 선택</label>
            <select
              value={selectedOrgId ?? ''}
              onChange={(e) => setSelectedOrgId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border rounded px-2 py-1 text-xs"
            >
              <option value="">전국 조망</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* ── 지도 설정 (접기/펼치기) ──────────────────────────────── */}
        <div className="shrink-0 border-b">
          <button
            onClick={() => setMapSettingsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <span>지도 설정</span>
            <span className="text-gray-400">{mapSettingsOpen ? '▲' : '▼'}</span>
          </button>

          {mapSettingsOpen && (
            <div className="border-t">

              {/* 관할 구간 표시 */}
              {mapOrgId != null && (
                <div className="px-3 py-2 border-b">
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showOrgBoundary}
                      onChange={(e) => setShowOrgBoundary(e.target.checked)}
                      className="w-3.5 h-3.5"
                    />
                    <span className="text-gray-600">관할 구간 표시</span>
                  </label>
                  {showOrgBoundary && (
                    <p className="text-xs text-blue-500 mt-1 ml-5">
                      {isSuperuser
                        ? orgs.find((o) => o.id === selectedOrgId)?.name ?? ''
                        : user?.organization_name ?? ''}
                    </p>
                  )}
                </div>
              )}

              {/* 시설물 표시 */}
              <div className="px-3 py-2 border-b">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showFacilities}
                    onChange={(e) => setShowFacilities(e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  <span className="text-gray-600">시설물 표시</span>
                </label>
                {showFacilities && (
                  <p className="text-xs text-blue-400 mt-1 ml-5">표시 중인 노선 · 확대 시 단계 표시</p>
                )}
              </div>

              {/* 노선 레이어 토글 */}
              <div className="px-2 py-2 max-h-52 overflow-y-auto space-y-2">
                <div className="px-1 text-xs font-medium text-gray-500 mb-1">노선 표시</div>
                {(['고속철도', '보통철도', '지하철'] as const).map((group) => {
                  const groupRoutes = grouped[group];
                  if (groupRoutes.length === 0) return null;
                  const codes = groupRoutes.map((r) => r.code);
                  const allHidden  = codes.every((c) => hiddenRoutes.has(c));
                  const someHidden = codes.some((c) => hiddenRoutes.has(c));
                  return (
                    <div key={group}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium text-gray-600">{group}</span>
                        <button
                          onClick={() => toggleGroup(codes, !allHidden)}
                          className="text-[10px] text-blue-500 hover:text-blue-700"
                        >
                          {allHidden || someHidden ? '전체 표시' : '전체 숨김'}
                        </button>
                      </div>
                      <div className="space-y-0.5">
                        {groupRoutes.map((r) => (
                          <label
                            key={r.code}
                            className="flex items-center gap-1.5 text-xs cursor-pointer select-none py-0.5"
                          >
                            <input
                              type="checkbox"
                              checked={!hiddenRoutes.has(r.code)}
                              onChange={() => toggleRoute(r.code)}
                              className="w-3 h-3 shrink-0"
                            />
                            <span className={hiddenRoutes.has(r.code) ? 'text-gray-400' : 'text-gray-700'}>
                              {r.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          )}
        </div>

        {/* ── 차단명령 목록 (주 영역) ──────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-3 py-2 shrink-0 text-xs font-medium text-gray-500 border-b flex items-center gap-1">
            <span>차단명령 목록</span>
            {ordersLoading
              ? <span className="text-blue-400">로딩 중…</span>
              : <span className="text-gray-400">({blockOrders.length}건)</span>
            }
            {onMapIds.size > 0 && (
              <span className="ml-auto text-blue-500 text-[10px]">지도 {onMapIds.size}건</span>
            )}
          </div>

          {blockOrders.length === 0 && !ordersLoading && (
            <div className="p-4 text-xs text-gray-400 text-center">
              해당 날짜에 차단명령이 없습니다.
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {blockOrders.map((bo) => {
              const isSelected = selectedId === bo.id;
              const isOnMap    = onMapIds.has(bo.id);
              const routeName  = routeMap.get(bo.route_id)?.name ?? `노선 #${bo.route_id}`;
              return (
                <button
                  key={bo.id}
                  onClick={() => handleSelect(bo.id)}
                  className={`w-full text-left px-3 py-2 border-b text-xs transition-colors ${
                    isSelected
                      ? 'bg-red-50 border-l-2 border-l-red-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800 truncate">{routeName}</span>
                    {isOnMap
                      ? <span className="shrink-0 ml-1 text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-600">지도</span>
                      : <span className="shrink-0 ml-1 text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-400">미표시</span>
                    }
                  </div>
                  <div className="text-gray-500 mt-0.5 flex items-center gap-1">
                    <span>KP {bo.start_km}~{bo.end_km}km</span>
                    <span
                      className="px-1 rounded text-white text-[9px]"
                      style={{ backgroundColor: DIR_COLOR[bo.direction] ?? '#888' }}
                    >
                      {DIR_LABEL[bo.direction] ?? bo.direction}
                    </span>
                  </div>
                  <div className="text-gray-500">
                    {fmtTime(bo.start_time)}~{fmtTime(bo.end_time)}
                  </div>
                  <div className="text-gray-400">{bo.field} / {bo.block_type}</div>
                </button>
              );
            })}
          </div>
        </div>

      </aside>

      {/* ── 지도 영역 ────────────────────────────────────────────────── */}
      <main className="flex-1 relative overflow-hidden">
        <RailwayMap
          orgId={mapOrgId}
          showOrgBoundary={showOrgBoundary && mapOrgId != null}
          hiddenRoutes={hiddenRoutes}
          showFacilities={showFacilities}
          blockSegments={blockSegments ?? null}
          selectedBlockId={selectedId}
        />

        {/* 날짜·상태 배지 */}
        <div className="absolute top-3 left-4 bg-white/90 border rounded-lg px-3 py-1.5 text-xs text-gray-600 shadow">
          {workDate} 차단현황도
          {blockOrders.length > 0 && onMapIds.size < blockOrders.length && (
            <span className="ml-2 text-gray-400">
              (지도 {onMapIds.size}/{blockOrders.length}건)
            </span>
          )}
        </div>
      </main>

    </div>
  );
}
