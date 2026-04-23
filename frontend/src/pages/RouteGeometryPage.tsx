import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchGeometryStatus,
  downloadGeometryTemplate,
  downloadGeometryUser,
  uploadGeometryCsv,
  importShpFile,
  fetchGeometryPoints,
  createGeometryPoint,
  updateGeometryPoint,
  deleteGeometryPoint,
  type GeometryStatus,
} from '../api/admin';
import { fetchRoutes } from '../api/routes';

const PER_PAGE = 500;

type EditRow = { segment: string; lat: string; lon: string; km: string };
const EMPTY_ROW: EditRow = { segment: '0', lat: '', lon: '', km: '' };

export default function RouteGeometryPage() {
  // 2단계 UI: null = 노선 목록, string = 해당 노선 편집
  const [activeCode, setActiveCode] = useState<string | null>(null);

  const { data: statusList = [], isLoading: statusLoading } = useQuery({
    queryKey: ['geometry-status'],
    queryFn: fetchGeometryStatus,
    staleTime: 0,
  });

  if (activeCode === null) {
    return (
      <RouteListView
        statusList={statusList}
        isLoading={statusLoading}
        onSelect={setActiveCode}
      />
    );
  }

  return (
    <RouteEditView
      routeCode={activeCode}
      statusList={statusList}
      onBack={() => setActiveCode(null)}
    />
  );
}

// ── 노선 목록 화면 ─────────────────────────────────────────────────────────

