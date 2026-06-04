import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bulkUploadFacilities,
  createRailFacility,
  deleteRailFacility,
  downloadFacilityTemplate,
  fetchFacilityClassifications,
  fetchRailFacilities,
  fetchReferenceRoutes,
  fetchRouteSummaries,
  updateRailFacility,
  type BulkUploadResult,
  type RailFacility,
  type RailFacilityClassification,
  type RailFacilityInput,
  type RouteListSummary,
} from '../api/railReference';

type EditId = number | 'new' | null;
type StatusFilter = 'all' | 'active' | 'inactive';

interface EditRow {
  facility_code: string;
  name: string;
  classification_id: number | '';
  kp_start: string;
  kp_end: string;
  lat: string;
  lon: string;
  lat_end: string;
  lon_end: string;
  direction: string;
  section_from: string;
  section_to: string;
  address: string;
  road_width_m: string;
  is_paved: boolean | null;
  bus_accessible: boolean | null;
  entrance_passage_type: string;
  entrance_lock_type: string;
  bore_type: string;           // 복선 | 단선_상선 | 단선_하선
  use_as_baseline_anchor: boolean;
  is_active: boolean;
  note: string;
}

const DIRECTION_LABELS: Record<string, string> = {
  '': '—',
  UP: '상선',
  DOWN: '하선',
  BOTH: '상하선',
};

const MAJOR_COLORS: Record<string, string> = {
  구조물: 'bg-slate-100 text-slate-700',
  전기설비: 'bg-purple-100 text-purple-700',
};

function classificationSubLabel(c: RailFacilityClassification) {
  const parts = [c.sub_category];
  if (c.detail_category) parts.push(c.detail_category);
  if (c.tertiary_category) parts.push(c.tertiary_category);
  return parts.join(' / ');
}

function emptyRow(classifications: RailFacilityClassification[]): EditRow {
  return {
    facility_code: '',
    name: '',
    classification_id: classifications.find((c) => c.is_active)?.id ?? '',
    kp_start: '',
    kp_end: '',
    lat: '',
    lon: '',
    lat_end: '',
    lon_end: '',
    direction: '',
    section_from: '',
    section_to: '',
    address: '',
    road_width_m: '',
    is_paved: null,
    bus_accessible: null,
    entrance_passage_type: '',
    entrance_lock_type: '',
    bore_type: '복선',
    use_as_baseline_anchor: false,
    is_active: true,
    note: '',
  };
}

function rowFromFacility(facility: RailFacility): EditRow {
  return {
    facility_code: facility.facility_code ?? '',
    name: facility.name,
    classification_id: facility.classification_id,
    kp_start: String(facility.kp_start),
    kp_end: facility.kp_end == null ? '' : String(facility.kp_end),
    lat: facility.lat == null ? '' : String(facility.lat),
    lon: facility.lon == null ? '' : String(facility.lon),
    lat_end: facility.lat_end == null ? '' : String(facility.lat_end),
    lon_end: facility.lon_end == null ? '' : String(facility.lon_end),
    direction: facility.direction ?? '',
    section_from: facility.section_from ?? '',
    section_to: facility.section_to ?? '',
    address: facility.address ?? '',
    road_width_m: facility.road_width_m == null ? '' : String(facility.road_width_m),
    is_paved: facility.is_paved,
    bus_accessible: facility.bus_accessible,
    entrance_passage_type: facility.entrance_passage_type ?? '',
    entrance_lock_type: facility.entrance_lock_type ?? '',
    bore_type: facility.bore_type ?? '복선',
    use_as_baseline_anchor: facility.use_as_baseline_anchor,
    is_active: facility.is_active,
    note: facility.note ?? '',
  };
}

function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatKp(value: number | null) {
  return value == null ? '—' : value.toFixed(3);
}

