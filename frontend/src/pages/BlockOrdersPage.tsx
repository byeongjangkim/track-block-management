import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBlockOrders, deleteBlockOrder, uploadDocument } from '../api/blockOrders';
import { apiUrl } from '../api/client';
import { fetchRoutes } from '../api/routes';
import { fetchOrganizations } from '../api/organizations';
import { useAuthStore } from '../store/authStore';
import type { BlockOrder } from '../types';
import BlockOrderForm from '../components/block/BlockOrderForm';
import PdfImportModal from '../components/block/PdfImportModal';

function formatTime(t: string) { return t.slice(0, 5); }

function fmtTracks(tracks: string[]): string { return tracks.join(' · '); }

function todayStr() { return new Date().toISOString().slice(0, 10); }
function plusDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const DEFAULT_DATE_FROM = todayStr();
const DEFAULT_DATE_TO   = plusDays(7);

export default function BlockOrdersPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  // 역할 기반 권한
  const canRegister =
    user?.role === 'block_manager' ||
    user?.role === 'org_admin' ||
    (user?.role === 'user' && user.can_register === true);
  const isSuperuser = user?.role === 'system_superuser';
  const isBlockManager = user?.role === 'block_manager';

  // 입력 중인 필터 (아직 API에 반영 안 됨)
  const [inputRouteId, setInputRouteId]   = useState<number | ''>('');
  const [inputOrgFilter, setInputOrgFilter] = useState<number | ''>('');
  const [inputField, setInputField]       = useState('');
  const [inputDocNo, setInputDocNo]       = useState('');   // 문서번호 필터
  const [inputDateFrom, setInputDateFrom] = useState(DEFAULT_DATE_FROM);
  const [inputDateTo, setInputDateTo]     = useState(DEFAULT_DATE_TO);

  // 실제 조회에 사용되는 필터 ([조회] 클릭 시 반영)
  const [appliedRouteId, setAppliedRouteId]     = useState<number | ''>('');
  const [appliedOrgFilter, setAppliedOrgFilter] = useState<number | ''>('');
  const [appliedField, setAppliedField]         = useState('');
  const [appliedDocNo, setAppliedDocNo]         = useState('');
  const [appliedDateFrom, setAppliedDateFrom]   = useState(DEFAULT_DATE_FROM);
  const [appliedDateTo, setAppliedDateTo]       = useState(DEFAULT_DATE_TO);

  // 위험등급 필터 (null=전체, 'A'/'B'/'C'/'none'=미지정)
  const [filterDangerLevel, setFilterDangerLevel] = useState<string | null>(null);

  // 모달 상태
  const [showForm, setShowForm]         = useState(false);
  const [editing, setEditing]           = useState<BlockOrder | undefined>();
  const [showPdfImport, setShowPdfImport] = useState(false);
  const [pdfSavedCount, setPdfSavedCount] = useState<number | null>(null);

  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: fetchRoutes });
  const { data: organizations = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: fetchOrganizations,
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['block-orders', appliedRouteId, appliedDateFrom, appliedDateTo, appliedOrgFilter, appliedField],
    queryFn: () =>
      fetchBlockOrders({
        route_id:        appliedRouteId !== '' ? appliedRouteId : undefined,
        date_from:       appliedDateFrom || undefined,
        date_to:         appliedDateTo || undefined,
        organization_id: appliedOrgFilter !== '' ? appliedOrgFilter : undefined,
        field:           appliedField || undefined,
      }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteBlockOrder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['block-orders'] }),
  });

  const routeMap = Object.fromEntries(routes.map((r) => [r.id, r.name]));
  const orgMap   = Object.fromEntries(organizations.map((o) => [o.id, o.name]));

  const filteredOrders = useMemo(() => {
    let result = orders;
    // 문서번호 클라이언트 필터
    if (appliedDocNo.trim()) {
      const q = appliedDocNo.trim().toLowerCase();
      result = result.filter((o) => o.doc_no?.toLowerCase().includes(q));
    }
    if (filterDangerLevel === null) return result;
    if (filterDangerLevel === 'none') return result.filter((o) => o.danger_level === null);
    return result.filter((o) => o.danger_level === filterDangerLevel);
  }, [orders, filterDangerLevel, appliedDocNo]);

  function canEdit(order: BlockOrder) {
    if (user?.role === 'block_manager') return true;
    if (user?.role === 'org_admin' && order.organization_id === user.organization_id) return true;
    if (user?.role === 'user' && user.can_register && order.organization_id === user.organization_id) return true;
    return false;
  }

  function handleDelete(order: BlockOrder) {
    const label = `${routeMap[order.route_id] ?? ''} ${order.work_date} ${formatTime(order.start_time)}~${formatTime(order.end_time)}`;
    if (!confirm(`삭제하시겠습니까?\n${label}`)) return;
    deleteMut.mutate(order.id);
  }

  function handleSearch() {
    setAppliedRouteId(inputRouteId);
    setAppliedOrgFilter(inputOrgFilter);
    setAppliedField(inputField);
    setAppliedDocNo(inputDocNo);
    setAppliedDateFrom(inputDateFrom);
    setAppliedDateTo(inputDateTo);
  }

  function handleReset() {
    setInputRouteId('');
    setInputOrgFilter('');
    setInputField('');
    setInputDocNo('');
    setInputDateFrom(DEFAULT_DATE_FROM);
    setInputDateTo(DEFAULT_DATE_TO);
    setAppliedRouteId('');
    setAppliedOrgFilter('');
    setAppliedField('');
    setAppliedDocNo('');
    setAppliedDateFrom(DEFAULT_DATE_FROM);
    setAppliedDateTo(DEFAULT_DATE_TO);
    setFilterDangerLevel(null);
  }

  function openCreate() { setEditing(undefined); setShowForm(true); }
  function openEdit(o: BlockOrder) { setEditing(o); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditing(undefined); }

  const colCount = isSuperuser ? 15 : 14;

  const SELECT_CLS = 'h-9 w-32 border rounded-lg pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white appearance-none cursor-pointer';
  const DATE_CLS   = 'h-9 border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white';
  const LABEL_CLS  = 'text-sm text-gray-600 whitespace-nowrap';

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">

      {/* ── 필터 영역 (1줄, 인라인 레이블) ── */}
      <div className="flex items-center gap-3 mb-4 shrink-0 flex-wrap">

        {/* 소속 조직 — superuser만 */}
        {isSuperuser && (
          <>
            <span className={LABEL_CLS}>소속 조직</span>
            <div className="relative">
              <select
                value={inputOrgFilter}
                onChange={(e) => setInputOrgFilter(e.target.value === '' ? '' : Number(e.target.value))}
                className={SELECT_CLS}
              >
                <option value="">전체</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
            </div>
          </>
        )}

        {/* 노선 */}
        <span className={LABEL_CLS}>노선</span>
        <div className="relative">
          <select
            value={inputRouteId}
            onChange={(e) => setInputRouteId(e.target.value === '' ? '' : Number(e.target.value))}
            className={SELECT_CLS}
          >
            <option value="">전체</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
        </div>

        {/* 분야 */}
        <span className={LABEL_CLS}>분야</span>
        <div className="relative">
          <select
            value={inputField}
            onChange={(e) => setInputField(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">전체</option>
            <option value="시설">시설</option>
            <option value="전기">전기</option>
            <option value="건축">건축</option>
          </select>
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
        </div>

        {/* 문서번호 */}
        <span className={LABEL_CLS}>문서번호</span>
        <input
          type="text"
          value={inputDocNo}
          onChange={(e) => setInputDocNo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="예: 053479"
          className="h-9 w-28 border rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        />

        {/* 기간 */}
        <span className={LABEL_CLS}>기간</span>
        <input
          type="date" value={inputDateFrom}
          onChange={(e) => setInputDateFrom(e.target.value)}
          className={DATE_CLS}
        />
        <span className="text-gray-400 text-sm">~</span>
        <input
          type="date" value={inputDateTo}
          onChange={(e) => setInputDateTo(e.target.value)}
          className={DATE_CLS}
        />

        {/* 위험등급 필터 */}
        <span className={LABEL_CLS}>위험등급</span>
        <div className="flex items-center gap-1">
          {([
            [null,   '전체',  'bg-blue-600'],
            ['A',    'A',     'bg-red-500'],
            ['B',    'B',     'bg-yellow-500'],
            ['C',    'C',     'bg-green-500'],
            ['none', '미지정','bg-gray-400'],
          ] as [string | null, string, string][]).map(([v, label, activeCls]) => (
            <button
              key={String(v)}
              onClick={() => setFilterDangerLevel(v)}
              className={`h-7 px-2.5 text-xs rounded border transition-colors ${
                filterDangerLevel === v
                  ? `${activeCls} text-white border-transparent`
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 버튼 그룹 */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={handleReset}
            className="h-9 px-4 text-sm border rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
          >
            초기화
          </button>
          <button
            onClick={handleSearch}
            className="h-9 px-5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            조회
          </button>
          {canRegister && (
            <>
              <button
                onClick={() => { setPdfSavedCount(null); setShowPdfImport(true); }}
                className="h-9 px-4 text-sm border border-green-600 text-green-600 rounded-lg hover:bg-green-50 font-medium transition-colors"
              >
                PDF 일괄등록
              </button>
              <button
                onClick={openCreate}
                className="h-9 px-4 text-sm border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 font-medium transition-colors"
              >
                + 차단명령 등록
              </button>
            </>
          )}
        </div>
      </div>

      {/* PDF 저장 완료 알림 */}
      {pdfSavedCount !== null && (
        <div className="mb-2 shrink-0 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-2 rounded-lg flex justify-between items-center">
          <span>PDF에서 차단명령 {pdfSavedCount}건이 등록되었습니다.</span>
          <button onClick={() => setPdfSavedCount(null)} className="text-green-500 hover:text-green-700 text-xs ml-4">✕</button>
        </div>
      )}

      {/* 건수 + 소속 조직 배지 */}
      <div className="flex items-center gap-3 mb-2 shrink-0">
        <p className="text-sm text-gray-500">
          {isLoading ? '조회 중...' : (
            filterDangerLevel !== null
              ? `${filteredOrders.length}/${orders.length}건`
              : `총 ${orders.length}건`
          )}
        </p>
        {user?.organization_name && (
          <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
            {user.organization_name}
            {user.field && user.field !== 'all' ? ` · ${user.field}` : ''}
          </span>
        )}
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {[
                ...(isSuperuser ? ['소속 조직'] : []),
                '노선', '방향', '구간 (km)', '작업일자', '시간', '분야',
                '차단종류', '작업형태', '시행주체', '위험등급', '작업책임자', '안전관리자', '문서', '작업',
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 border-b whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="text-center py-12 text-gray-400">
                  {isLoading ? '불러오는 중...' : orders.length === 0 ? '차단명령이 없습니다.' : '해당 등급의 차단명령이 없습니다.'}
                </td>
              </tr>
            ) : (
              filteredOrders.map((o) => (
                <tr
                  key={o.id}
                  className="border-b hover:bg-blue-50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/block-map?date=${o.work_date}&block_id=${o.id}`)}
                >
                  {isSuperuser && (
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                      {o.organization_id ? (orgMap[o.organization_id] ?? `#${o.organization_id}`) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 whitespace-nowrap font-medium">
                    {routeMap[o.route_id] ?? '-'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                      {fmtTracks(o.tracks)}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                    {o.start_km !== null && o.end_km !== null
                      ? `${o.start_km} ~ ${o.end_km}`
                      : o.section_note ?? '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{o.work_date}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                    {formatTime(o.start_time)} ~ {formatTime(o.end_time)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <FieldBadge field={o.field} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{o.block_type}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.work_type ? (
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        o.work_type === '인력' ? 'bg-slate-100 text-slate-700'
                        : o.work_type === '장비' ? 'bg-blue-100 text-blue-700'
                        : 'bg-orange-100 text-orange-700'
                      }`}>
                        {o.work_type}
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      o.implementer === '외부' ? 'bg-yellow-100 text-yellow-700'
                      : o.implementer === '철도공단' ? 'bg-purple-100 text-purple-700'
                      : 'bg-gray-100 text-gray-600'
                    }`}>
                      {o.implementer || '철도공사'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {o.danger_level ? (
                      <span
                        className="px-1.5 py-0.5 rounded text-white text-xs font-medium"
                        style={{
                          backgroundColor: o.danger_level === 'A' ? '#ef4444'
                            : o.danger_level === 'B' ? '#f59e0b'
                            : '#10b981',
                        }}
                      >
                        {o.danger_level}
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{o.work_supervisor}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{o.safety_manager}</td>
                  <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                    {o.document_path ? (
                      <a
                        href={apiUrl(`/api/v1/documents/${o.document_path}`)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        PDF
                      </a>
                    ) : canEdit(o) ? (
                      <UploadButton orderId={o.id} />
                    ) : '-'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {canEdit(o) ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEdit(o)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDelete(o)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          삭제
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <BlockOrderForm
          initial={editing}
          onClose={closeForm}
        />
      )}

      {showPdfImport && (
        <PdfImportModal
          routes={routes}
          organizations={isBlockManager ? organizations : undefined}
          defaultOrgId={user?.organization_id ?? undefined}
          onClose={() => setShowPdfImport(false)}
          onSaved={(count) => {
            setShowPdfImport(false);
            setPdfSavedCount(count);
            handleSearch();
          }}
        />
      )}
    </div>
  );
}

// ── 소형 유틸 컴포넌트 ────────────────────────────────────────────────────

const FIELD_COLORS: Record<string, string> = {
  시설: 'bg-indigo-100 text-indigo-700',
  전기: 'bg-yellow-100 text-yellow-700',
  건축: 'bg-emerald-100 text-emerald-700',
};

function FieldBadge({ field }: { field: string }) {
  const cls = FIELD_COLORS[field] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {field}
    </span>
  );
}

function UploadButton({ orderId }: { orderId: number }) {
  const qc = useQueryClient();

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadDocument(orderId, file);
    qc.invalidateQueries({ queryKey: ['block-orders'] });
  }

  return (
    <label className="text-xs text-gray-400 hover:text-blue-600 cursor-pointer">
      업로드
      <input type="file" accept="application/pdf" className="hidden" onChange={handleChange} />
    </label>
  );
}