function RouteListView({
  statusList,
  isLoading,
  onSelect,
}: {
  statusList: GeometryStatus[];
  isLoading: boolean;
  onSelect: (code: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const filtered = statusList.filter(
    (s) => s.route_name.includes(filter) || s.route_code.includes(filter)
  );

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-hidden">
      <div className="flex items-center gap-3 shrink-0">
        <h1 className="text-lg font-semibold text-gray-800">노선도 관리</h1>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="노선명 검색"
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-40"
        />
        <span className="text-sm text-gray-400 ml-1">
          {isLoading ? '조회 중...' : `전체 ${statusList.length}개 노선 · user ${statusList.filter(s => s.user.exists).length}개 등록`}
        </span>
      </div>

      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['노선명', 'GIS 포인트', 'km 범위', '상태', ''].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.route_code}
                onClick={() => onSelect(s.route_code)}
                className="border-b hover:bg-blue-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 font-medium text-gray-800">{s.route_name}</td>
                <td className="px-4 py-3 tabular-nums text-gray-600">
                  {s.user.exists ? s.user.points.toLocaleString() + 'pt' : '—'}
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-600">
                  {s.user.km_min != null
                    ? `${s.user.km_min} ~ ${s.user.km_max} km`
                    : s.user.exists ? 'km 미입력' : '—'}
                </td>
                <td className="px-4 py-3">
                  {s.user.exists ? (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 font-medium">등록됨</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-600 font-medium">미등록</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-xs text-blue-600">편집 →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

}

// ── 노선 편집 화면 ─────────────────────────────────────────────────────────

function RouteEditView({
  routeCode,
  statusList,
  onBack,
}: {
  routeCode: string;
  statusList: GeometryStatus[];
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const csvRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [editRow, setEditRow] = useState<EditRow>(EMPTY_ROW);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [shpFiles, setShpFiles] = useState<{ shp?: File; dbf?: File; prj?: File }>({});

  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: fetchRoutes });
  const routeName = routes.find(r => r.code === routeCode)?.name ?? routeCode;

  const status = statusList.find(s => s.route_code === routeCode) ?? null;
  const userStat = status?.user;

  const { data: pointsData, isLoading } = useQuery({
    queryKey: ['geometry-points', routeCode, page],
    queryFn: () => fetchGeometryPoints(routeCode, page, PER_PAGE),
    enabled: !!routeCode,
    placeholderData: prev => prev,
  });

  function showNotice(type: 'ok' | 'err', msg: string) {
    setNotice({ type, msg });
    setTimeout(() => setNotice(null), 4000);
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['geometry-points', routeCode] });
    qc.invalidateQueries({ queryKey: ['geometry-status'] });
  }

  // CSV 업로드
  const csvMut = useMutation({
    mutationFn: (file: File) => uploadGeometryCsv(routeCode, file),
    onSuccess: (r) => { invalidate(); setPage(1); showNotice('ok', `CSV 업로드 완료 — ${r.rows_saved.toLocaleString()}개 포인트 저장`); },
    onError: () => showNotice('err', 'CSV 업로드 실패'),
  });

  // SHP 업로드
  const shpMut = useMutation({
    mutationFn: () => {
      if (!shpFiles.shp || !shpFiles.dbf) throw new Error('.shp와 .dbf 파일이 필요합니다.');
      return importShpFile(routeCode, shpFiles.shp, shpFiles.dbf, shpFiles.prj);
    },
    onSuccess: (r) => {
      invalidate(); setPage(1); setShpFiles({});
      showNotice('ok', `SHP 변환 완료 — ${r.rows_saved.toLocaleString()}개 포인트 저장`);
    },
    onError: (e: Error) => showNotice('err', e.message || 'SHP 업로드 실패'),
  });

  // 포인트 CRUD
  const createMut = useMutation({
    mutationFn: (body: { segment: number; lat: number; lon: number; km: number }) => createGeometryPoint(routeCode, body),
    onSuccess: () => { invalidate(); setEditingId(null); setEditRow(EMPTY_ROW); },
    onError: () => showNotice('err', '추가 실패'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<{ segment: number; lat: number; lon: number; km: number }> }) =>
      updateGeometryPoint(routeCode, id, body),
    onSuccess: () => { invalidate(); setEditingId(null); },
    onError: () => showNotice('err', '수정 실패'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteGeometryPoint(routeCode, id),
    onSuccess: invalidate,
    onError: () => showNotice('err', '삭제 실패'),
  });

  function saveEdit() {
    const seg = parseInt(editRow.segment) || 0;
    const lat = parseFloat(editRow.lat);
    const lon = parseFloat(editRow.lon);
    const km  = parseFloat(editRow.km);
    if (isNaN(lat) || isNaN(lon)) { showNotice('err', 'lat, lon 값을 입력하세요'); return; }
    if (editingId === 'new') createMut.mutate({ segment: seg, lat, lon, km: isNaN(km) ? 0 : km });
    else if (typeof editingId === 'number') updateMut.mutate({ id: editingId, body: { segment: seg, lat, lon, km: isNaN(km) ? undefined : km } });
  }

  function setField(k: keyof EditRow, v: string) { setEditRow(r => ({ ...r, [k]: v })); }
  const isMutating = createMut.isPending || updateMut.isPending || deleteMut.isPending;
  const statusText = userStat?.exists
    ? `총 ${userStat.points.toLocaleString()}개 포인트${userStat.km_min != null ? ` · km ${userStat.km_min} ~ ${userStat.km_max}` : ''}`
    : '등록된 포인트 없음';

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-hidden">

      {/* 헤더 */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline">← 목록</button>
        <h1 className="text-lg font-semibold text-gray-800">{routeName}</h1>
        <span className="text-xs text-gray-400">{statusText}</span>

        <div className="flex gap-2 ml-auto flex-wrap">
          {/* CSV 다운로드 */}
          <button
            onClick={() => (userStat?.exists ? downloadGeometryUser(routeCode) : downloadGeometryTemplate(routeCode)).catch(() => showNotice('err', '다운로드 실패'))}
            className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 text-gray-600"
          >
            {userStat?.exists ? 'CSV 다운로드' : 'CSV 다운로드 (추정)'}
          </button>

          {/* CSV 업로드 */}
          <button
            onClick={() => csvRef.current?.click()}
            disabled={csvMut.isPending}
            className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50"
          >
            {csvMut.isPending ? '업로드 중...' : 'CSV 업로드'}
          </button>
          <input ref={csvRef} type="file" accept=".csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { csvMut.mutate(f); e.target.value = ''; } }} />

          {/* SHP 업로드 */}
          <div className="flex gap-1 items-center border rounded-lg px-2">
            <span className="text-xs text-gray-500">SHP:</span>
            <label className="text-xs text-blue-600 cursor-pointer hover:underline">
              .shp{shpFiles.shp ? '✓' : ''}
              <input type="file" accept=".shp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setShpFiles(p => ({ ...p, shp: f })); e.target.value = ''; }} />
            </label>
            <label className="text-xs text-blue-600 cursor-pointer hover:underline">
              .dbf{shpFiles.dbf ? '✓' : ''}
              <input type="file" accept=".dbf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setShpFiles(p => ({ ...p, dbf: f })); e.target.value = ''; }} />
            </label>
            <label className="text-xs text-gray-500 cursor-pointer hover:underline">
              .prj{shpFiles.prj ? '✓' : ''}
              <input type="file" accept=".prj" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setShpFiles(p => ({ ...p, prj: f })); e.target.value = ''; }} />
            </label>
            <button
              onClick={() => shpMut.mutate()}
              disabled={!shpFiles.shp || !shpFiles.dbf || shpMut.isPending}
              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-40 ml-1"
            >
              {shpMut.isPending ? '변환중...' : '변환·저장'}
            </button>
          </div>

          {/* 행 추가 */}
          <button
            onClick={() => { setEditingId('new'); setEditRow(EMPTY_ROW); }}
            disabled={editingId !== null}
            className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50"
          >
            + 행 추가
          </button>
        </div>
      </div>

      {/* 알림 */}
      {notice && (
        <div className={`px-4 py-2 rounded-lg text-sm shrink-0 ${notice.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
          {notice.msg}
        </div>
      )}

      {/* 테이블 */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {['구간', '위도 (lat)', '경도 (lon)', 'km', ''].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {editingId === 'new' && (
              <GeoEditRow row={editRow} onChange={setField} onSave={saveEdit}
                onCancel={() => { setEditingId(null); setEditRow(EMPTY_ROW); }} isPending={createMut.isPending} />
            )}
            {isLoading ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">불러오는 중...</td></tr>
            ) : !pointsData?.items.length && editingId !== 'new' ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">포인트가 없습니다. CSV 또는 SHP를 업로드하세요.</td></tr>
            ) : (
              pointsData?.items.map(item =>
                editingId === item.id ? (
                  <GeoEditRow key={item.id} row={editRow} onChange={setField} onSave={saveEdit}
                    onCancel={() => setEditingId(null)} isPending={updateMut.isPending} />
                ) : (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2 tabular-nums text-gray-600">{item.segment}</td>
                    <td className="px-3 py-2 tabular-nums text-gray-700">{item.lat}</td>
                    <td className="px-3 py-2 tabular-nums text-gray-700">{item.lon}</td>
                    <td className="px-3 py-2 tabular-nums font-medium">{item.km != null ? item.km.toFixed(3) : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingId(item.id); setEditRow({ segment: String(item.segment), lat: String(item.lat), lon: String(item.lon), km: item.km != null ? String(item.km) : '' }); }}
                          disabled={editingId !== null} className="text-xs text-blue-600 hover:underline disabled:opacity-40">수정</button>
                        <button onClick={() => { if (confirm('이 포인트를 삭제하시겠습니까?')) deleteMut.mutate(item.id); }}
                          disabled={isMutating || editingId !== null} className="text-xs text-red-500 hover:underline disabled:opacity-40">삭제</button>
                      </div>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>

        {pointsData && pointsData.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t bg-gray-50 text-xs text-gray-500">
            <span>{page} / {pointsData.pages} 페이지 (전체 {pointsData.total.toLocaleString()}개)</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-white">←</button>
              <button onClick={() => setPage(p => Math.min(pointsData.pages, p + 1))} disabled={page === pointsData.pages} className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-white">→</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 편집 행 컴포넌트 ─────────────────────────────────────────────────────

function GeoEditRow({ row, onChange, onSave, onCancel, isPending }: {
  row: EditRow; onChange: (k: keyof EditRow, v: string) => void;
  onSave: () => void; onCancel: () => void; isPending: boolean;
}) {
  const inp = 'w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';
  return (
    <tr className="border-b bg-blue-50">
      <td className="px-2 py-1 w-20">
        <input type="number" value={row.segment} onChange={e => onChange('segment', e.target.value)} placeholder="0" className={inp} />
      </td>
      <td className="px-2 py-1">
        <input type="number" step="0.000001" value={row.lat} onChange={e => onChange('lat', e.target.value)} placeholder="37.552852" className={inp} />
      </td>
      <td className="px-2 py-1">
        <input type="number" step="0.000001" value={row.lon} onChange={e => onChange('lon', e.target.value)} placeholder="126.972572" className={inp} />
      </td>
      <td className="px-2 py-1">
        <input type="number" step="0.1" value={row.km} onChange={e => onChange('km', e.target.value)} placeholder="0.0" className={inp} />
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
