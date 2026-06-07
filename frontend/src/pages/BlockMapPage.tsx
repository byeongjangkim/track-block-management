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

// ── 인라인 상세 패널 컴포넌트 ────────────────────────────────────────────────

import type { BlockOrder as BlockOrderType } from '../types';
import { useQuery as _useQuery } from '@tanstack/react-query';
import { fetchMonitors as _fetchMonitors, openDocumentInBrowser as _openDoc } from '../api/blockOrders';

function InlineDetail({
  order,
  highlightedBlockIds,
  consecutiveSeries,
  dangerMut,
}: {
  order: BlockOrderType;
  highlightedBlockIds: Set<number> | null;
  consecutiveSeries: { dateFrom: string; dateTo: string; days: number } | null;
  dangerMut: { mutate: (arg: { id: number; level: string | null }) => void; isPending: boolean };
}) {
  const { data: monitors = [] } = _useQuery<import('../types').BlockOrderMonitor[]>({
    queryKey: ['monitors', order.id],
    queryFn: () => _fetchMonitors(order.id),
  });

  return (
    <div className="border-b border-blue-100 bg-blue-50/40">

      {/* 승인원문 PDF 버튼 */}
      {order.document_id != null && (
        <div className="px-3 pt-2 pb-1">
          <button
            onClick={(e) => { e.stopPropagation(); _openDoc(order.document_id!); }}
            className="w-full py-1 text-[10px] rounded border border-blue-300 bg-white text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1"
          >
            📄 승인원문 PDF 보기
          </button>
        </div>
      )}

      {/* 기본 정보 */}
      <div className="px-3 py-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs border-b border-blue-100">
        {order.project_name && (
          <>
            <span className="text-gray-400">사업명</span>
            <span className="text-gray-700 break-words text-[10px]">{order.project_name}</span>
          </>
        )}
        {order.approved_date && (
          <>
            <span className="text-gray-400">승인일자</span>
            <span className="text-gray-800">{order.approved_date}</span>
          </>
        )}
        <span className="text-gray-400">구간</span>
        <span className="text-gray-800">
          {order.block_type === '전차선단전'
            ? (order.section_note ?? 'KP 미지정')
            : `KP ${order.start_kp ?? order.start_km}~${order.end_kp ?? order.end_km}km`}
        </span>
        <span className="text-gray-400">시간</span>
        <span className="text-gray-800">
          {order.work_date} {order.start_time.slice(0,5)}~{order.end_time.slice(0,5)}
        </span>
        <span className="text-gray-400">분야/종류</span>
        <span className="text-gray-800">{order.field} / {order.block_type}</span>
        {order.block_method && (
          <>
            <span className="text-gray-400">차단방법</span>
            <span className="text-gray-800">{order.block_method}</span>
          </>
        )}
        {order.work_type && (
          <>
            <span className="text-gray-400">작업형태</span>
            <span className="text-gray-800">{order.work_type}작업</span>
          </>
        )}
        <span className="text-gray-400">시행주체</span>
        <span className="text-gray-800">{order.implementer || '철도공사'}</span>
        {order.contractor && (
          <>
            <span className="text-gray-400">시공사</span>
            <span className="text-gray-800">
              {order.contractor}
              {order.contractor_phone && (
                <span className="text-gray-500 ml-1">({order.contractor_phone})</span>
              )}
            </span>
          </>
        )}
        <span className="text-gray-400">작업책임자</span>
        <span className="text-gray-800">
          {order.work_supervisor}
          {order.work_supervisor_phone && (
            <span className="text-gray-500 ml-1">({order.work_supervisor_phone})</span>
          )}
        </span>
        <span className="text-gray-400">안전관리자</span>
        <span className="text-gray-800">
          {order.safety_manager}
          {order.safety_manager_phone && (
            <span className="text-gray-500 ml-1">({order.safety_manager_phone})</span>
          )}
        </span>
        {order.electric_safety_manager && (
          <>
            <span className="text-gray-400">전기안전</span>
            <span className="text-gray-800">
              {order.electric_safety_manager}
              {order.electric_safety_manager_phone && (
                <span className="text-gray-500 ml-1">({order.electric_safety_manager_phone})</span>
              )}
            </span>
          </>
        )}
        {order.note && (
          <>
            <span className="text-gray-400">비고</span>
            <span className="text-gray-600 break-words">{order.note}</span>
          </>
        )}
      </div>

      {/* 열차감시원 */}
      {(monitors.length > 0 || order.train_watcher) && (
        <div className="px-3 py-1.5 border-b border-blue-100 text-xs">
          <div className="text-[10px] text-gray-400 mb-1">열차감시원</div>
          <div className="space-y-0.5">
            {/* 레거시 단수 필드 */}
            {order.train_watcher && monitors.length === 0 && (
              <div className="text-gray-700">
                {order.train_watcher}
                {order.train_watcher_phone && (
                  <span className="text-gray-500 ml-1">({order.train_watcher_phone})</span>
                )}
              </div>
            )}
            {/* 신규 복수 레코드 */}
            {monitors.map((m) => (
              <div key={m.id} className="flex items-center gap-1 text-gray-700">
                {m.company && <span className="text-gray-400 text-[9px]">{m.company}</span>}
                <span>{m.name}</span>
                {m.phone && <span className="text-gray-500">({m.phone})</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 사업 묶음 / 연속작업 */}
      {(highlightedBlockIds || consecutiveSeries) && (
        <div className="px-3 py-1.5 border-b border-blue-100 bg-blue-100/50 text-xs space-y-1">
          {highlightedBlockIds && order.doc_no && (
            <div className="flex items-center gap-1">
              <span className="font-medium text-blue-700">📋 사업묶음</span>
              <span className="text-blue-600">문서 {order.doc_no} — {highlightedBlockIds.size}건</span>
            </div>
          )}
          {consecutiveSeries && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="font-medium text-amber-700">📅 연속작업</span>
              <span className="text-amber-600 text-[10px]">{consecutiveSeries.dateFrom}~{consecutiveSeries.dateTo}</span>
              <span className="px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">{consecutiveSeries.days}일</span>
            </div>
          )}
        </div>
      )}

      {/* 위험등급 설정 */}
      <div className="px-3 py-2">
        <div className="text-[10px] text-gray-400 mb-1">위험등급</div>
        <div className="flex gap-1">
          {([
            [null, '미지정', 'bg-gray-400'],
            ['A',  'A 위험', 'bg-red-500'],
            ['B',  'B 주의', 'bg-yellow-500'],
            ['C',  'C 일반', 'bg-green-500'],
          ] as [string | null, string, string][]).map(([v, label, cls]) => (
            <button
              key={String(v)}
              onClick={(e) => { e.stopPropagation(); dangerMut.mutate({ id: order.id, level: v }); }}
              className={`flex-1 py-0.5 text-[10px] rounded transition-colors ${
                order.danger_level === v
                  ? `${cls} text-white`
                  : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'
              }`}
              disabled={dangerMut.isPending}
            >{label}</button>
          ))}
        </div>
      </div>

    </div>
  );
}

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
  const [workDate,         setWorkDate]         = useState(searchParams.get('date') ?? todayStr());
  const [filterRouteIds,   setFilterRouteIds]   = useState<Set<number>>(new Set());
  const [routeFilterOpen,  setRouteFilterOpen]  = useState(false);
  // 단일 노선 ID — useQuery queryKey/params에 직접 사용 (선언을 useQuery보다 앞에)
  const singleFilterRouteId = filterRouteIds.size === 1 ? [...filterRouteIds][0] : null;
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

  // 노선 필터 팝오버 외부 클릭 시 닫힘
  const routeFilterRef  = useRef<HTMLDivElement>(null);
  const listScrollRef   = useRef<HTMLDivElement>(null);
  const itemRefs        = useRef<Record<number, HTMLDivElement>>({});
  useEffect(() => {
    if (!routeFilterOpen) return;
    const handler = (e: MouseEvent) => {
      if (routeFilterRef.current && !routeFilterRef.current.contains(e.target as Node)) {
        setRouteFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [routeFilterOpen]);

  // ── 사이드바 접힘 상태 ────────────────────────────────────────────────────────
  const [workFilterOpen, setWorkFilterOpen] = useState(false);

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
    queryKey: ['block-orders-date', workDate, singleFilterRouteId, filterImplementer, filterWorkType, filterField],
    queryFn: () => fetchBlockOrders({
      date_from:   workDate,
      date_to:     workDate,
      route_id:    singleFilterRouteId ?? undefined,
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
    queryKey: ['block-orders-ext', extDateFrom, extDateTo, singleFilterRouteId],
    queryFn: () => fetchBlockOrders({
      date_from: extDateFrom,
      date_to:   extDateTo,
      route_id:  singleFilterRouteId ?? undefined,
    }),
    enabled: !!selectedId,   // 선택된 건이 있을 때만 조회
    staleTime: 60_000,
  });

  const { data: blockSegments } = useQuery<BlockSegmentCollection>({
    queryKey: ['block-segments', workDate, singleFilterRouteId],
    queryFn: () => fetchBlockSegments({
      work_date: workDate,
      route_id:  singleFilterRouteId ?? undefined,
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

  // filterRouteNames: 시설물 feature의 route_name과 일치하는 노선명 Set
  // (레거시 routes.code ≠ rail_routes.korail_route_code 불일치 방지 → name 비교)
  const filterRouteNames = useMemo(
    () => filterRouteIds.size === 0
      ? null
      : new Set([...filterRouteIds].map(id => routeMap.get(id)?.name).filter(Boolean) as string[]),
    [filterRouteIds, routeMap],
  );

  // ── 위험등급 필터 파생 (onMapIds보다 먼저 정의) ─────────────────────────────

  const filteredBlockOrders = useMemo(() => {
    let result = blockOrders;
    // 복수 노선 선택 시 클라이언트 필터 (서버는 1개만 지원)
    if (filterRouteIds.size > 1) {
      const names = filterRouteNames!;
      result = result.filter((bo) => {
        const name = bo.route_name ?? routeMap.get(bo.route_id)?.name;
        return name != null && names.has(name);
      });
    }
    if (filterDangerLevel === null) return result;
    if (filterDangerLevel === 'none') return result.filter((bo) => bo.danger_level === null);
    return result.filter((bo) => bo.danger_level === filterDangerLevel);
  }, [blockOrders, filterDangerLevel, filterRouteIds, filterRouteNames, routeMap]);

  const filteredBlockSegments = useMemo((): BlockSegmentCollection | null => {
    if (!blockSegments) return null;
    let feats = blockSegments.features;
    // 복수 노선 선택 시 클라이언트 필터
    if (filterRouteIds.size > 1 && filterRouteNames) {
      const names = filterRouteNames;
      feats = feats.filter((f) => f.properties.route_name != null && names.has(f.properties.route_name));
    }
    if (filterDangerLevel !== null) {
      feats = feats.filter((f) =>
        filterDangerLevel === 'none'
          ? f.properties.danger_level === null
          : f.properties.danger_level === filterDangerLevel
      );
    }
    return { ...blockSegments, features: feats };
  }, [blockSegments, filterDangerLevel, filterRouteIds, filterRouteNames]);

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
  }, [selectedOrder, extBlockOrders]);

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
    setSelectedId((prev) => (prev === id ? null : id));
  }

  // 지도 클릭 등 selectedId 변경 시 → 목록에서 해당 항목으로 자동 스크롤
  useEffect(() => {
    if (selectedId == null) return;
    const el = itemRefs.current[selectedId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedId]);

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

        {/* ── 작업 구분 (접기/펼치기) ──────────────────────────────── */}
        <div className="shrink-0 border-b">
          <button
            onClick={() => setWorkFilterOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <span className="flex items-center gap-1.5">
              작업 구분
              {/* 활성 필터 수 배지 */}
              {[filterImplementer, filterWorkType, filterField, filterDangerLevel].filter(Boolean).length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 text-[9px] font-semibold">
                  {[filterImplementer, filterWorkType, filterField, filterDangerLevel].filter(Boolean).length}
                </span>
              )}
            </span>
            <span className="text-gray-400">{workFilterOpen ? '▲' : '▼'}</span>
          </button>

          {workFilterOpen && (
            <div className="px-3 pb-3 space-y-2">
              {/* 시행주체 */}
              <div>
                <div className="text-[10px] text-gray-400 mb-1">시행주체</div>
                <div className="flex gap-1 flex-wrap">
                  {([
                    [null,       '전체', 'bg-blue-600'],
                    ['철도공사', '공사', 'bg-blue-600'],
                    ['철도공단', '공단', 'bg-purple-600'],
                    ['외부',     '외부', 'bg-yellow-500'],
                  ] as [string | null, string, string][]).map(([v, label, activeCls]) => (
                    <button key={String(v)} onClick={() => setFilterImplementer(v)}
                      className={`flex-1 py-0.5 text-[10px] rounded border transition-colors ${
                        filterImplementer === v
                          ? `${activeCls} text-white border-transparent`
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>
              {/* 작업형태 */}
              <div>
                <div className="text-[10px] text-gray-400 mb-1">작업형태</div>
                <div className="flex gap-1">
                  {([
                    [null, '전체'], ['인력', '인력'], ['장비', '장비'], ['기계', '기계'],
                  ] as [string | null, string][]).map(([v, label]) => (
                    <button key={v ?? 'all'} onClick={() => setFilterWorkType(v)}
                      className={`flex-1 py-0.5 text-[10px] rounded border transition-colors ${
                        filterWorkType === v
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>
              {/* 분야 */}
              <div>
                <div className="text-[10px] text-gray-400 mb-1">분야</div>
                <div className="flex gap-1">
                  {([
                    [null, '전체'], ['시설', '시설'], ['전기', '전기'], ['건축', '건축'],
                  ] as [string | null, string][]).map(([v, label]) => (
                    <button key={v ?? 'all'} onClick={() => setFilterField(v)}
                      className={`flex-1 py-0.5 text-[10px] rounded border transition-colors ${
                        filterField === v
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>
              {/* 위험등급 */}
              <div>
                <div className="text-[10px] text-gray-400 mb-1">위험등급</div>
                <div className="flex flex-wrap gap-1">
                  {([
                    [null,   '전체',  'bg-blue-600'],
                    ['A',    'A위험', 'bg-red-500'],
                    ['B',    'B주의', 'bg-yellow-500'],
                    ['C',    'C일반', 'bg-green-500'],
                    ['none', '미지정','bg-gray-400'],
                  ] as [string | null, string, string][]).map(([v, label, activeCls]) => (
                    <button key={String(v)} onClick={() => setFilterDangerLevel(v)}
                      className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                        filterDangerLevel === v
                          ? `${activeCls} text-white border-transparent`
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 지도 설정 (접기/펼치기) ──────────────────────────────── */}
        <div className="shrink-0 overflow-y-auto" style={{ maxHeight: '55%' }}>
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

                {/* 노선 필터 — 멀티 선택 */}
                <div className="relative" ref={routeFilterRef}>
                  <div className="text-[10px] text-gray-400 mb-1 flex items-center justify-between">
                    <span>
                      노선 필터
                      {!isSuperuser && orgRouteCodes != null && (
                        <span className="ml-1 text-blue-400">담당 {filteredRoutes.length}개</span>
                      )}
                    </span>
                    {filterRouteIds.size > 0 && (
                      <button onClick={() => { setFilterRouteIds(new Set()); setSelectedId(null); }}
                        className="text-[10px] text-blue-500 hover:text-blue-700">전체</button>
                    )}
                  </div>

                  {/* 선택된 노선 태그 */}
                  {filterRouteIds.size > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {[...filterRouteIds].map(id => {
                        const r = routeMap.get(id);
                        return r ? (
                          <span key={id} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px]">
                            {r.name}
                            <button onClick={() => {
                              const next = new Set(filterRouteIds); next.delete(id);
                              setFilterRouteIds(next); setSelectedId(null);
                            }} className="hover:text-blue-900">✕</button>
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}

                  {/* 팝오버 토글 버튼 */}
                  <button
                    onClick={() => setRouteFilterOpen(v => !v)}
                    className="w-full border rounded px-2 py-1 text-xs text-left text-gray-600 flex items-center justify-between"
                  >
                    <span>{filterRouteIds.size === 0 ? '전체 노선' : `${filterRouteIds.size}개 선택`}</span>
                    <span className="text-gray-400 text-[10px]">{routeFilterOpen ? '▲' : '▼'}</span>
                  </button>

                  {/* 체크박스 팝오버 */}
                  {routeFilterOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-1 border rounded bg-white shadow-lg max-h-48 overflow-y-auto text-xs">
                      {filteredRoutes.map((r) => (
                        <label key={r.id} className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filterRouteIds.has(r.id)}
                            onChange={(e) => {
                              const next = new Set(filterRouteIds);
                              if (e.target.checked) next.add(r.id); else next.delete(r.id);
                              setFilterRouteIds(next); setSelectedId(null);
                            }}
                            className="accent-blue-600"
                          />
                          <span className="truncate">{r.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
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

        {/* ── 차단명령 목록 (아코디언: 항목 클릭 → 아래에 상세 펼침) ─ */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* 헤더 */}
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

          {/* 스크롤 목록 */}
          <div ref={listScrollRef} className="overflow-y-auto flex-1">
            {filteredBlockOrders.map((bo) => {
              const isSelected = selectedId === bo.id;
              const isOnMap    = onMapIds.has(bo.id);
              const routeName  = bo.route_name
                ?? routeMap.get(bo.route_id)?.name
                ?? (bo.route_id != null ? `노선 #${bo.route_id}` : '노선 미지정');

              return (
                <div
                  key={bo.id}
                  ref={(el) => { if (el) itemRefs.current[bo.id] = el; }}
                >
                  {/* 항목 행 (클릭 → 토글) */}
                  <button
                    onClick={() => handleSelect(bo.id)}
                    className={`w-full text-left px-3 py-2 border-b text-xs transition-colors ${
                      isSelected
                        ? 'bg-blue-50 border-l-[3px] border-l-blue-500'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800 truncate">{routeName}</span>
                      <div className="flex items-center gap-1 shrink-0 ml-1">
                        {bo.danger_level && (
                          <span className="text-[9px] px-1 py-0.5 rounded text-white font-medium"
                            style={{
                              backgroundColor: bo.danger_level === 'A' ? '#ef4444'
                                : bo.danger_level === 'B' ? '#f59e0b' : '#10b981',
                            }}>
                            {bo.danger_level}등급
                          </span>
                        )}
                        {bo.is_external && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-100 text-yellow-700">외부</span>
                        )}
                        {isOnMap
                          ? <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-600">지도</span>
                          : <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-400">미표시</span>}
                        <span className="text-gray-400 text-[9px]">{isSelected ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    <div className="text-gray-500 mt-0.5 flex items-center gap-1">
                      {bo.block_type === '전차선단전'
                        ? <span className="truncate">{bo.section_note ?? 'KP 미지정'}</span>
                        : <span>KP {bo.start_kp ?? bo.start_km}~{bo.end_kp ?? bo.end_km}km</span>}
                      <span className="px-1 rounded text-white text-[9px] shrink-0"
                        style={{ backgroundColor: TRACK_COLOR }}>
                        {fmtTracks(bo.tracks)}
                      </span>
                    </div>
                    <div className="text-gray-500">{fmtTime(bo.start_time)}~{fmtTime(bo.end_time)}</div>
                    <div className="text-gray-400">{bo.field} / {bo.block_type}</div>
                  </button>

                  {/* 인라인 상세 (선택된 항목 아래에 펼침) */}
                  {isSelected && selectedOrder && (
                    <InlineDetail
                      order={selectedOrder}
                      highlightedBlockIds={highlightedBlockIds}
                      consecutiveSeries={consecutiveSeries}
                      dangerMut={dangerMut}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </aside>

      {/* ── 지도 영역 ────────────────────────────────────────────────── */}
      <main className="flex-1 relative overflow-hidden min-h-0 min-w-0">
        <RailwayMap
          orgId={mapOrgId}
          showOrgBoundary={showOrgBoundary && mapOrgId != null}
          hiddenLineTypes={hiddenLineTypes}
          facilityFilter={showFacilitiesAny ? facilityFilter : null}
          filterRouteCode={filterRouteNames}
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
      </main>

    </div>
  );
}
