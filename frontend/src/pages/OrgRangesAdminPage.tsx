import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import {
  fetchOrganizations,
  fetchRouteRanges,
  createRouteRange,
  updateRouteRange,
  deleteRouteRange,
  type RouteRange,
} from '../api/organizations';
import { fetchReferenceRoutes, type RailReferenceRoute } from '../api/railReference';

const ALL_FIELDS = ['all', '시설', '전기', '건축'] as const;
const FIELD_LABEL: Record<string, string> = {
  all: '전체(행정)',
  시설: '시설',
  전기: '전기',
  건축: '건축',
};

interface EditRow {
  rail_route_id: number | '';
  field: string;
  start_km: number | '';
  end_km: number | '';
}

const EMPTY_ROW: EditRow = { rail_route_id: '', field: 'all', start_km: '', end_km: '' };

const INPUT_CLS =
  'h-8 border rounded px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-full';
const SELECT_CLS =
  'h-8 border rounded px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-full bg-white';

// ── 검색형 노선 셀렉터 ────────────────────────────────────────────────────────

interface RouteSearchSelectProps {
  value: number | '';
  routes: RailReferenceRoute[];
  onChange: (id: number | '') => void;
}

function RouteSearchSelect({ value, routes, onChange }: RouteSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const sorted = [...routes].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const filtered = query.trim()
    ? sorted.filter(r =>
        r.name.includes(query.trim()) ||
        (r.korail_route_code ?? '').toLowerCase().includes(query.trim().toLowerCase())
      )
    : sorted;

  const selected = routes.find(r => r.id === value);

  function handleSelect(r: RailReferenceRoute) {
    onChange(r.id);
    setOpen(false);
    setQuery('');
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!ref.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={ref} className="relative" onBlur={handleBlur}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`${INPUT_CLS} text-left flex items-center justify-between pr-2`}
      >
        <span className={selected ? 'text-gray-800' : 'text-gray-400'}>
          {selected ? selected.name : '노선 선택'}
        </span>
        <span className="text-gray-400 text-xs ml-1">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 w-64 bg-white border rounded shadow-lg mt-0.5">
          <div className="p-1.5 border-b">
            <input
              autoFocus
              type="text"
              placeholder="노선명 또는 코드 검색..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="overflow-auto max-h-52">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">검색 결과 없음</div>
            )}
            {filtered.map(r => (
              <button
                key={r.id}
                type="button"
                onMouseDown={() => handleSelect(r)}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 flex items-center justify-between ${
                  r.id === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-800'
                }`}
              >
                <span>{r.name}</span>
                <span className="text-xs text-gray-400 font-mono ml-2">{r.korail_route_code}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function OrgRangesAdminPage() {
  const qc = useQueryClient();

  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [editRow, setEditRow] = useState<EditRow>(EMPTY_ROW);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  function showNotice(type: 'ok' | 'err', msg: string) {
    setNotice({ type, msg });
    setTimeout(() => setNotice(null), 4000);
  }

  const { data: organizations = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: fetchOrganizations,
  });

  const { data: railRoutes = [] } = useQuery({
    queryKey: ['reference-routes'],
    queryFn: fetchReferenceRoutes,
    staleTime: 60_000,
  });

  const allRangeQueries = useQuery({
    queryKey: ['route-ranges-all'],
    queryFn: async () => {
      const results = await Promise.all(
        organizations.map((o) => fetchRouteRanges(o.id).then((r) => ({ id: o.id, count: r.length })))
      );
      return Object.fromEntries(results.map((r) => [r.id, r.count]));
    },
    enabled: organizations.length > 0 && selectedOrgId === null,
    staleTime: 30_000,
  });

  const { data: ranges = [], isLoading } = useQuery({
    queryKey: ['route-ranges', selectedOrgId],
    queryFn: () => fetchRouteRanges(selectedOrgId!),
    enabled: selectedOrgId !== null,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['route-ranges', selectedOrgId] });
    qc.invalidateQueries({ queryKey: ['route-ranges-all'] });
  }

  const createMut = useMutation({
    mutationFn: (row: EditRow) =>
      createRouteRange(selectedOrgId!, {
        rail_route_id: row.rail_route_id as number,
        field: row.field,
        start_km: row.start_km as number,
        end_km: row.end_km as number,
      }),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setEditRow(EMPTY_ROW);
      showNotice('ok', '구간이 추가되었습니다.');
    },
    onError: (e: AxiosError<{ detail: string }>) => {
      showNotice('err', e.response?.data?.detail ?? '추가에 실패했습니다.');
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, row }: { id: number; row: EditRow }) =>
      updateRouteRange(selectedOrgId!, id, {
        rail_route_id: row.rail_route_id as number,
        field: row.field,
        start_km: row.start_km as number,
        end_km: row.end_km as number,
      }),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setEditRow(EMPTY_ROW);
      showNotice('ok', '구간이 수정되었습니다.');
    },
    onError: (e: AxiosError<{ detail: string }>) => {
      showNotice('err', e.response?.data?.detail ?? '수정에 실패했습니다.');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (rangeId: number) => deleteRouteRange(selectedOrgId!, rangeId),
    onSuccess: () => {
      invalidate();
      showNotice('ok', '구간이 삭제되었습니다.');
    },
    onError: () => showNotice('err', '삭제에 실패했습니다.'),
  });

  function startNew() {
    setEditingId('new');
    setEditRow(EMPTY_ROW);
  }

  function startEdit(r: RouteRange) {
    setEditingId(r.id);
    setEditRow({ rail_route_id: r.rail_route_id, field: r.field, start_km: r.start_km, end_km: r.end_km });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditRow(EMPTY_ROW);
  }

  function saveEdit() {
    if (editRow.rail_route_id === '') { showNotice('err', '노선을 선택하세요.'); return; }
    if (editRow.start_km === '' || editRow.end_km === '') { showNotice('err', 'km 값을 입력하세요.'); return; }
    if ((editRow.start_km as number) >= (editRow.end_km as number)) {
      showNotice('err', '시작 km은 종료 km보다 작아야 합니다.'); return;
    }
    if (editingId === 'new') createMut.mutate(editRow);
    else if (typeof editingId === 'number') updateMut.mutate({ id: editingId, row: editRow });
  }

  function handleDelete(r: RouteRange) {
    if (!confirm(`삭제하시겠습니까?\n${r.route_name} / ${FIELD_LABEL[r.field] ?? r.field} (${r.start_km} ~ ${r.end_km} km)`)) return;
    deleteMut.mutate(r.id);
  }

  function setField<K extends keyof EditRow>(key: K, value: EditRow[K]) {
    setEditRow((prev) => ({ ...prev, [key]: value }));
  }

  const selectedOrg = organizations.find((o) => o.id === selectedOrgId);

  // ── 조직 목록 화면 ──────────────────────────────────────────────────────
  if (selectedOrgId === null) {
    return (
      <div className="h-full flex flex-col p-6 overflow-hidden">
        <h1 className="text-lg font-semibold text-gray-800 mb-4 shrink-0">지역본부 경계/담당구역 관리</h1>
        <div className="flex-1 overflow-auto border rounded-lg">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                {['조직명', '관할구간 수', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {organizations.map((org) => {
                const count = allRangeQueries.data?.[org.id];
                return (
                  <tr
                    key={org.id}
                    onClick={() => setSelectedOrgId(org.id)}
                    className="border-b hover:bg-blue-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">{org.name}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {count !== undefined ? `${count}건` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-blue-600">관리 →</span>
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

  // ── 구간 편집 화면 ──────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">

      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setSelectedOrgId(null); setEditingId(null); setEditRow(EMPTY_ROW); setNotice(null); }}
            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
          >
            ← 목록
          </button>
          <h1 className="text-lg font-semibold text-gray-800">{selectedOrg?.name}</h1>
          <span className="text-sm text-gray-500">
            {isLoading ? '조회 중...' : `총 ${ranges.length}건`}
          </span>
        </div>
        {editingId !== 'new' && (
          <button
            onClick={startNew}
            className="h-9 px-4 text-sm border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 font-medium transition-colors"
          >
            + 구간 추가
          </button>
        )}
      </div>

      {/* 알림 배너 */}
      {notice && (
        <div className={`mb-3 px-4 py-2 rounded text-sm shrink-0 ${
          notice.type === 'ok'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {notice.msg}
        </div>
      )}

      {/* 테이블 */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['노선', '분야', '시작 km', '종료 km', '작업'].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editingId === 'new' && (
              <tr className="border-b bg-blue-50">
                <EditCells row={editRow} railRoutes={railRoutes} setField={setField} />
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <SaveCancelButtons onSave={saveEdit} onCancel={cancelEdit} />
                </td>
              </tr>
            )}
            {ranges.length === 0 && editingId !== 'new' ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-gray-400">
                  {isLoading ? '불러오는 중...' : '등록된 담당구역이 없습니다.'}
                </td>
              </tr>
            ) : (
              ranges.map((r) =>
                editingId === r.id ? (
                  <tr key={r.id} className="border-b bg-blue-50">
                    <EditCells row={editRow} railRoutes={railRoutes} setField={setField} />
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <SaveCancelButtons onSave={saveEdit} onCancel={cancelEdit} />
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{r.route_name}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><FieldBadge field={r.field} /></td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.start_km}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.end_km}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex gap-3">
                        <button onClick={() => startEdit(r)} className="text-xs text-blue-600 hover:underline">수정</button>
                        <button onClick={() => handleDelete(r)} className="text-xs text-red-500 hover:underline">삭제</button>
                      </div>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 유틸 컴포넌트 ─────────────────────────────────────────────────────────────

interface EditCellsProps {
  row: EditRow;
  railRoutes: RailReferenceRoute[];
  setField: <K extends keyof EditRow>(key: K, value: EditRow[K]) => void;
}

function EditCells({ row, railRoutes, setField }: EditCellsProps) {
  return (
    <>
      <td className="px-3 py-1.5" style={{ minWidth: '160px' }}>
        <RouteSearchSelect
          value={row.rail_route_id}
          routes={railRoutes}
          onChange={(id) => setField('rail_route_id', id)}
        />
      </td>
      <td className="px-3 py-1.5">
        <select value={row.field} onChange={(e) => setField('field', e.target.value)} className={SELECT_CLS}>
          {ALL_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <input type="number" step="0.1" min="0" value={row.start_km} onChange={(e) => setField('start_km', e.target.value === '' ? '' : Number(e.target.value))} placeholder="0.0" className={INPUT_CLS} />
      </td>
      <td className="px-3 py-1.5">
        <input type="number" step="0.1" min="0" value={row.end_km} onChange={(e) => setField('end_km', e.target.value === '' ? '' : Number(e.target.value))} placeholder="0.0" className={INPUT_CLS} />
      </td>
    </>
  );
}

function SaveCancelButtons({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex gap-2">
      <button onClick={onSave} className="text-xs text-blue-600 hover:underline font-medium">저장</button>
      <button onClick={onCancel} className="text-xs text-gray-500 hover:underline">취소</button>
    </div>
  );
}

const FIELD_BADGE: Record<string, string> = {
  all: 'bg-gray-100 text-gray-600',
  시설: 'bg-indigo-100 text-indigo-700',
  전기: 'bg-yellow-100 text-yellow-700',
  건축: 'bg-emerald-100 text-emerald-700',
};

function FieldBadge({ field }: { field: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FIELD_BADGE[field] ?? 'bg-gray-100 text-gray-600'}`}>
      {FIELD_LABEL[field] ?? field}
    </span>
  );
}
