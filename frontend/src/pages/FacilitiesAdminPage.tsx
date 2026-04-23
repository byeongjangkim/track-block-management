import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAdminFacilities,
  createFacility,
  updateFacility,
  deleteFacility,
  uploadCsv,
  deployRoute,
  downloadCsvTemplate,
} from '../api/admin';
import type { FacilityResponse } from '../api/adminTypes';
import { fetchRoutes } from '../api/routes';

const FACILITY_TYPES = ['STATION', 'GENERAL_STATION', 'CROSSING', 'OVERPASS', 'SUBSTATION', 'TUNNEL', 'BRIDGE', 'JUNCTION', 'BOUNDARY'];
const TYPE_LABELS: Record<string, string> = {
  STATION: '관리역', GENERAL_STATION: '일반역', CROSSING: '건널목', OVERPASS: '과선교',
  SUBSTATION: '변전소', TUNNEL: '터널', BRIDGE: '교량', JUNCTION: '분기', BOUNDARY: '경계',
};
const DIRECTIONS = ['', 'UP', 'DOWN', 'BOTH'];
const DIRECTION_LABELS: Record<string, string> = { '': '—', UP: '상선', DOWN: '하선', BOTH: '상하선' };
const BOUNDARIES = ['', '본부', '시설', '전기', '건축'];
const BOUNDARY_COLORS: Record<string, string> = {
  '본부': 'bg-red-100 text-red-700',
  '시설': 'bg-blue-100 text-blue-700',
  '전기': 'bg-yellow-100 text-yellow-700',
  '건축': 'bg-purple-100 text-purple-700',
};

