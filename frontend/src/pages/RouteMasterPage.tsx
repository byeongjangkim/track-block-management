import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchReferenceRoutes,
  fetchReferenceSummary,
  fetchTrackSections,
  createTrackSection,
  updateTrackSection,
  deleteTrackSection,
  updateRouteDefaults,
  type RailReferenceRoute,
  type TrackSection,
  type TrackSectionInput,
} from '../api/railReference';

// 선로 수 선택지: 단선(1) / 복선(2) / 복복선(4, 2복선) / 삼복선(6, 상하선이 3개)
const TRACK_COUNT_LABELS: Record<number, string> = { 1: '단선', 2: '복선', 4: '복복선', 6: '삼복선' };
const TRACK_COUNT_OPTIONS = [1, 2, 4, 6];

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

// ── 선로 구성 패널 ─────────────────────────────────────────────────────────

const EMPTY_SECTION = (route: RailReferenceRoute): TrackSectionInput => ({
  start_kp: route.start_kp ?? 0,
  end_kp:   route.end_kp   ?? 0,
  track_count: 2,
  has_catenary: true,
  note: null,
});

function TrackConfigPanel({ route }: { route: RailReferenceRoute }) {
  const qc = useQueryClient();
  const [notice, setNotice]   = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addData, setAddData] = useState<TrackSectionInput>(EMPTY_SECTION(route));
  const [editId, setEditId]   = useState<number | null>(null);
  const [editData, setEditData] = useState<TrackSectionInput>(EMPTY_SECTION(route));

  // 기본값 로컬 상태 — route 변경 시 useEffect로 동기화
  const [localTrack, setLocalTrack]     = useState(route.default_track_count ?? 2);
  const [localCatenary, setLocalCatenary] = useState(route.default_has_catenary ?? true);
  useEffect(() => {
    setLocalTrack(route.default_track_count ?? 2);
    setLocalCatenary(route.default_has_catenary ?? true);
    setShowAddForm(false);
    setEditId(null);
  }, [route.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const defaultsDirty =
    localTrack    !== (route.default_track_count  ?? 2) ||
    localCatenary !== (route.default_has_catenary ?? true);

  const { data: sections = [], isLoading } = useQuery({
    queryKey: ['track-sections', route.id],
    queryFn:  () => fetchTrackSections(route.id),
    staleTime: 30_000,
  });

  function flash(msg: string) { setNotice(msg); setTimeout(() => setNotice(''), 2500); }
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['track-sections', route.id] });
    qc.invalidateQueries({ queryKey: ['reference-routes'] });
    qc.invalidateQueries({ queryKey: ['map-all-rail-geometry'] });
  }

  const defaultsMut = useMutation({
    mutationFn: (d: { default_track_count: number; default_has_catenary: boolean }) =>
      updateRouteDefaults(route.id, d),
    onSuccess: () => { invalidate(); flash('기본값 저장됨'); },
  });
  const createMut = useMutation({
    mutationFn: (d: TrackSectionInput) => createTrackSection(route.id, d),
    onSuccess: () => { invalidate(); setShowAddForm(false); flash('구간 등록됨'); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TrackSectionInput }) => updateTrackSection(id, data),
    onSuccess: () => { invalidate(); setEditId(null); flash('구간 수정됨'); },
  });
  const deleteMut = useMutation({
    mutationFn: deleteTrackSection,
    onSuccess: () => { invalidate(); flash('구간 삭제됨'); },
  });

  const inp = 'border rounded px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white';

  return (
    <div className="border-t pt-4 mt-2 space-y-4">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">선로 구성·전차선</h3>
        {notice && (
          <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded">
            ✓ {notice}
          </span>
        )}
      </div>

      {/* ① 노선 전체 기본값 */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs">
        <div className="text-blue-700 font-medium mb-2">노선 전체 기본값 <span className="font-normal text-blue-400">(구간별 예외가 없을 때 적용)</span></div>
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <label className="block text-gray-500 mb-1">선로 수</label>
            <select
              value={localTrack}
              onChange={e => setLocalTrack(Number(e.target.value))}
              className={inp}
            >
              {TRACK_COUNT_OPTIONS.map(n => (
                <option key={n} value={n}>{TRACK_COUNT_LABELS[n]} ({n}선)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-gray-500 mb-1">전차선 (가선)</label>
            <div className="flex items-center gap-2 mt-1.5">
              <input
                type="checkbox"
                id="catenary-default"
                checked={localCatenary}
                onChange={e => setLocalCatenary(e.target.checked)}
                className="w-4 h-4 accent-blue-600"
              />
              <label htmlFor="catenary-default" className={`cursor-pointer font-medium ${localCatenary ? 'text-blue-700' : 'text-gray-400'}`}>
                {localCatenary ? '있음 (전철화)' : '없음 (비전철)'}
              </label>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => defaultsMut.mutate({ default_track_count: localTrack, default_has_catenary: localCatenary })}
            disabled={!defaultsDirty || defaultsMut.isPending}
            className={`px-4 py-1.5 rounded text-xs font-medium transition-colors ${
              defaultsDirty
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {defaultsMut.isPending ? '저장 중…' : '저장'}
          </button>
          {defaultsDirty && (
            <span className="text-amber-600 text-[11px]">⚠ 미저장 변경사항</span>
          )}
          {!defaultsDirty && (
            <span className="text-gray-400 text-[11px]">저장된 상태입니다</span>
          )}
        </div>
      </div>

      {/* ② 구간별 예외 목록 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-600">
            구간별 예외 <span className="font-normal text-gray-400">(기본값과 다른 구간만 등록)</span>
          </span>
          {!showAddForm && (
            <button
              onClick={() => { setAddData(EMPTY_SECTION(route)); setShowAddForm(true); setEditId(null); }}
              className="text-xs px-3 py-1 border border-blue-500 text-blue-600 rounded hover:bg-blue-50 transition-colors"
            >
              + 구간 추가
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="text-xs text-gray-400 py-3 text-center">로딩 중...</div>
        ) : sections.length === 0 && !showAddForm ? (
          <div className="text-xs text-gray-400 py-3 text-center border rounded bg-gray-50">
            등록된 구간 없음 — 전 구간에 기본값 적용
          </div>
        ) : (
          <table className="w-full text-xs border-collapse border rounded overflow-hidden">
            <thead>
              <tr className="bg-gray-100 text-gray-500">
                <th className="px-3 py-2 text-left whitespace-nowrap font-medium">시작 KP</th>
                <th className="px-3 py-2 text-left whitespace-nowrap font-medium">종료 KP</th>
                <th className="px-3 py-2 text-left whitespace-nowrap font-medium">선로수</th>
                <th className="px-3 py-2 text-left whitespace-nowrap font-medium">전차선</th>
                <th className="px-3 py-2 text-left font-medium">비고</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {sections.map((sec: TrackSection) => editId === sec.id ? (
                <tr key={sec.id} className="border-t bg-blue-50">
                  <td className="px-2 py-1.5"><input type="number" step="0.1" value={editData.start_kp} onChange={e => setEditData(d => ({ ...d, start_kp: Number(e.target.value) }))} className={inp} /></td>
                  <td className="px-2 py-1.5"><input type="number" step="0.1" value={editData.end_kp}   onChange={e => setEditData(d => ({ ...d, end_kp:   Number(e.target.value) }))} className={inp} /></td>
                  <td className="px-2 py-1.5">
                    <select value={editData.track_count} onChange={e => setEditData(d => ({ ...d, track_count: Number(e.target.value) }))} className={inp}>
                      {TRACK_COUNT_OPTIONS.map(n => <option key={n} value={n}>{TRACK_COUNT_LABELS[n]} ({n}선)</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={editData.has_catenary} onChange={e => setEditData(d => ({ ...d, has_catenary: e.target.checked }))} className="w-4 h-4 accent-blue-600" />
                  </td>
                  <td className="px-2 py-1.5"><input type="text" value={editData.note ?? ''} onChange={e => setEditData(d => ({ ...d, note: e.target.value || null }))} placeholder="비고" className={inp} /></td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1.5">
                      <button onClick={() => updateMut.mutate({ id: sec.id, data: editData })} disabled={updateMut.isPending} className="px-2 py-1 bg-blue-600 text-white rounded text-[11px] hover:bg-blue-700 disabled:opacity-50">저장</button>
                      <button onClick={() => setEditId(null)} className="px-2 py-1 border rounded text-[11px] text-gray-600 hover:bg-gray-50">취소</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={sec.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 tabular-nums text-gray-700">{sec.start_kp}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{sec.end_kp}</td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-100 text-slate-700 font-medium whitespace-nowrap">
                      {TRACK_COUNT_LABELS[sec.track_count]} ({sec.track_count}선)
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`font-medium ${sec.has_catenary ? 'text-blue-600' : 'text-gray-400'}`}>
                      {sec.has_catenary ? '있음' : '없음'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-400 truncate max-w-[80px]">{sec.note ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditId(sec.id); setEditData({ start_kp: sec.start_kp, end_kp: sec.end_kp, track_count: sec.track_count, has_catenary: sec.has_catenary, note: sec.note }); setShowAddForm(false); }}
                        className="text-blue-500 hover:text-blue-700 text-[11px]"
                      >수정</button>
                      <button
                        onClick={() => { if (confirm(`KP ${sec.start_kp}~${sec.end_kp} 구간을 삭제하시겠습니까?`)) deleteMut.mutate(sec.id); }}
                        className="text-red-400 hover:text-red-600 text-[11px]"
                      >삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 구간 추가 폼 — 테이블 아래 카드 형태 */}
        {showAddForm && (
          <div className="mt-3 border border-green-200 bg-green-50 rounded-lg p-3">
            <div className="text-xs font-medium text-green-700 mb-2">새 구간 추가</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">시작 KP</label>
                <input type="number" step="0.1" value={addData.start_kp}
                  onChange={e => setAddData(d => ({ ...d, start_kp: Number(e.target.value) }))}
                  className={inp} />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">종료 KP</label>
                <input type="number" step="0.1" value={addData.end_kp}
                  onChange={e => setAddData(d => ({ ...d, end_kp: Number(e.target.value) }))}
                  className={inp} />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">선로 수</label>
                <select value={addData.track_count}
                  onChange={e => setAddData(d => ({ ...d, track_count: Number(e.target.value) }))}
                  className={inp}>
                  {TRACK_COUNT_OPTIONS.map(n => <option key={n} value={n}>{TRACK_COUNT_LABELS[n]} ({n}선)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">전차선</label>
                <div className="flex items-center gap-2 mt-1.5">
                  <input type="checkbox" id="add-catenary" checked={addData.has_catenary}
                    onChange={e => setAddData(d => ({ ...d, has_catenary: e.target.checked }))}
                    className="w-4 h-4 accent-green-600" />
                  <label htmlFor="add-catenary" className={`cursor-pointer text-xs font-medium ${addData.has_catenary ? 'text-green-700' : 'text-gray-400'}`}>
                    {addData.has_catenary ? '있음 (전철화)' : '없음 (비전철)'}
                  </label>
                </div>
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-[11px] text-gray-500 mb-1">비고</label>
              <input type="text" value={addData.note ?? ''}
                onChange={e => setAddData(d => ({ ...d, note: e.target.value || null }))}
                placeholder="예: 서울~구로 삼복선 구간"
                className={inp} />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => createMut.mutate(addData)}
                disabled={createMut.isPending}
                className="px-4 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {createMut.isPending ? '등록 중…' : '구간 등록'}
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-1.5 border rounded text-xs text-gray-600 hover:bg-white transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
      <div className="px-4 pb-4">
        <TrackConfigPanel route={route} />
      </div>
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
          <table className="w-full text-sm border-collapse table-fixed">
            <colgroup>
              <col className="w-12" />       {/* ID */}
              <col className="w-14" />       {/* 노선코드 */}
              <col className="w-36" />       {/* 노선명 */}
              <col className="w-12" />       {/* 구분 */}
              <col className="w-24" />       {/* 시점역 */}
              <col className="w-24" />       {/* 종점역 */}
              <col className="w-28" />       {/* KP 범위 */}
              <col className="w-20" />       {/* 연장 */}
              <col className="w-12" />       {/* 역/KP */}
              <col className="w-12" />       {/* 기준선 */}
              <col className="w-14" />       {/* 렌더링 */}
              <col className="w-14" />       {/* 상태 */}
            </colgroup>
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['ID', '노선코드', '노선명', '구분', '시점역', '종점역', 'KP 범위', '연장', '역/KP', '기준선', '렌더링', '상태'].map((header) => (
                  <th key={header} className="px-2 py-2.5 text-left text-xs font-medium text-gray-500 border-b truncate">
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
                    <td className="px-2 py-2.5 tabular-nums text-gray-500 truncate">{route.id}</td>
                    <td className="px-2 py-2.5 font-mono text-xs text-gray-700 truncate">{route.korail_route_code}</td>
                    <td className="px-2 py-2.5 font-semibold text-gray-800 truncate" title={route.name}>{route.name}</td>
                    <td className="px-2 py-2.5 text-gray-500 truncate">{route.route_category ?? '—'}</td>
                    <td className="px-2 py-2.5 text-gray-600 truncate" title={route.start_station_name ?? ''}>{route.start_station_name ?? '—'}</td>
                    <td className="px-2 py-2.5 text-gray-600 truncate" title={route.end_station_name ?? ''}>{route.end_station_name ?? '—'}</td>
                    <td className="px-2 py-2.5 tabular-nums text-gray-600 text-xs truncate">
                      {formatKp(route.start_kp)} ~ {formatKp(route.end_kp)}
                    </td>
                    <td className="px-2 py-2.5 tabular-nums text-gray-500 text-xs truncate">{formatLength(route.length_kp)}</td>
                    <td className="px-2 py-2.5 tabular-nums text-center text-gray-600">{route.station_point_count.toLocaleString()}</td>
                    <td className="px-2 py-2.5 tabular-nums text-center text-gray-600">{route.baseline_point_count.toLocaleString()}</td>
                    <td className="px-2 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded-full text-xs ${status.cls}`}>
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
