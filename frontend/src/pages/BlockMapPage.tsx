/**
 * BlockMapPage — 차단현황도 (메인 통합 페이지)
 *
 * 사이드바 구조:
 *   [소속 조직 배지] (org_admin/user)  /  [조직 선택] (superuser)
 *   [날짜 선택]
 *   [내부/외부 · 분야 필터]
 *   [지도 설정 ▼]
 *     ├ 관할 구간 표시
 *     ├ 노선 그룹: 노선 레이어 → 노선 필터
 *     ├ 시설물 (accordion): 역 / 구조물 / 전기설비
 *     └ 위험/보호구간
 *   [차단명령 목록]
 */
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { fetchOrganizations } from '../api/organizations';
import { fetchRoutes } from '../api/routes';
import { fetchBlockOrders } from '../api/blockOrders';
import { fetchBlockSegments, fetchRailRouteRegionBoundaries } from '../api/map';
import type { BlockSegmentCollection } from '../api/map';
import RailwayMap from '../components/map/RailwayMap';
import type { Route, FacilityFilter } from '../types';

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtTime(t: string) { return t.slice(0, 5); }

const DIR_LABEL: Record<string, string> = { UP: '상선', DOWN: '하선', BOTH: '전체' };
const DIR_COLOR: Record<string, string>  = { UP: '#ef4444', DOWN: '#f97316', BOTH: '#8b5cf6' };

const DEFAULT_FACILITY_FILTER: FacilityFilter = {
  역관리역:       true,
  역보통역:       true,
  역무인역:       true,
  역신호장:       true,
  역신호소:       true,
  구조물터널:     true,
  구조물교량:     true,
  구조물과선교:   true,
  구조물건널목:   true,
  구조물분기:     true,
  전기변전소:     true,
  전기전기실:     true,
  전기통신실:     true,
  전기신호기계실: true,
};

// ── 시설물 Accordion 그룹 컴포넌트 ───────────────────────────────────────────

type FacilityItem = {
  key: keyof FacilityFilter;
  label: string;
  hasData?: boolean;  // false → 체크박스 비활성 + "준비중" 표시
};