function formatGps(lat: number | null, lon: number | null) {
  if (lat == null || lon == null) return '—';
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

function kpRange(facility: RailFacility) {
  if (facility.geometry_type === 'linear') {
    return `${formatKp(facility.kp_start)} ~ ${formatKp(facility.kp_end)}`;
  }
  return formatKp(facility.kp_start);
}

function errorMessage(error: unknown) {
  const apiError = error as { response?: { data?: { detail?: string } } };
  return apiError.response?.data?.detail ?? '처리 중 오류가 발생했습니다.';
}

function buildPayload(row: EditRow, classification: RailFacilityClassification | undefined): RailFacilityInput | null {
  const kpStart = toNumber(row.kp_start);
  const kpEnd = toNumber(row.kp_end);
  const lat = toNumber(row.lat);
  const lon = toNumber(row.lon);
  const latEnd = toNumber(row.lat_end);
  const lonEnd = toNumber(row.lon_end);

  if (!row.name.trim() || row.classification_id === '' || kpStart == null) {
    return null;
  }
  if (classification?.geometry_type === 'linear' && kpEnd == null) {
    return null;
  }

  return {
    facility_code: row.facility_code.trim() || null,
    name: row.name.trim(),
    classification_id: row.classification_id,
    kp_start: kpStart,
    kp_end: kpEnd,
    lat,
    lon,
    lat_end: latEnd,
    lon_end: lonEnd,
    direction: row.direction || null,
    section_from: row.section_from.trim() || null,
    section_to: row.section_to.trim() || null,
    address: row.address.trim() || null,
    road_width_m: toNumber(row.road_width_m),
    is_paved: row.is_paved,
    bus_accessible: row.bus_accessible,
    entrance_passage_type: row.entrance_passage_type.trim() || null,
    entrance_lock_type: row.entrance_lock_type.trim() || null,
    bore_type: row.bore_type || '복선',
    use_as_baseline_anchor: row.use_as_baseline_anchor,
    is_active: row.is_active,
    note: row.note.trim() || null,
  };
}

// ── 노선 목록 (1단계) ─────────────────────────────────────────────────────────

function FacilityRouteListView({ onSelect }: { onSelect: (r: RouteListSummary) => void }) {
  const [search, setSearch] = useState('');
  const [lineFilter, setLineFilter] = useState<'all' | '고속선' | '일반선' | '기지'>('all');

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['route-summaries'],
    queryFn: fetchRouteSummaries,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => routes.filter(r => {
    if (lineFilter !== 'all' && r.line_type !== lineFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return r.name.toLowerCase().includes(q)
        || (r.korail_route_code ?? '').toLowerCase().includes(q)
        || (r.start_station_name ?? '').toLowerCase().includes(q)
        || (r.end_station_name ?? '').toLowerCase().includes(q);
    }
    return true;
  }), [routes, lineFilter, search]);

  const totalFacility = routes.reduce((s, r) => s + r.facility_total, 0);

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <h1 className="text-lg font-semibold text-gray-800">시설물 관리</h1>
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
          className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">전체 구분</option>
          <option value="고속선">고속선</option>
          <option value="일반선">일반선</option>
          <option value="기지">기지</option>
        </select>
        <span className="text-sm text-gray-400 ml-auto">
          표시 {filtered.length.toLocaleString()}개 / 전체 {routes.length.toLocaleString()}개
        </span>
      </div>

      <div className="flex gap-3 shrink-0">
        {[
          { label: '노선 수', val: routes.length, cls: 'bg-blue-50 text-blue-700' },
          { label: '전체 시설물', val: totalFacility, cls: 'bg-green-50 text-green-700' },
        ].map(item => (
          <div key={item.label} className={`rounded-lg border px-4 py-2.5 ${item.cls}`}>
            <div className="text-xs opacity-70">{item.label}</div>
            <div className="text-lg font-bold">{item.val.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['노선코드', '노선명', '구분', '시종점', 'KP 범위', '시설물 수', 'GPS'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">조회 중...</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">검색 결과가 없습니다.</td></tr>
            )}
            {!isLoading && filtered.map(r => (
              <tr key={r.id} onClick={() => onSelect(r)}
                className="border-b hover:bg-blue-50 cursor-pointer transition-colors">
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
                  <span className={`px-2 py-0.5 rounded-full text-xs ${r.facility_total > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {r.facility_total}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-center">
                  <span className="px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-600">{r.facility_gps}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 시설물 상세 (2단계) — 기존 로직 래핑 ─────────────────────────────────────

function FacilityDetailWrapper({
  initialRouteId,
  onBack,
}: {
  initialRouteId: number;
  onBack: () => void;
}) {
  return <FacilitiesDetailPage initialRouteId={initialRouteId} onBack={onBack} />;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

export default function FacilitiesAdminPage() {
  const [selectedListRoute, setSelectedListRoute] = useState<RouteListSummary | null>(null);

  if (selectedListRoute) {
    return (
      <div className="h-full flex flex-col p-6 overflow-hidden">
        <FacilityDetailWrapper
          initialRouteId={selectedListRoute.id}
          onBack={() => setSelectedListRoute(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <FacilityRouteListView onSelect={setSelectedListRoute} />
    </div>
  );
}

function FacilitiesDetailPage({
  initialRouteId,
  onBack,
}: {
  initialRouteId: number;
  onBack: () => void;
}) {
  const qc = useQueryClient();

  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(initialRouteId);
  const [majorFilter, setMajorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [editingId, setEditingId] = useState<EditId>(null);
  const [editRow, setEditRow] = useState<EditRow>(emptyRow([]));
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [uploadResult, setUploadResult] = useState<BulkUploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: routes = [], isLoading: routesLoading } = useQuery({
    queryKey: ['reference-routes'],
    queryFn: fetchReferenceRoutes,
  });

  const { data: classifications = [] } = useQuery({
    queryKey: ['facility-classifications'],
    queryFn: fetchFacilityClassifications,
  });

  useEffect(() => {
    if (selectedRouteId == null && routes.length > 0) {
      setSelectedRouteId(routes[0].id);
    }
  }, [routes, selectedRouteId]);

  const { data: facilities = [], isLoading: facilitiesLoading } = useQuery({
    queryKey: ['rail-facilities', selectedRouteId],
    queryFn: () => fetchRailFacilities(selectedRouteId as number),
    enabled: selectedRouteId != null,
  });

  const classificationMap = useMemo(
    () => new Map(classifications.map((classification) => [classification.id, classification])),
    [classifications],
  );

  const majorCategories = useMemo(
    () => Array.from(new Set(classifications.map((classification) => classification.major_category))),
    [classifications],
  );

  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? null;
  const filteredFacilities = facilities.filter((facility) => {
    const matchesMajor = majorFilter === 'all' || facility.major_category === majorFilter;
    const matchesStatus =
      statusFilter === 'all'
      || (statusFilter === 'active' && facility.is_active)
      || (statusFilter === 'inactive' && !facility.is_active);
    return matchesMajor && matchesStatus;
  });

  const activeCount = facilities.filter((facility) => facility.is_active).length;
  const gpsCount = facilities.filter((facility) => facility.lat != null && facility.lon != null).length;
  const interpolatedCount = facilities.filter((facility) => facility.lat == null || facility.lon == null).length;
  const anchorCount = facilities.filter((facility) => facility.use_as_baseline_anchor).length;

  function showNotice(type: 'ok' | 'err', msg: string) {
    setNotice({ type, msg });
    setTimeout(() => setNotice(null), 3500);
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['rail-facilities', selectedRouteId] });
    qc.invalidateQueries({ queryKey: ['reference-summary'] });
    qc.invalidateQueries({ queryKey: ['reference-routes'] });
  }

  const createMut = useMutation({
    mutationFn: (payload: RailFacilityInput) => createRailFacility(selectedRouteId as number, payload),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setEditRow(emptyRow(classifications));
      showNotice('ok', '시설물이 등록되었습니다.');
    },
    onError: (error) => showNotice('err', errorMessage(error)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RailFacilityInput }) => updateRailFacility(id, payload),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      showNotice('ok', '시설물이 수정되었습니다.');
    },
    onError: (error) => showNotice('err', errorMessage(error)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteRailFacility,
    onSuccess: () => {
      invalidate();
      showNotice('ok', '시설물이 삭제되었습니다.');
    },
    onError: (error) => showNotice('err', errorMessage(error)),
  });

  function startNew() {
    setEditingId('new');
    setEditRow(emptyRow(classifications));
  }

  function startEdit(facility: RailFacility) {
    setEditingId(facility.id);
    setEditRow(rowFromFacility(facility));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditRow(emptyRow(classifications));
  }

  function saveEdit() {
    const classification = editRow.classification_id === ''
      ? undefined
      : classificationMap.get(editRow.classification_id);
    const payload = buildPayload(editRow, classification);
    if (!payload) {
      showNotice('err', classification?.geometry_type === 'linear'
        ? '시설물명, 분류, 시작 KP, 종료 KP를 확인하세요.'
        : '시설물명, 분류, 시작 KP를 확인하세요.');
      return;
    }
    if (editingId === 'new') {
      createMut.mutate(payload);
    } else if (typeof editingId === 'number') {
      updateMut.mutate({ id: editingId, payload });
    }
  }

  function handleDelete(facility: RailFacility) {
    if (!confirm(`삭제하시겠습니까?\n${facility.name}`)) return;
    deleteMut.mutate(facility.id);
  }

  function setField<K extends keyof EditRow>(key: K, value: EditRow[K]) {
    setEditRow((prev) => ({ ...prev, [key]: value }));
  }

  async function handleDownloadTemplate() {
    if (!selectedRouteId) return;
    try {
      const blob = await downloadFacilityTemplate(selectedRouteId);
      const route = routes.find((r) => r.id === selectedRouteId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facilities_${route?.korail_route_code ?? selectedRouteId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showNotice('err', '양식 다운로드에 실패했습니다.');
    }
  }

  const uploadMut = useMutation({
    mutationFn: (file: File) => bulkUploadFacilities(selectedRouteId as number, file),
    onSuccess: (result) => {
      invalidate();
      setUploadResult(result);
      if (result.errors.length === 0) {
        showNotice('ok', `${result.success}건 등록 완료`);
      } else {
        showNotice('ok', `${result.success}건 등록, ${result.errors.length}건 오류`);
      }
    },
    onError: (error) => showNotice('err', errorMessage(error)),
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadResult(null);
    uploadMut.mutate(file);
    event.target.value = '';
  }

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium shrink-0"
        >
          ← 목록
        </button>
        <h1 className="text-lg font-semibold text-gray-800">시설물 관리</h1>
        <select
          value={selectedRouteId ?? ''}
          onChange={(event) => {
            setSelectedRouteId(Number(event.target.value));
            cancelEdit();
          }}
          className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 min-w-52"
        >
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.name} · {route.korail_route_code}
            </option>
          ))}
        </select>
        <select
          value={majorFilter}
          onChange={(event) => setMajorFilter(event.target.value)}
          className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">전체 분류</option>
          {majorCategories.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          className="border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">전체 상태</option>
          <option value="active">사용</option>
          <option value="inactive">미사용</option>
        </select>
        <span className="text-sm text-gray-400">
          {routesLoading ? '노선 조회 중...' : `표시 ${filteredFacilities.length.toLocaleString()}개 / 전체 ${facilities.length.toLocaleString()}개`}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={handleDownloadTemplate}
            disabled={!selectedRoute}
            className="px-3 py-2 text-sm border border-gray-400 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            양식 다운로드
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!selectedRoute || uploadMut.isPending}
            className="px-3 py-2 text-sm border border-green-600 text-green-600 rounded-lg hover:bg-green-50 disabled:opacity-50"
          >
            {uploadMut.isPending ? 'CSV 업로드 중...' : 'CSV 업로드'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={startNew}
            disabled={!selectedRoute || classifications.length === 0 || editingId === 'new'}
            className="px-3 py-2 text-sm border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
          >
            + 시설물 추가
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap shrink-0">
        <span className="px-2.5 py-1 rounded-full text-xs bg-slate-50 text-slate-700 border border-slate-200">
          {selectedRoute ? selectedRoute.name : '노선 미선택'}
        </span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-green-50 text-green-700 border border-green-100">
          사용 {activeCount.toLocaleString()}개
        </span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-100">
          GPS {gpsCount.toLocaleString()}개
        </span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-100">
          KP 보간 {interpolatedCount.toLocaleString()}개
        </span>
        <span className="px-2.5 py-1 rounded-full text-xs bg-purple-50 text-purple-700 border border-purple-100">
          기준선 앵커 {anchorCount.toLocaleString()}개
        </span>
      </div>

      {notice && (
        <div className={`px-4 py-2 rounded-lg text-sm shrink-0 ${
          notice.type === 'ok'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {notice.msg}
        </div>
      )}
      {uploadResult && uploadResult.errors.length > 0 && (
        <div className="px-4 py-3 rounded-lg text-xs bg-amber-50 border border-amber-200 shrink-0 max-h-36 overflow-y-auto">
          <div className="font-medium text-amber-700 mb-1">업로드 오류 ({uploadResult.errors.length}건)</div>
          {uploadResult.errors.map((err, i) => (
            <div key={i} className="text-amber-600">{err}</div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['상태', '대분류', '세부분류', '시설물명', 'KP', 'GPS', '종료 GPS', '방향', '기준선', '소속', '비고', '작업'].map((header) => (
                <th key={header} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editingId === 'new' && (
              <EditRow
                row={editRow}
                classifications={classifications}
                onChange={setField}
                onCancel={cancelEdit}
                onSave={saveEdit}
                isPending={createMut.isPending}
              />
            )}
            {facilitiesLoading && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-gray-400">
                  조회 중...
                </td>
              </tr>
            )}
            {!facilitiesLoading && filteredFacilities.length === 0 && editingId !== 'new' && (
              <tr>
                <td colSpan={12} className="px-4 py-10 text-center text-gray-400">
                  등록된 시설물이 없습니다.
                </td>
              </tr>
            )}
            {!facilitiesLoading && filteredFacilities.map((facility) => (
              editingId === facility.id ? (
                <EditRow
                  key={facility.id}
                  row={editRow}
                  classifications={classifications}
                  onChange={setField}
                  onCancel={cancelEdit}
                  onSave={saveEdit}
                  isPending={updateMut.isPending}
                />
              ) : (
                <tr key={facility.id} className="border-b hover:bg-blue-50 transition-colors">
                  <td className="px-3 py-2.5">
                    {facility.is_active ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">사용</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">미사용</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${MAJOR_COLORS[facility.major_category] ?? 'bg-gray-100 text-gray-600'}`}>
                      {facility.major_category}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                    {[facility.sub_category, facility.detail_category, facility.tertiary_category].filter(Boolean).join(' / ')}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                    {facility.name}
                    {facility.facility_code && <span className="ml-1 text-xs text-gray-400">{facility.facility_code}</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-600 whitespace-nowrap">{kpRange(facility)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500 whitespace-nowrap">{formatGps(facility.lat, facility.lon)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-500 whitespace-nowrap">{formatGps(facility.lat_end, facility.lon_end)}</td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{DIRECTION_LABELS[facility.direction ?? ''] ?? facility.direction}</td>
                  <td className="px-3 py-2.5">
                    {facility.use_as_baseline_anchor ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700">앵커</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">보간</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
                    {facility.management_office_name ?? facility.management_region_name ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-400 max-w-44 truncate">{facility.note ?? ''}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(facility)} className="text-xs text-blue-600 hover:underline">수정</button>
                      <button onClick={() => handleDelete(facility)} className="text-xs text-red-600 hover:underline">삭제</button>
                    </div>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditRow({
  row,
  classifications,
  onChange,
  onCancel,
  onSave,
  isPending,
}: {
  row: EditRow;
  classifications: RailFacilityClassification[];
  onChange: <K extends keyof EditRow>(key: K, value: EditRow[K]) => void;
  onCancel: () => void;
  onSave: () => void;
  isPending: boolean;
}) {
  const inputCls = 'h-8 border rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 w-full bg-white';
  const selectedClassification = row.classification_id === ''
    ? undefined
    : classifications.find((classification) => classification.id === row.classification_id);
  const isLinear = selectedClassification?.geometry_type === 'linear';
  const isGate    = selectedClassification?.sub_category === '선로출입문';
  const isTunnel  = isLinear && selectedClassification?.sub_category === '터널';
  const isBridge  = isLinear && (selectedClassification?.sub_category === '교량' || selectedClassification?.sub_category === '과선교');
  const needsBoreType = isTunnel || isBridge;

  return (
    <tr className="border-b bg-blue-50">
      <td colSpan={12} className="p-3">
        <div className="grid grid-cols-2 lg:grid-cols-6 xl:grid-cols-12 gap-2 items-end">
          <label className="text-xs text-gray-500 xl:col-span-2">
            분류
            <select
              value={row.classification_id}
              onChange={(event) => {
                const newId = Number(event.target.value);
                onChange('classification_id', newId);
                const cls = classifications.find((c) => c.id === newId);
                if (cls?.sub_category === '선로출입문') {
                  onChange('direction', cls.detail_category === '상선' ? 'UP' : 'DOWN');
                }
              }}
              className={`${inputCls} mt-1`}
            >
              {Object.entries(
                classifications
                  .filter((c) => c.is_active)
                  .reduce<Record<string, RailFacilityClassification[]>>((acc, c) => {
                    if (!acc[c.major_category]) acc[c.major_category] = [];
                    acc[c.major_category].push(c);
                    return acc;
                  }, {}),
              ).map(([major, items]) => (
                <optgroup key={major} label={major}>
                  {items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {classificationSubLabel(c)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500 xl:col-span-2">
            시설물명
            <input
              value={row.name}
              onChange={(event) => onChange('name', event.target.value)}
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className="text-xs text-gray-500">
            시설코드
            <input
              value={row.facility_code}
              onChange={(event) => onChange('facility_code', event.target.value)}
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className="text-xs text-gray-500">
            시작 KP
            <input
              value={row.kp_start}
              onChange={(event) => onChange('kp_start', event.target.value)}
              type="number"
              step="0.001"
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className="text-xs text-gray-500">
            종료 KP
            <input
              value={row.kp_end}
              onChange={(event) => onChange('kp_end', event.target.value)}
              type="number"
              step="0.001"
              placeholder={isLinear ? '' : '—'}
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className="text-xs text-gray-500">
            위도
            <input value={row.lat} onChange={(event) => onChange('lat', event.target.value)} type="number" step="0.000001" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-gray-500">
            경도
            <input value={row.lon} onChange={(event) => onChange('lon', event.target.value)} type="number" step="0.000001" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-gray-500">
            종료 위도
            <input value={row.lat_end} onChange={(event) => onChange('lat_end', event.target.value)} type="number" step="0.000001" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-gray-500">
            종료 경도
            <input value={row.lon_end} onChange={(event) => onChange('lon_end', event.target.value)} type="number" step="0.000001" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-gray-500">
            방향
            <select
              value={row.direction}
              onChange={(event) => onChange('direction', event.target.value)}
              disabled={isGate}
              className={`${inputCls} mt-1 ${isGate ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
            >
              {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            구간 시작역
            <input value={row.section_from} onChange={(e) => onChange('section_from', e.target.value)} placeholder="예: 오송역" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-gray-500">
            구간 종료역
            <input value={row.section_to} onChange={(e) => onChange('section_to', e.target.value)} placeholder="예: 천안아산역" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-gray-500 xl:col-span-2">
            주소
            <input value={row.address} onChange={(e) => onChange('address', e.target.value)} className={`${inputCls} mt-1`} />
          </label>

          {isGate && (
            <>
              <label className="text-xs text-gray-500">
                도로폭 (m)
                <input value={row.road_width_m} onChange={(e) => onChange('road_width_m', e.target.value)} type="number" step="0.1" min="0" className={`${inputCls} mt-1`} />
              </label>
              <label className="text-xs text-gray-500">
                통로 형태
                <input value={row.entrance_passage_type} onChange={(e) => onChange('entrance_passage_type', e.target.value)} placeholder="예: 직선통로" className={`${inputCls} mt-1`} />
              </label>
              <label className="text-xs text-gray-500">
                잠금방식
                <select value={row.entrance_lock_type} onChange={(e) => onChange('entrance_lock_type', e.target.value)} className={`${inputCls} mt-1`}>
                  <option value="">—</option>
                  <option value="번호키">번호키</option>
                  <option value="일반열쇠">일반열쇠</option>
                  <option value="전자키">전자키</option>
                  <option value="기타">기타</option>
                </select>
              </label>
              <label className="h-8 flex items-center gap-2 text-xs text-gray-600 mt-4">
                <input
                  type="checkbox"
                  checked={row.is_paved === true}
                  onChange={(e) => onChange('is_paved', e.target.checked ? true : null)}
                />
                포장
              </label>
              <label className="h-8 flex items-center gap-2 text-xs text-gray-600 mt-4">
                <input
                  type="checkbox"
                  checked={row.bus_accessible === true}
                  onChange={(e) => onChange('bus_accessible', e.target.checked ? true : null)}
                />
                버스 진입
              </label>
            </>
          )}

          <label className="text-xs text-gray-500 xl:col-span-2">
            비고
            <input value={row.note} onChange={(event) => onChange('note', event.target.value)} className={`${inputCls} mt-1`} />
          </label>
          {needsBoreType && (
            <label className="text-xs text-gray-500 xl:col-span-2">
              선로 적용 방식
              <select
                value={row.bore_type}
                onChange={(e) => onChange('bore_type', e.target.value)}
                className={`${inputCls} mt-1`}
              >
                <option value="복선">복선 (상·하선 한 구조물)</option>
                <option value="단선_상선">단선 — 상선 전용</option>
                <option value="단선_하선">단선 — 하선 전용</option>
              </select>
            </label>
          )}
          <label className="h-8 flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={row.use_as_baseline_anchor}
              onChange={(event) => onChange('use_as_baseline_anchor', event.target.checked)}
            />
            기준선 앵커
          </label>
          <label className="h-8 flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={row.is_active}
              onChange={(event) => onChange('is_active', event.target.checked)}
            />
            사용
          </label>
          <div className="flex gap-2 justify-end xl:col-span-2">
            <button
              onClick={onSave}
              disabled={isPending}
              className="h-8 px-3 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              저장
            </button>
            <button
              onClick={onCancel}
              disabled={isPending}
              className="h-8 px-3 text-xs border rounded hover:bg-white disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}