export default function FacilitiesAdminPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: fetchRoutes });
  const [routeCode, setRouteCode] = useState('');
  const selectedRoute = routes.find(r => r.code === routeCode) ?? routes[0] ?? null;
  const activeCode = routeCode || selectedRoute?.code || '';

  const { data: facilities = [], isLoading } = useQuery({
    queryKey: ['admin-facilities', activeCode],
    queryFn: () => fetchAdminFacilities(activeCode),
    enabled: !!activeCode,
  });

  // 편집 상태
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [editRow, setEditRow] = useState<Omit<FacilityResponse, 'id' | 'route_id'>>(EMPTY_ROW);

  // 알림
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  function showNotice(type: 'ok' | 'err', msg: string) {
    setNotice({ type, msg });
    setTimeout(() => setNotice(null), 4000);
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-facilities', activeCode] });

  const createMut  = useMutation({ mutationFn: (b: typeof EMPTY_ROW) => createFacility(activeCode, b), onSuccess: () => { invalidate(); setEditingId(null); } });
  const updateMut  = useMutation({ mutationFn: ({ id, b }: { id: number; b: Partial<typeof EMPTY_ROW> }) => updateFacility(id, b), onSuccess: () => { invalidate(); setEditingId(null); } });
  const deleteMut  = useMutation({ mutationFn: deleteFacility, onSuccess: invalidate });
  const deployMut  = useMutation({
    mutationFn: () => deployRoute(activeCode),
    onSuccess: (r) => showNotice('ok', `배포 완료 — 앵커 ${r.anchor_count}개, 시설물 ${r.facility_count}개`),
    onError:   () => showNotice('err', '배포 중 오류 발생'),
  });
  const uploadMut  = useMutation({
    mutationFn: (file: File) => uploadCsv(activeCode, file),
    onSuccess: (r) => {
      invalidate();
      const warn = r.errors.length ? `\n오류 ${r.errors.length}건` : '';
      showNotice('ok', `CSV 적용 완료 — ${r.facility_count}개 시설물, 앵커 ${r.anchor_count}개${warn}`);
    },
    onError: () => showNotice('err', 'CSV 업로드 실패'),
  });

  function startEdit(f: FacilityResponse) {
    setEditingId(f.id);
    setEditRow({ type: f.type, name: f.name, km: f.km, km_end: f.km_end, lat: f.lat, lon: f.lon, lat_end: f.lat_end, lon_end: f.lon_end, direction: f.direction, boundary: f.boundary, has_station_map: f.has_station_map, use_as_anchor: f.use_as_anchor, note: f.note });
  }

  function startNew() {
    setEditingId('new');
    setEditRow({ ...EMPTY_ROW });
  }

  function saveEdit() {
    if (!editRow.name.trim()) { showNotice('err', '이름을 입력하세요'); return; }
    if (editingId === 'new') createMut.mutate(editRow);
    else if (typeof editingId === 'number') updateMut.mutate({ id: editingId, b: editRow });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMut.mutate(file);
    e.target.value = '';
  }

  function setField<K extends keyof typeof EMPTY_ROW>(k: K, v: (typeof EMPTY_ROW)[K]) {
    setEditRow(r => ({ ...r, [k]: v }));
  }

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-hidden">

      {/* 상단 툴바 */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <div>
          <label className="text-xs text-gray-500 mr-1">노선</label>
          <select
            value={activeCode}
            onChange={e => setRouteCode(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {routes.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select>
        </div>

        <div className="flex gap-2 ml-auto flex-wrap">
          {/* CSV 업로드 */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMut.isPending}
            className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50"
          >
            {uploadMut.isPending ? '업로드 중...' : 'CSV 업로드'}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />

          {/* CSV 템플릿 다운로드 */}
          <button
            onClick={() => downloadCsvTemplate(activeCode).catch(() => showNotice('err', '템플릿 다운로드 실패'))}
            className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 text-gray-600"
          >
            템플릿 다운로드
          </button>

          {/* 행 추가 */}
          <button
            onClick={startNew}
            className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 text-gray-600"
          >
            + 행 추가
          </button>

          {/* 배포 */}
          <button
            onClick={() => deployMut.mutate()}
            disabled={deployMut.isPending || facilities.length === 0}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {deployMut.isPending ? '배포 중...' : '노선도 배포'}
          </button>
        </div>
      </div>

      {/* 알림 */}
      {notice && (
        <div className={`px-4 py-2 rounded-lg text-sm shrink-0 ${notice.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
          {notice.msg}
        </div>
      )}

      {/* 안내 */}
      <p className="text-xs text-gray-400 shrink-0">
        CSV 업로드 또는 직접 입력 후 <strong>노선도 배포</strong> 버튼을 눌러야 지도에 반영됩니다.
        총 {facilities.length}개 시설물
      </p>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['종류', '이름', '시작km', '종료km', '시작위도', '시작경도', '종료위도', '종료경도', '방향', '경계구분', '역배선도', '앵커', '비고', ''].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 신규 추가 행 */}
            {editingId === 'new' && (
              <EditRow
                row={editRow}
                onChange={setField}
                onSave={saveEdit}
                onCancel={() => setEditingId(null)}
                isPending={createMut.isPending}
              />
            )}

            {isLoading ? (
              <tr><td colSpan={14} className="text-center py-10 text-gray-400">불러오는 중...</td></tr>
            ) : facilities.length === 0 ? (
              <tr><td colSpan={14} className="text-center py-10 text-gray-400">시설물이 없습니다. CSV를 업로드하거나 행을 추가하세요.</td></tr>
            ) : (
              facilities.map(f => (
                editingId === f.id ? (
                  <EditRow
                    key={f.id}
                    row={editRow}
                    onChange={setField}
                    onSave={saveEdit}
                    onCancel={() => setEditingId(null)}
                    isPending={updateMut.isPending}
                  />
                ) : (
                  <tr key={f.id} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <TypeBadge type={f.type} />
                    </td>
                    <td className="px-3 py-2 font-medium">{f.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{f.km.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{f.km_end != null ? f.km_end.toFixed(1) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{f.lat ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{f.lon ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{f.lat_end ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-400">{f.lon_end ?? '—'}</td>
                    <td className="px-3 py-2 text-center text-xs text-gray-500">{f.direction ? DIRECTION_LABELS[f.direction] ?? f.direction : '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {f.boundary ? (
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${BOUNDARY_COLORS[f.boundary] ?? 'bg-gray-100 text-gray-600'}`}>
                          {f.boundary}
                        </span>
                      ) : ''}
                    </td>
                    <td className="px-3 py-2 text-center">{f.has_station_map ? '✓' : ''}</td>
                    <td className="px-3 py-2 text-center">{f.use_as_anchor ? '✓' : ''}</td>
                    <td className="px-3 py-2 text-xs text-gray-400 max-w-[120px] truncate">{f.note ?? ''}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex gap-2">
                        <button onClick={() => startEdit(f)} className="text-xs text-blue-600 hover:underline">수정</button>
                        <button
                          onClick={() => { if (confirm(`삭제: ${f.name}`)) deleteMut.mutate(f.id); }}
                          className="text-xs text-red-500 hover:underline"
                        >삭제</button>
                      </div>
                    </td>
                  </tr>
                )
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 편집 행 컴포넌트 ─────────────────────────────────────────────────────

function EditRow({
  row, onChange, onSave, onCancel, isPending,
}: {
  row: Omit<FacilityResponse, 'id' | 'route_id'>;
  onChange: <K extends keyof typeof EMPTY_ROW>(k: K, v: (typeof EMPTY_ROW)[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const inp = 'w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';
  return (
    <tr className="border-b bg-blue-50">
      <td className="px-2 py-1">
        <select value={row.type} onChange={e => onChange('type', e.target.value)} className={inp}>
          {FACILITY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
      </td>
      <td className="px-2 py-1">
        <input value={row.name} onChange={e => onChange('name', e.target.value)} placeholder="이름" className={inp} />
      </td>
      <td className="px-2 py-1">
        <input type="number" step="0.1" value={row.km} onChange={e => onChange('km', Number(e.target.value))} className={inp} />
      </td>
      <td className="px-2 py-1">
        <input type="number" step="0.1" value={row.km_end ?? ''} onChange={e => onChange('km_end', e.target.value ? Number(e.target.value) : null)} placeholder="—" className={inp} />
      </td>
      <td className="px-2 py-1">
        <input type="number" step="0.0001" value={row.lat ?? ''} onChange={e => onChange('lat', e.target.value ? Number(e.target.value) : null)} placeholder="위도" className={inp} />
      </td>
      <td className="px-2 py-1">
        <input type="number" step="0.0001" value={row.lon ?? ''} onChange={e => onChange('lon', e.target.value ? Number(e.target.value) : null)} placeholder="시작경도" className={inp} />
      </td>
      <td className="px-2 py-1">
        <input type="number" step="0.0001" value={row.lat_end ?? ''} onChange={e => onChange('lat_end', e.target.value ? Number(e.target.value) : null)} placeholder="종료위도" className={inp} />
      </td>
      <td className="px-2 py-1">
        <input type="number" step="0.0001" value={row.lon_end ?? ''} onChange={e => onChange('lon_end', e.target.value ? Number(e.target.value) : null)} placeholder="종료경도" className={inp} />
      </td>
      <td className="px-2 py-1">
        <select value={row.direction ?? ''} onChange={e => onChange('direction', e.target.value || null)} className={inp}>
          {DIRECTIONS.map(d => <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>)}
        </select>
      </td>
      <td className="px-2 py-1">
        <select value={row.boundary ?? ''} onChange={e => onChange('boundary', e.target.value || null)} className={inp}>
          {BOUNDARIES.map(b => <option key={b} value={b}>{b || '—'}</option>)}
        </select>
      </td>
      <td className="px-2 py-1 text-center">
        <input type="checkbox" checked={row.has_station_map} onChange={e => onChange('has_station_map', e.target.checked)} />
      </td>
      <td className="px-2 py-1 text-center">
        <input type="checkbox" checked={row.use_as_anchor} onChange={e => onChange('use_as_anchor', e.target.checked)} />
      </td>
      <td className="px-2 py-1">
        <input value={row.note ?? ''} onChange={e => onChange('note', e.target.value || null)} placeholder="비고" className={inp} />
      </td>
      <td className="px-2 py-1 whitespace-nowrap">
        <button onClick={onSave} disabled={isPending} className="text-xs text-white bg-blue-600 px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50 mr-1">
          {isPending ? '...' : '저장'}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:underline">취소</button>
      </td>
    </tr>
  );
}

// ── 타입 배지 ─────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  STATION: 'bg-blue-100 text-blue-700',
  GENERAL_STATION: 'bg-sky-100 text-sky-700',
  CROSSING: 'bg-yellow-100 text-yellow-700',
  OVERPASS: 'bg-purple-100 text-purple-700',
  SUBSTATION: 'bg-orange-100 text-orange-700',
  TUNNEL: 'bg-gray-200 text-gray-700',
  BRIDGE: 'bg-cyan-100 text-cyan-700',
  JUNCTION: 'bg-green-100 text-green-700',
  BOUNDARY: 'bg-red-100 text-red-700',
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

const EMPTY_ROW: Omit<FacilityResponse, 'id' | 'route_id'> = {
  type: 'STATION', name: '', km: 0, km_end: null,
  lat: null, lon: null, lat_end: null, lon_end: null,
  direction: null, boundary: null, has_station_map: false, use_as_anchor: true, note: null,
};