function FacilityGroup({
  label,
  items,
  filter,
  expanded,
  onToggleExpand,
  onToggleItem,
  onToggleAll,
}: {
  label: string;
  items: FacilityItem[];
  filter: FacilityFilter;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleItem: (key: keyof FacilityFilter) => void;
  onToggleAll: (keys: (keyof FacilityFilter)[], allOn: boolean) => void;
}) {
  // hasData=true 인 항목만 parent 체크박스 계산에 포함
  const activeKeys = items.filter((i) => i.hasData !== false).map((i) => i.key);
  const allOn  = activeKeys.length > 0 && activeKeys.every((k) => filter[k]);
  const someOn = activeKeys.some((k) => filter[k]);

  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5 py-0.5">
        <input
          type="checkbox"
          checked={allOn}
          ref={(el) => { if (el) el.indeterminate = !allOn && someOn; }}
          onChange={() => onToggleAll(activeKeys, allOn)}
          disabled={activeKeys.length === 0}
          className="w-3.5 h-3.5 shrink-0"
        />
        <button
          onClick={onToggleExpand}
          className="flex-1 flex items-center justify-between text-xs font-medium text-gray-700 hover:text-gray-900 text-left"
        >
          <span>{label}</span>
          <span className="text-gray-400 text-[9px] ml-1">{expanded ? '▲' : '▶'}</span>
        </button>
      </div>

      {expanded && (
        <div className="ml-5 mt-0.5 mb-1 space-y-0.5">
          {items.map(({ key, label: itemLabel, hasData = true }) => (
            <label
              key={key}
              className={`flex items-center gap-1.5 text-xs select-none py-0.5 ${hasData ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <input
                type="checkbox"
                checked={filter[key]}
                onChange={() => { if (hasData) onToggleItem(key); }}
                disabled={!hasData}
                className="w-3 h-3 shrink-0"
              />
              <span className={
                !hasData ? 'text-gray-300' : filter[key] ? 'text-gray-700' : 'text-gray-400'
              }>
                {itemLabel}
              </span>
              {!hasData && <span className="ml-auto text-[9px] text-gray-300">준비중</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function BlockMapPage() {
  const user        = useAuthStore((s) => s.user);
  const isSuperuser = user?.role === 'system_superuser';
  const isOrgUser   = !isSuperuser && user?.organization_id != null;
  const [searchParams] = useSearchParams();

  // ── 차단명령 필터 ───────────────────────────────────────────────────────────
  const [workDate,       setWorkDate]       = useState(searchParams.get('date') ?? todayStr());
  const [filterRouteId,  setFilterRouteId]  = useState<number | null>(null);
  const [filterExternal, setFilterExternal] = useState<boolean | null>(null);
  const [filterField,    setFilterField]    = useState<string | null>(null);
  const [selectedId,     setSelectedId]     = useState<number | null>(null);

  // ── 지도 설정 ───────────────────────────────────────────────────────────────
  const [selectedOrgId,        setSelectedOrgId]        = useState<number | null>(user?.organization_id ?? null);
  const [showOrgBoundary,      setShowOrgBoundary]      = useState(isOrgUser);
  const [facilityFilter,       setFacilityFilter]       = useState<FacilityFilter>(DEFAULT_FACILITY_FILTER);
  const [hiddenLineTypes,      setHiddenLineTypes]      = useState<Set<'고속선' | '일반선'>>(new Set());
  const [showDangerZone,       setShowDangerZone]       = useState(false);
  const [mapSettingsOpen,      setMapSettingsOpen]      = useState(isOrgUser);
  const [expandedFacilities,   setExpandedFacilities]   = useState<Set<'역' | '구조물' | '전기설비'>>(new Set());

  const showFacilitiesAny = Object.values(facilityFilter).some(Boolean);
  const mapOrgId = isSuperuser ? selectedOrgId : (user?.organization_id ?? null);

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

  const { data: orgBoundaryData } = useQuery({
    queryKey: ['org-route-boundaries', mapOrgId],
    queryFn: () => fetchRailRouteRegionBoundaries({ organization_id: mapOrgId! }),
    enabled: !isSuperuser && mapOrgId != null,
    staleTime: Infinity,
  });

  const orgRouteCodes = useMemo(() => {
    if (!orgBoundaryData || orgBoundaryData.features.length === 0) return null;
    return new Set(orgBoundaryData.features.map((f) => f.properties.route_code));
  }, [orgBoundaryData]);

  const filteredRoutes = useMemo(() => {
    if (isSuperuser || orgRouteCodes == null) return routes;
    return routes.filter((r) => orgRouteCodes.has(r.code));
  }, [routes, orgRouteCodes, isSuperuser]);

  const { data: blockOrders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['block-orders-date', workDate, filterRouteId, filterExternal, filterField],
    queryFn: () => fetchBlockOrders({
      date_from:   workDate,
      date_to:     workDate,
      route_id:    filterRouteId ?? undefined,
      is_external: filterExternal ?? undefined,
      field:       filterField ?? undefined,
    }),
    staleTime: 30_000,
  });

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

  const filterRouteCode = useMemo(
    () => (filterRouteId != null ? (routeMap.get(filterRouteId)?.code ?? null) : null),
    [filterRouteId, routeMap],
  );

  // ── 핸들러 ───────────────────────────────────────────────────────────────────

  function toggleLineType(lt: '고속선' | '일반선') {
    setHiddenLineTypes((prev) => {
      const next = new Set(prev);
      if (next.has(lt)) next.delete(lt); else next.add(lt);
      return next;
    });
  }

  function toggleFacility(key: keyof FacilityFilter) {
    setFacilityFilter((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleAllInCategory(keys: (keyof FacilityFilter)[], allOn: boolean) {
    const next = !allOn;
    setFacilityFilter((prev) => ({
      ...prev,
      ...Object.fromEntries(keys.map((k) => [k, next])),
    }));
  }

  function toggleFacilityExpand(cat: '역' | '구조물' | '전기설비') {
    setExpandedFacilities((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
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

        {/* 소속 조직 배지 (non-superuser) */}
        {isOrgUser && (
          <div className="px-3 py-2 bg-blue-50 border-b shrink-0">
            <div className="text-[10px] text-blue-400 mb-0.5 uppercase tracking-wide">소속 조직</div>
            <div className="text-sm font-semibold text-blue-800">{user?.organization_name}</div>
          </div>
        )}

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
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}

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

        {/* 내부/외부 · 분야 필터 */}
        <div className="px-3 py-2 border-b shrink-0 space-y-2">
          <div>
            <div className="text-xs text-gray-500 mb-1">내부/외부</div>
            <div className="flex gap-1">
              {([
                [null,  '전체'],
                [false, '내부'],
                [true,  '외부'],
              ] as [boolean | null, string][]).map(([v, label]) => (
                <button
                  key={String(v)}
                  onClick={() => setFilterExternal(v)}
                  className={`flex-1 py-0.5 text-[10px] rounded border transition-colors ${
                    filterExternal === v
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">분야</div>
            <div className="flex gap-1">
              {([
                [null,   '전체'],
                ['시설', '시설'],
                ['전기', '전기'],
                ['건축', '건축'],
              ] as [string | null, string][]).map(([v, label]) => (
                <button
                  key={v ?? 'all'}
                  onClick={() => setFilterField(v)}
                  className={`flex-1 py-0.5 text-[10px] rounded border transition-colors ${
                    filterField === v
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── 지도 설정 (접기/펼치기) ──────────────────────────────── */}
        <div className="shrink-0 border-b overflow-y-auto" style={{ maxHeight: '55%' }}>
          <button
            onClick={() => setMapSettingsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 sticky top-0 bg-white z-10 border-b"
          >
            <span>지도 설정</span>
            <span className="text-gray-400">{mapSettingsOpen ? '▲' : '▼'}</span>
          </button>

          {mapSettingsOpen && (
            <div>

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

              {/* ── 노선 그룹 ─────────────────────────────────────── */}
              <div className="px-3 py-2 border-b">
                <div className="text-xs font-medium text-gray-500 mb-2">노선</div>

                {/* 노선 레이어 */}
                <div className="mb-2.5">
                  <div className="text-[10px] text-gray-400 mb-1">노선 레이어</div>
                  {(['고속선', '일반선'] as const).map((lt) => (
                    <label key={lt} className="flex items-center gap-2 text-xs cursor-pointer select-none py-0.5">
                      <input
                        type="checkbox"
                        checked={!hiddenLineTypes.has(lt)}
                        onChange={() => toggleLineType(lt)}
                        className="w-3.5 h-3.5"
                      />
                      <span
                        className="inline-block w-4 h-0.5 rounded"
                        style={{ backgroundColor: lt === '고속선' ? '#dc2626' : '#374151' }}
                      />
                      <span className={hiddenLineTypes.has(lt) ? 'text-gray-400' : 'text-gray-700'}>{lt}</span>
                    </label>
                  ))}
                </div>

                {/* 노선 필터 */}
                <div>
                  <div className="text-[10px] text-gray-400 mb-1">
                    노선 필터
                    {!isSuperuser && orgRouteCodes != null && (
                      <span className="ml-1 text-blue-400">담당 {filteredRoutes.length}개</span>
                    )}
                  </div>
                  <select
                    value={filterRouteId ?? ''}
                    onChange={(e) => { setFilterRouteId(e.target.value ? Number(e.target.value) : null); setSelectedId(null); }}
                    className="w-full border rounded px-2 py-1 text-xs"
                  >
                    <option value="">전체 노선</option>
                    {filteredRoutes.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── 시설물 그룹 (accordion) ───────────────────────── */}
              <div className="px-3 py-2 border-b">
                <div className="text-xs font-medium text-gray-500 mb-1.5">시설물</div>

                <FacilityGroup
                  label="역"
                  items={[
                    { key: '역관리역', label: '관리역' },
                    { key: '역보통역', label: '보통역' },
                    { key: '역무인역', label: '무인역' },
                    { key: '역신호장', label: '신호장' },
                    { key: '역신호소', label: '신호소' },
                  ]}
                  filter={facilityFilter}
                  expanded={expandedFacilities.has('역')}
                  onToggleExpand={() => toggleFacilityExpand('역')}
                  onToggleItem={toggleFacility}
                  onToggleAll={toggleAllInCategory}
                />

                <FacilityGroup
                  label="구조물"
                  items={[
                    { key: '구조물터널',   label: '터널' },
                    { key: '구조물교량',   label: '교량' },
                    { key: '구조물과선교', label: '과선교' },
                    { key: '구조물건널목', label: '건널목' },
                    { key: '구조물분기',   label: '분기' },
                  ]}
                  filter={facilityFilter}
                  expanded={expandedFacilities.has('구조물')}
                  onToggleExpand={() => toggleFacilityExpand('구조물')}
                  onToggleItem={toggleFacility}
                  onToggleAll={toggleAllInCategory}
                />

                <FacilityGroup
                  label="전기설비"
                  items={[
                    { key: '전기변전소',     label: '변전소' },
                    { key: '전기전기실',     label: '전기실' },
                    { key: '전기통신실',     label: '통신실' },
                    { key: '전기신호기계실', label: '신호기계실' },
                  ]}
                  filter={facilityFilter}
                  expanded={expandedFacilities.has('전기설비')}
                  onToggleExpand={() => toggleFacilityExpand('전기설비')}
                  onToggleItem={toggleFacility}
                  onToggleAll={toggleAllInCategory}
                />
              </div>

              {/* 위험지구/보호지구 */}
              <div className="px-3 py-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showDangerZone}
                    onChange={(e) => setShowDangerZone(e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  <span className="text-gray-600">위험/보호구간</span>
                </label>
                {showDangerZone && (
                  <div className="mt-1.5 ml-5 space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                      <span className="inline-block w-8 h-2 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.4)' }} />
                      위험지구 (선로 내 2m)
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                      <span className="inline-block w-8 h-2 rounded" style={{ backgroundColor: 'rgba(249,115,22,0.2)' }} />
                      보호지구 (선로 내 30m)
                    </div>
                  </div>
                )}
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
                    isSelected ? 'bg-red-50 border-l-2 border-l-red-500' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800 truncate">{routeName}</span>
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      {bo.is_external && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-100 text-yellow-700">외부</span>
                      )}
                      {isOnMap
                        ? <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-600">지도</span>
                        : <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-400">미표시</span>
                      }
                    </div>
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
          hiddenLineTypes={hiddenLineTypes}
          facilityFilter={showFacilitiesAny ? facilityFilter : null}
          filterRouteCode={filterRouteCode}
          showDangerZone={showDangerZone}
          blockSegments={blockSegments ?? null}
          selectedBlockId={selectedId}
        />

        {/* 날짜·필터 배지 */}
        <div className="absolute top-3 left-4 bg-white/90 border rounded-lg px-3 py-1.5 text-xs text-gray-600 shadow flex items-center gap-1.5">
          <span>{workDate} 차단현황도</span>
          {filterExternal === false && (
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px]">내부</span>
          )}
          {filterExternal === true && (
            <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 text-[10px]">외부</span>
          )}
          {filterField && (
            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px]">{filterField}</span>
          )}
          {blockOrders.length > 0 && onMapIds.size < blockOrders.length && (
            <span className="text-gray-400">(지도 {onMapIds.size}/{blockOrders.length}건)</span>
          )}
        </div>
      </main>

    </div>
  );
}
