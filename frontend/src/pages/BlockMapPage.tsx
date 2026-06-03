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
import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { fetchOrganizations } from '../api/organizations';
import { fetchRoutes } from '../api/routes';
import { fetchBlockOrders, updateBlockOrder } from '../api/blockOrders';
import { fetchBlockSegments, fetchRailRouteRegionBoundaries } from '../api/map';
import type { BlockSegmentCollection } from '../api/map';
import RailwayMap from '../components/map/RailwayMap';
import type { Route, FacilityFilter } from '../types';

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtTime(t: string) { return t.slice(0, 5); }

/** 선로 목록을 읽기 쉬운 문자열로 반환 */
function fmtTracks(tracks: string[]): string {
  return tracks.join(' · ');
}
const TRACK_COLOR = '#64748b';

const DANGER_COLOR: Record<string, string> = { A: '#ef4444', B: '#f59e0b', C: '#10b981' };
const DANGER_LABEL: Record<string, string> = { A: 'A 위험', B: 'B 주의', C: 'C 일반' };

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
  const [filterImplementer, setFilterImplementer] = useState<string | null>(null);  // 시행주체
  const [filterWorkType,    setFilterWorkType]    = useState<string | null>(null);  // 작업형태
  const [filterField,    setFilterField]    = useState<string | null>(null);
  const [selectedId,     setSelectedId]     = useState<number | null>(null);
  const [filterDangerLevel, setFilterDangerLevel] = useState<string | null>(null);

  // 다른 페이지(캘린더·차단명령)에서 block_id 파라미터로 진입 시 자동 선택
  // useState 초기값으로 한 번만 읽음 (이후 URL 변경에는 반응하지 않음)
  const [initBlockId] = useState<number | null>(() => {
    const raw = searchParams.get('block_id');
    const n   = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  });

  // ── 드래그 패널 ─────────────────────────────────────────────────────────────
  const mainRef  = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);

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
    queryKey: ['block-orders-date', workDate, filterRouteId, filterImplementer, filterWorkType, filterField],
    queryFn: () => fetchBlockOrders({
      date_from:   workDate,
      date_to:     workDate,
      route_id:    filterRouteId ?? undefined,
      implementer: filterImplementer ?? undefined,
      work_type:   filterWorkType ?? undefined,
      field:       filterField ?? undefined,
    }),
    staleTime: 30_000,
  });

  // 연속 작업 감지용: ±45일 확장 쿼리 (선택된 건 있을 때만 실행)
  const extDateFrom = useMemo(() => {
    const d = new Date(workDate);
    d.setDate(d.getDate() - 45);
    return d.toISOString().slice(0, 10);
  }, [workDate]);
  const extDateTo = useMemo(() => {
    const d = new Date(workDate);
    d.setDate(d.getDate() + 45);
    return d.toISOString().slice(0, 10);
  }, [workDate]);

  const { data: extBlockOrders = [] } = useQuery({
    queryKey: ['block-orders-ext', extDateFrom, extDateTo, filterRouteId],
    queryFn: () => fetchBlockOrders({
      date_from: extDateFrom,
      date_to:   extDateTo,
      route_id:  filterRouteId ?? undefined,
    }),
    enabled: !!selectedId,   // 선택된 건이 있을 때만 조회
    staleTime: 60_000,
  });

  const { data: blockSegments } = useQuery<BlockSegmentCollection>({
    queryKey: ['block-segments', workDate, filterRouteId],
    queryFn: () => fetchBlockSegments({
      work_date: workDate,
      route_id:  filterRouteId ?? undefined,
    }),
    staleTime: 30_000,
  });

  // URL block_id → 데이터 로드 완료 후 자동 선택 (최초 1회)
  useEffect(() => {
    if (!initBlockId || selectedId !== null) return;
    if (blockOrders.some(b => b.id === initBlockId)) {
      setSelectedId(initBlockId);
    }
  }, [initBlockId, blockOrders]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 파생 데이터 ──────────────────────────────────────────────────────────────

  const routeMap = useMemo(
    () => new Map<number, Route>(routes.map((r) => [r.id, r])),
    [routes],
  );

  const filterRouteCode = useMemo(
    () => (filterRouteId != null ? (routeMap.get(filterRouteId)?.code ?? null) : null),
    [filterRouteId, routeMap],
  );

  // ── 위험등급 필터 파생 (onMapIds보다 먼저 정의) ─────────────────────────────

  const filteredBlockOrders = useMemo(() => {
    if (filterDangerLevel === null) return blockOrders;
    if (filterDangerLevel === 'none') return blockOrders.filter((bo) => bo.danger_level === null);
    return blockOrders.filter((bo) => bo.danger_level === filterDangerLevel);
  }, [blockOrders, filterDangerLevel]);

  const filteredBlockSegments = useMemo((): BlockSegmentCollection | null => {
    if (!blockSegments) return null;
    if (filterDangerLevel === null) return blockSegments;
    const feats = blockSegments.features.filter((f) =>
      filterDangerLevel === 'none'
        ? f.properties.danger_level === null
        : f.properties.danger_level === filterDangerLevel
    );
    return { ...blockSegments, features: feats };
  }, [blockSegments, filterDangerLevel]);

  const onMapIds = useMemo(
    () => new Set((filteredBlockSegments?.features ?? []).map((f) => f.properties.id)),
    [filteredBlockSegments],
  );

  const selectedOrder = useMemo(
    () => (selectedId != null ? blockOrders.find((b) => b.id === selectedId) ?? null : null),
    [selectedId, blockOrders],
  );

  // ── 사업건별 강조 (같은 doc_no = 같은 사업 묶음) ────────────────────────────
  const highlightedBlockIds = useMemo((): Set<number> | null => {
    if (!selectedOrder?.doc_no) return null;
    const sameDocIds = blockOrders
      .filter((b) => b.doc_no === selectedOrder.doc_no)
      .map((b) => b.id);
    if (sameDocIds.length <= 1) return null;  // 1건이면 강조 불필요
    return new Set(sameDocIds);
  }, [selectedId, selectedOrder?.doc_no, blockOrders]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 연속 작업 감지 — 같은 노선·방향·구간·분야의 연속 날짜 시리즈 ────────────
  // 조회 기간(±45일) 내 blockOrders에서 감지
  const consecutiveSeries = useMemo(() => {
    if (!selectedOrder) return null;

    // ±45일 확장 데이터에서 같은 노선+선로+분야 감지
    const candidates = extBlockOrders.filter((b) =>
      b.rail_route_id === selectedOrder.rail_route_id &&
      JSON.stringify([...b.tracks].sort()) === JSON.stringify([...selectedOrder.tracks].sort()) &&
      b.field === selectedOrder.field &&
      Math.abs((b.start_kp ?? 0) - (selectedOrder.start_kp ?? 0)) < 0.5 &&
      Math.abs((b.end_kp ?? 0) - (selectedOrder.end_kp ?? 0)) < 0.5
    );

    if (candidates.length <= 1) return null;

    // 날짜 정렬
    const sorted = [...candidates].sort((a, b) => a.work_date.localeCompare(b.work_date));

    // 연속 시퀀스에서 selectedOrder가 속하는 구간 찾기
    let seriesStart = sorted[0].work_date;
    let seriesEnd   = sorted[0].work_date;
    let seriesIds   = [sorted[0].id];
    let inSeries    = false;

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].work_date);
      const curr = new Date(sorted[i].work_date);
      const diff = (curr.getTime() - prev.getTime()) / 86_400_000;

      if (diff <= 1) {
        seriesEnd = sorted[i].work_date;
        seriesIds.push(sorted[i].id);
      } else {
        // 시퀀스 종료: selectedOrder가 이 시퀀스에 속하는지 확인
        if (seriesIds.includes(selectedOrder.id) && seriesIds.length > 1) {
          inSeries = true;
          break;
        }
        seriesStart = sorted[i].work_date;
        seriesEnd   = sorted[i].work_date;
        seriesIds   = [sorted[i].id];
      }
    }
    // 마지막 시퀀스 확인
    if (!inSeries && seriesIds.includes(selectedOrder.id) && seriesIds.length > 1) {
      inSeries = true;
    }

    if (!inSeries || seriesIds.length <= 1) return null;

    return {
      dateFrom: seriesStart,
      dateTo:   seriesEnd,
      days:     seriesIds.length,
      ids:      new Set(seriesIds),
    };
  }, [selectedOrder, extBlockOrders]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 위험등급 업데이트 뮤테이션 ────────────────────────────────────────────────

  const qc = useQueryClient();
  const dangerMut = useMutation({
    mutationFn: ({ id, level }: { id: number; level: string | null }) =>
      updateBlockOrder(id, { danger_level: level }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['block-orders-date'] });
      qc.invalidateQueries({ queryKey: ['block-segments'] });
    },
  });

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
    setSelectedId((prev) => {
      if (prev === id) { setPanelPos(null); return null; }
      return id;
    });
  }

  function onPanelDragStart(e: React.MouseEvent) {
    if (!panelRef.current || !mainRef.current) return;
    e.preventDefault();
    const panelRect     = panelRef.current.getBoundingClientRect();
    const containerRect = mainRef.current.getBoundingClientRect();
    const startPosX  = panelPos?.x ?? (panelRect.left  - containerRect.left);
    const startPosY  = panelPos?.y ?? (panelRect.top   - containerRect.top);
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    function onMove(ev: MouseEvent) {
      setPanelPos({
        x: startPosX + ev.clientX - startMouseX,
        y: startPosY + ev.clientY - startMouseY,
      });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden min-h-0">

      {/* ── 사이드바 ─────────────────────────────────────────────────── */}
      <aside className="w-64 bg-white border-r flex flex-col shrink-0 overflow-hidden">

        {/* 조직 + 날짜 — 한 줄씩 인라인 레이아웃 */}
        <div className="px-3 py-2 border-b shrink-0 space-y-1.5">

          {/* 소속 조직 — 조직명 한 줄 표시 (non-superuser) */}
          {isOrgUser && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 shrink-0 w-7">조직</span>
              <span className="text-xs font-semibold text-blue-700 truncate">{user?.organization_name}</span>
            </div>
          )}

          {/* superuser: 조직 선택 드롭다운 한 줄 */}
          {isSuperuser && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 shrink-0 w-7">조직</label>
              <select
                value={selectedOrgId ?? ''}
                onChange={(e) => setSelectedOrgId(e.target.value ? Number(e.target.value) : null)}
                className="flex-1 border rounded px-1.5 py-1 text-xs min-w-0"
              >
                <option value="">전국 조망</option>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}

          {/* 날짜 선택 한 줄 */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 shrink-0 w-7">일자</label>
            <input
              type="date"
              value={workDate}
              onChange={(e) => { setWorkDate(e.target.value); setSelectedId(null); }}
              className="flex-1 border rounded px-1.5 py-1 text-xs min-w-0"
            />
          </div>
        </div>

        {/* 시행주체 · 작업형태 · 분야 · 위험등급 필터 */}
        <div className="px-3 py-2 border-b shrink-0 space-y-2">
          {/* 시행주체 (철도공사/철도공단/외부) */}
          <div>
            <div className="text-xs text-gray-500 mb-1">시행주체</div>
            <div className="flex gap-1 flex-wrap">
              {([
                [null,       '전체',   'bg-blue-600'],
                ['철도공사', '공사',   'bg-blue-600'],
                ['철도공단', '공단',   'bg-purple-600'],
                ['외부',     '외부',   'bg-yellow-500'],
              ] as [string | null, string, string][]).map(([v, label, activeCls]) => (
                <button
                  key={String(v)}
                  onClick={() => setFilterImplementer(v)}
                  className={`flex-1 py-0.5 text-[10px] rounded border transition-colors ${
                    filterImplementer === v
                      ? `${activeCls} text-white border-transparent`
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* 작업형태 (인력/장비/기계) */}
          <div>
            <div className="text-xs text-gray-500 mb-1">작업형태</div>
            <div className="flex gap-1">
              {([
                [null,   '전체'],
                ['인력', '인력'],
                ['장비', '장비'],
                ['기계', '기계'],
              ] as [string | null, string][]).map(([v, label]) => (
                <button
                  key={v ?? 'all'}
                  onClick={() => setFilterWorkType(v)}
                  className={`flex-1 py-0.5 text-[10px] rounded border transition-colors ${
                    filterWorkType === v
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

          <div>
            <div className="text-xs text-gray-500 mb-1">위험등급</div>
            <div className="flex flex-wrap gap-1">
              {([
                [null,   '전체',  'bg-blue-600'],
                ['A',    'A위험', 'bg-red-500'],
                ['B',    'B주의', 'bg-yellow-500'],
                ['C',    'C일반', 'bg-green-500'],
                ['none', '미지정','bg-gray-400'],
              ] as [string | null, string, string][]).map(([v, label, activeCls]) => (
                <button
                  key={String(v)}
                  onClick={() => setFilterDangerLevel(v)}
                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    filterDangerLevel === v
                      ? `${activeCls} text-white border-transparent`
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
              : <span className="text-gray-400">
                  {filterDangerLevel !== null
                    ? `${filteredBlockOrders.length}/${blockOrders.length}건`
                    : `(${blockOrders.length}건)`}
                </span>
            }
            {onMapIds.size > 0 && (
              <span className="ml-auto text-blue-500 text-[10px]">지도 {onMapIds.size}건</span>
            )}
          </div>

          {filteredBlockOrders.length === 0 && !ordersLoading && (
            <div className="p-4 text-xs text-gray-400 text-center">
              {blockOrders.length === 0
                ? '해당 날짜에 차단명령이 없습니다.'
                : '해당 등급의 차단명령이 없습니다.'}
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {filteredBlockOrders.map((bo) => {
              const isSelected = selectedId === bo.id;
              const isOnMap    = onMapIds.has(bo.id);
              const routeName  = (bo as any).route_name
                ?? routeMap.get(bo.route_id)?.name
                ?? (bo.route_id != null ? `노선 #${bo.route_id}` : '노선 미지정');
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
                      {bo.danger_level && (
                        <span
                          className="text-[9px] px-1 py-0.5 rounded text-white font-medium"
                          style={{
                            backgroundColor: bo.danger_level === 'A' ? '#ef4444'
                              : bo.danger_level === 'B' ? '#f59e0b'
                              : '#10b981',
                          }}
                        >
                          {bo.danger_level}등급
                        </span>
                      )}
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
                    {bo.block_type === '전차선단전' ? (
                      <span className="truncate">{bo.section_note ?? 'KP 미지정'}</span>
                    ) : (
                      <span>KP {bo.start_kp ?? bo.start_km}~{bo.end_kp ?? bo.end_km}km</span>
                    )}
                    <span
                      className="px-1 rounded text-white text-[9px] shrink-0"
                      style={{ backgroundColor: TRACK_COLOR }}
                    >
                      {fmtTracks(bo.tracks)}
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
      <main ref={mainRef} className="flex-1 relative overflow-hidden min-h-0 min-w-0">
        <RailwayMap
          orgId={mapOrgId}
          showOrgBoundary={showOrgBoundary && mapOrgId != null}
          hiddenLineTypes={hiddenLineTypes}
          facilityFilter={showFacilitiesAny ? facilityFilter : null}
          filterRouteCode={filterRouteCode}
          showDangerZone={showDangerZone}
          blockSegments={filteredBlockSegments}
          selectedBlockId={selectedId}
          highlightedBlockIds={highlightedBlockIds}
          onBlockSegmentClick={handleSelect}
        />

        {/* 날짜·필터 배지 */}
        <div className="absolute top-3 left-4 bg-white/90 border rounded-lg px-3 py-1.5 text-xs text-gray-600 shadow flex items-center gap-1.5">
          <span>{workDate} 차단현황도</span>
          {filterImplementer && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
              filterImplementer === '외부' ? 'bg-yellow-100 text-yellow-700'
              : filterImplementer === '철도공단' ? 'bg-purple-100 text-purple-700'
              : 'bg-blue-100 text-blue-700'
            }`}>{filterImplementer}</span>
          )}
          {filterWorkType && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]">{filterWorkType}작업</span>
          )}
          {filterField && (
            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px]">{filterField}</span>
          )}
          {filteredBlockOrders.length > 0 && onMapIds.size < filteredBlockOrders.length && (
            <span className="text-gray-400">(지도 {onMapIds.size}/{filteredBlockOrders.length}건)</span>
          )}
        </div>

        {/* 차단명령 상세 패널 — 드래그 가능 */}
        {selectedOrder && (
          <div
            ref={panelRef}
            className={`absolute bg-white border border-gray-200 rounded-xl shadow-xl z-20 w-80 select-none ${
              panelPos ? '' : 'bottom-4 left-1/2 -translate-x-1/2'
            }`}
            style={panelPos ? { top: panelPos.y, left: panelPos.x } : undefined}
          >
            {/* 드래그 핸들 헤더 */}
            <div
              className="flex items-center justify-between px-3 py-2 border-b bg-gray-50 rounded-t-xl cursor-grab active:cursor-grabbing"
              onMouseDown={(e) => {
                // 닫기 버튼 영역(data-close)을 클릭한 경우 드래그 핸들러 실행 안 함
                const target = e.target as HTMLElement;
                if (target.closest('[data-panel-close]')) return;
                onPanelDragStart(e);
              }}
            >
              <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                <span className="font-semibold text-gray-800 text-xs truncate">
                  {(selectedOrder as any).route_name
                    ?? routeMap.get(selectedOrder.route_id)?.name
                    ?? (selectedOrder.route_id != null ? `노선 #${selectedOrder.route_id}` : '노선 미지정')}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded text-white text-[10px] font-medium shrink-0"
                  style={{ backgroundColor: TRACK_COLOR }}
                >
                  {fmtTracks(selectedOrder.tracks)}
                </span>
                {selectedOrder.danger_level && (
                  <span
                    className="px-1.5 py-0.5 rounded text-white text-[10px] font-bold shrink-0"
                    style={{ backgroundColor: DANGER_COLOR[selectedOrder.danger_level] ?? '#888' }}
                  >
                    {DANGER_LABEL[selectedOrder.danger_level] ?? selectedOrder.danger_level}
                  </span>
                )}
              </div>
              <button
                data-panel-close
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onClick={(e) => { e.stopPropagation(); setSelectedId(null); setPanelPos(null); }}
                className="text-gray-400 hover:text-gray-700 text-base leading-none ml-2 shrink-0 px-1"
              >✕</button>
            </div>

            {/* 상세 내용 */}
            <div className="px-3 py-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <span className="text-gray-400">구간</span>
              <span className="text-gray-800">
                {selectedOrder.block_type === '전차선단전'
                  ? (selectedOrder.section_note ?? 'KP 미지정')
                  : `KP ${selectedOrder.start_kp ?? selectedOrder.start_km}~${selectedOrder.end_kp ?? selectedOrder.end_km}km`}
              </span>
              <span className="text-gray-400">작업 시간</span>
              <span className="text-gray-800">
                {selectedOrder.work_date} {fmtTime(selectedOrder.start_time)}~{fmtTime(selectedOrder.end_time)}
              </span>
              <span className="text-gray-400">분야/종류</span>
              <span className="text-gray-800">{selectedOrder.field} / {selectedOrder.block_type}</span>
              <span className="text-gray-400">작업책임자</span>
              <span className="text-gray-800">
                {selectedOrder.work_supervisor}
                {selectedOrder.work_supervisor_phone && (
                  <span className="text-gray-500 ml-1">({selectedOrder.work_supervisor_phone})</span>
                )}
              </span>
              <span className="text-gray-400">안전관리자</span>
              <span className="text-gray-800">
                {selectedOrder.safety_manager}
                {selectedOrder.safety_manager_phone && (
                  <span className="text-gray-500 ml-1">({selectedOrder.safety_manager_phone})</span>
                )}
              </span>
              {selectedOrder.electric_safety_manager && (
                <>
                  <span className="text-gray-400">전기안전</span>
                  <span className="text-gray-800">
                    {selectedOrder.electric_safety_manager}
                    {selectedOrder.electric_safety_manager_phone && (
                      <span className="text-gray-500 ml-1">({selectedOrder.electric_safety_manager_phone})</span>
                    )}
                  </span>
                </>
              )}
              {selectedOrder.note && (
                <>
                  <span className="text-gray-400">비고</span>
                  <span className="text-gray-600 break-words">{selectedOrder.note}</span>
                </>
              )}
              {/* 작업형태·시행주체 */}
              {selectedOrder.work_type && (
                <>
                  <span className="text-gray-400">작업형태</span>
                  <span className="text-gray-800">{selectedOrder.work_type}작업</span>
                </>
              )}
              <span className="text-gray-400">시행주체</span>
              <span className="text-gray-800">{selectedOrder.implementer || '철도공사'}</span>
            </div>

            {/* ── 사업건별 정보 ── */}
            {(highlightedBlockIds || consecutiveSeries) && (
              <div className="px-3 py-2 border-t bg-blue-50 text-xs space-y-1.5">
                {/* 같은 문서번호 묶음 */}
                {highlightedBlockIds && selectedOrder.doc_no && (
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-blue-700">📋 사업 묶음</span>
                    <span className="text-blue-600">
                      문서 {selectedOrder.doc_no} — {highlightedBlockIds.size}건
                    </span>
                    <span className="text-blue-400 text-[10px]">(지도에서 강조됨)</span>
                  </div>
                )}
                {/* 연속 작업 시리즈 */}
                {consecutiveSeries && (
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-amber-700">📅 연속 작업</span>
                    <span className="text-amber-600">
                      {consecutiveSeries.dateFrom} ~ {consecutiveSeries.dateTo}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                      {consecutiveSeries.days}일
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 위험등급 수정 */}
            <div className="px-3 pb-2.5 pt-1.5 border-t">
              <div className="text-[10px] text-gray-400 mb-1">위험등급 설정</div>
              <div className="flex gap-1">
                {([
                  [null, '미지정', 'bg-gray-400'],
                  ['A',  'A 위험', 'bg-red-500'],
                  ['B',  'B 주의', 'bg-yellow-500'],
                  ['C',  'C 일반', 'bg-green-500'],
                ] as [string | null, string, string][]).map(([v, label, cls]) => (
                  <button
                    key={String(v)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => dangerMut.mutate({ id: selectedOrder.id, level: v })}
                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                      selectedOrder.danger_level === v
                        ? `${cls} text-white`
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                    disabled={dangerMut.isPending}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
