import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createBlockOrder, updateBlockOrder, uploadDocumentToDb } from '../../api/blockOrders';
import { fetchRoutes } from '../../api/routes';
import { fetchOrganizations } from '../../api/organizations';
import { fetchDepotRoutes, fetchRailSubstations } from '../../api/map';
import { fetchProjects, createProject } from '../../api/projects';
import { useAuthStore } from '../../store/authStore';
import type { BlockOrder, BlockOrderCreate, TrackName, ProjectCreate } from '../../types';
import { availableTracks, HIGH_SPEED_TRACKS, T_TRACK_LABEL } from '../../types';
import type { AxiosError } from 'axios';

interface Props {
  initial?: BlockOrder;
  initialValues?: Partial<BlockOrderCreate>;
  onClose: () => void;
}

const ALL_FIELDS = ['시설', '전기', '건축'];
// 차단종류 목록 (사용자 요청 반영)
const BLOCK_TYPES = ['선로차단', '선로일시사용중지', '열차사이 차단', '보호지구 작업'];
const WORK_TYPES  = [
  { value: '인력', label: '인력작업', desc: '밀차 등 인력·공기구류' },
  { value: '장비', label: '장비작업', desc: '보선장비·전철장비 등 철도차량' },
  { value: '기계', label: '기계작업', desc: '건설기계관리법 상 건설기계' },
];
const IMPLEMENTERS = ['철도공사', '철도공단', '외부'];
// 작업선로 단순 선택 (일반 복선 역간 전용 — 역구내는 별도 routeType)
const SIMPLE_TRACKS = ['상선', '하선', '상하선'] as const;
type SimpleTrack = typeof SIMPLE_TRACKS[number];

type TrackOption = { value: string; label: string; isUp: boolean };

/** 노선 선로 수·고속선 여부에 따른 선택 옵션 생성 */
function getTrackOptions(trackCount: number, isHighSpeed: boolean): TrackOption[] {
  if (isHighSpeed) {
    return Array.from({ length: trackCount }, (_, i) => {
      const n = i + 1;
      const t = `T${n}`;
      return { value: t, label: T_TRACK_LABEL[t] ?? t, isUp: n % 2 === 0 };
    });
  }
  if (trackCount === 1) return [{ value: '상선', label: '상선', isUp: true }];
  if (trackCount >= 4) {
    const half = trackCount / 2;
    const up: TrackOption[] = Array.from({ length: half }, (_, i) => ({ value: `상${i + 1}`, label: `상${i + 1}`, isUp: true }));
    const dn: TrackOption[] = Array.from({ length: half }, (_, i) => ({ value: `하${i + 1}`, label: `하${i + 1}`, isUp: false }));
    return [...up, ...dn];
  }
  return [
    { value: '상선', label: '상선', isUp: true },
    { value: '하선', label: '하선', isUp: false },
  ];
}

type RouteType = 'line' | 'yard' | 'depot';
function today() { return new Date().toISOString().slice(0, 10); }

const EMPTY: BlockOrderCreate = {
  route_id: 0, rail_route_id: null, tracks: ['하선'] as TrackName[], track_name: null,
  start_km: null, end_km: null, section_note: '',
  start_facility_id: null, end_facility_id: null, start_rail_facility_id: null, end_rail_facility_id: null,
  danger_level: null, parent_id: null, equipment_name: '', speed_restriction: null,
  speed_restriction_note: '', catenary_protection: null, zep: '', zcp: '', cpt: '', tzep: '',
  worker_count: null, work_date: today(), start_time: '09:00', end_time: '17:00',
  field: ALL_FIELDS[0], block_type: '선로차단', work_type: null, has_equipment: false, has_labor: true,
  implementer: '철도공사', is_external: false, doc_no: '', dept_head: '', dept_head_phone: '',
  work_supervisor: '', work_supervisor_phone: '', safety_manager: '', safety_manager_phone: '',
  electric_safety_manager: '', electric_safety_manager_phone: '', contractor: '', contractor_phone: '',
  train_watcher: '', train_watcher_phone: '', safety_items: '',
  document_id: null, project_name: '', approved_date: null, block_method: '',
  start_station_name: '', end_station_name: '', project_id: null, reason: '', note: '',
};

export default function BlockOrderForm({ initial, initialValues, onClose }: Props) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isSuperuser = user?.role === 'system_superuser';
  const userField = user?.field && user.field !== 'all' ? user.field : null;
  const availableFields = userField ? [userField] : ALL_FIELDS;

  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: fetchRoutes });
  const { data: depots = [] } = useQuery({ queryKey: ['depot-routes'], queryFn: fetchDepotRoutes, staleTime: Infinity });
  const { data: orgs = [] } = useQuery({ queryKey: ['organizations'], queryFn: fetchOrganizations, enabled: isSuperuser, staleTime: Infinity });
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => fetchProjects(), staleTime: 60_000 });

  const [newProjectName, setNewProjectName] = useState('');
  const createProjectMut = useMutation({
    mutationFn: (body: ProjectCreate) => createProject(body),
    onSuccess: (proj) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      set('project_id', proj.id); set('project_name', proj.name); setNewProjectName('');
    },
    onError: () => setError('공사 등록 중 오류가 발생했습니다.'),
  });

  const [form, setForm] = useState<BlockOrderCreate>(() =>
    initial ? {
      route_id: initial.route_id, organization_id: initial.organization_id ?? undefined,
      tracks: initial.tracks, start_km: initial.start_km ?? null, end_km: initial.end_km ?? null,
      section_note: initial.section_note ?? '', start_facility_id: initial.start_facility_id ?? null,
      end_facility_id: initial.end_facility_id ?? null,
      start_rail_facility_id: initial.start_rail_facility_id ?? null,
      end_rail_facility_id: initial.end_rail_facility_id ?? null,
      danger_level: initial.danger_level ?? null, parent_id: initial.parent_id ?? null,
      equipment_name: initial.equipment_name ?? '', speed_restriction: initial.speed_restriction ?? null,
      speed_restriction_note: initial.speed_restriction_note ?? '',
      catenary_protection: initial.catenary_protection ?? null,
      zep: initial.zep ?? '', zcp: initial.zcp ?? '', cpt: initial.cpt ?? '', tzep: initial.tzep ?? '',
      worker_count: initial.worker_count ?? null, work_date: initial.work_date,
      start_time: initial.start_time.slice(0, 5), end_time: initial.end_time.slice(0, 5),
      field: initial.field, block_type: initial.block_type, work_type: initial.work_type ?? null,
      has_equipment: initial.has_equipment, has_labor: initial.has_labor,
      implementer: initial.implementer ?? '철도공사', is_external: initial.is_external,
      doc_no: initial.doc_no ?? '', dept_head: initial.dept_head ?? '',
      dept_head_phone: initial.dept_head_phone ?? '', work_supervisor: initial.work_supervisor,
      work_supervisor_phone: initial.work_supervisor_phone ?? '', safety_manager: initial.safety_manager,
      safety_manager_phone: initial.safety_manager_phone ?? '',
      electric_safety_manager: initial.electric_safety_manager ?? '',
      electric_safety_manager_phone: initial.electric_safety_manager_phone ?? '',
      contractor: initial.contractor ?? '', contractor_phone: initial.contractor_phone ?? '',
      train_watcher: initial.train_watcher ?? '', train_watcher_phone: initial.train_watcher_phone ?? '',
      safety_items: initial.safety_items ?? '', document_id: initial.document_id ?? null,
      project_name: initial.project_name ?? '', approved_date: initial.approved_date ?? null,
      block_method: initial.block_method ?? '',
      start_station_name: initial.start_station_name ?? '', end_station_name: initial.end_station_name ?? '',
      project_id: initial.project_id ?? null, reason: initial.reason ?? '', note: initial.note ?? '',
    } : {
      ...EMPTY, field: userField ?? ALL_FIELDS[0],
      organization_id: isSuperuser ? undefined : (user?.organization_id ?? undefined),
      ...initialValues,
    }
  );

  const [routeType, setRouteType] = useState<RouteType>(() => {
    if (initial?.rail_route_id && !initial?.route_id) return 'depot';
    if (initial?.track_name && initial?.route_id) return 'yard';
    return 'line';
  });
  const isDepot = routeType === 'depot';
  const isYard = routeType === 'yard';

  useEffect(() => {
    if (!initial && !isDepot && routes.length > 0 && form.route_id === 0)
      setForm((f) => ({ ...f, route_id: routes[0].id }));
  }, [routes, initial, isDepot, form.route_id]);

  useEffect(() => {
    if (!isSuperuser && user?.organization_id && !form.organization_id)
      setForm((f) => ({ ...f, organization_id: user.organization_id ?? undefined }));
  }, [isSuperuser, user?.organization_id, form.organization_id]);

  const [error, setError] = useState('');

  const substationsRouteId = isDepot ? undefined : (form.route_id || undefined);
  const substationsRailRouteId = isDepot ? (form.rail_route_id || undefined) : undefined;
  // 역간·역구내·기지 모두 변전소 목록 로드 (기지도 전차선 단전 표시)
  const { data: substations = [] } = useQuery({
    queryKey: ['rail-substations', substationsRouteId, substationsRailRouteId],
    queryFn: () => fetchRailSubstations({ route_id: substationsRouteId, rail_route_id: substationsRailRouteId }),
    enabled: !!substationsRouteId || !!substationsRailRouteId,
    staleTime: 60_000,
  });

  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // 전차선단전 단전 선로 목록 (section_note에 [T1,T2] 형식으로 인코딩)
  const [catenaryTracks, setCatenaryTracks] = useState<string[]>(() => {
    if (!initial?.section_note || (!initial.start_rail_facility_id && !initial.start_facility_id)) return [];
    const bm = initial.section_note.match(/\[([^\]]+)\]/);
    if (bm) return bm[1].split(',').map(t => t.trim()).filter(Boolean);
    const pm = initial.section_note.match(/\(([^)]+)\)/);
    if (!pm) return [];
    const dir = pm[1].trim();
    if (dir === '상선') return ['상선'];
    if (dir === '하선') return ['하선'];
    return ['상선', '하선'];
  });

  function set<K extends keyof BlockOrderCreate>(key: K, value: BlockOrderCreate[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function extractError(err: unknown): string {
    const ae = err as AxiosError<{ detail: string | Array<{ loc: string[]; msg: string }> }>;
    const d = ae?.response?.data?.detail;
    if (!d) return `저장 중 오류가 발생했습니다. (HTTP ${ae?.response?.status ?? '?'})`;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(e => `${e.loc.slice(-1)[0]}: ${e.msg}`).join(' / ');
    return '저장 중 오류가 발생했습니다.';
  }

  // 작업선로 단순 선택 (복선 역간 전용)
  function getSimpleTrack(): SimpleTrack | null {
    const t = form.tracks as string[];
    if (t.length === 1 && t[0] === '상선') return '상선';
    if (t.length === 1 && t[0] === '하선') return '하선';
    if (t.includes('상선') && t.includes('하선') && t.length === 2) return '상하선';
    return null;
  }
  function setSimpleTrack(mode: SimpleTrack) {
    switch (mode) {
      case '상선':   setForm(f => ({ ...f, tracks: ['상선'] as TrackName[] })); break;
      case '하선':   setForm(f => ({ ...f, tracks: ['하선'] as TrackName[] })); break;
      case '상하선': setForm(f => ({ ...f, tracks: ['상선', '하선'] as TrackName[] })); break;
    }
  }

  // 전차선단전 section_note 자동 구성 — "[T1,T2]" 또는 "[상선,하선]" 형식
  function buildSectionNote(
    startId: number | null | undefined,
    endId: number | null | undefined,
    tracks: string[],
  ): string {
    const startSub = substations.find(s => s.id === startId);
    const endSub   = substations.find(s => s.id === endId);
    if (!startSub || !endSub) return form.section_note ?? '';
    const trackStr = tracks.length > 0 ? ` [${tracks.join(',')}]` : '';
    return `${startSub.name}~${endSub.name}${trackStr}`;
  }

  function handlePdfSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    setPendingPdfFile(file);
  }

  const createMut = useMutation({
    mutationFn: createBlockOrder,
    onSuccess: async (created) => {
      if (pendingPdfFile) {
        try {
          await uploadDocumentToDb(pendingPdfFile, { orderId: created.id, docNo: created.doc_no ?? undefined });
        } catch {
          // PDF 업로드 실패는 저장 성공 후 별도 안내
          setError('차단명령이 등록되었으나 PDF 첨부에 실패했습니다. 목록에서 다시 첨부하세요.');
          qc.invalidateQueries({ queryKey: ['block-orders'] });
          return;
        }
      }
      qc.invalidateQueries({ queryKey: ['block-orders'] });
      onClose();
    },
    onError: (err) => setError(extractError(err)),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<BlockOrderCreate> }) => updateBlockOrder(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['block-orders'] }); onClose(); },
    onError: (err) => setError(extractError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (isDepot) {
      if (!form.rail_route_id) { setError('기지를 선택하세요.'); return; }
    } else {
      if (form.route_id === 0) { setError('노선을 선택하세요.'); return; }
      if (!isYard) {
        if (form.start_km === null || form.start_km === undefined) { setError('시작KP를 입력하세요.'); return; }
        if (form.end_km === null || form.end_km === undefined) { setError('종료KP를 입력하세요.'); return; }
        if (form.start_km >= form.end_km) { setError('종료KP는 시작KP보다 커야 합니다.'); return; }
      } else if (
        form.start_km !== null && form.start_km !== undefined &&
        form.end_km !== null && form.end_km !== undefined &&
        form.start_km >= form.end_km
      ) {
        setError('종료KP는 시작KP보다 커야 합니다.'); return;
      }
    }
    if (!form.work_supervisor.trim()) { setError('작업책임자를 입력하세요.'); return; }
    if (!form.safety_manager.trim()) { setError('철도운행안전관리자를 입력하세요.'); return; }

    const payload: BlockOrderCreate = {
      ...form,
      route_id: isDepot ? null : form.route_id,
      rail_route_id: form.rail_route_id,
      track_name: (isDepot || isYard) ? (form.track_name?.trim() || null) : null,
      start_km: isDepot ? null : form.start_km,
      end_km:   isDepot ? null : form.end_km,
      start_facility_id: null, end_facility_id: null,
      start_rail_facility_id: form.start_rail_facility_id ?? null,
      end_rail_facility_id:   form.end_rail_facility_id   ?? null,
      section_note: form.section_note?.trim() || undefined,
      doc_no: form.doc_no?.trim() || undefined,
      dept_head: form.dept_head?.trim() || undefined,
      dept_head_phone: form.dept_head_phone?.trim() || undefined,
      work_supervisor_phone: form.work_supervisor_phone?.trim() || undefined,
      safety_manager_phone: form.safety_manager_phone?.trim() || undefined,
      electric_safety_manager: form.electric_safety_manager?.trim() || undefined,
      electric_safety_manager_phone: form.electric_safety_manager_phone?.trim() || undefined,
      contractor: form.contractor?.trim() || undefined,
      train_watcher: form.train_watcher?.trim() || undefined,
      train_watcher_phone: form.train_watcher_phone?.trim() || undefined,
      safety_items: form.safety_items?.trim() || undefined,
      parent_id: form.parent_id ?? undefined,
      equipment_name: form.equipment_name?.trim() || undefined,
      speed_restriction: form.speed_restriction ?? undefined,
      speed_restriction_note: form.speed_restriction_note?.trim() || undefined,
      catenary_protection: form.catenary_protection || undefined,
      zep: form.zep?.trim() || undefined, zcp: form.zcp?.trim() || undefined,
      cpt: form.cpt?.trim() || undefined, tzep: form.tzep?.trim() || undefined,
      worker_count: form.worker_count ?? undefined,
      note: form.note?.trim() || undefined,
      contractor_phone: form.contractor_phone?.trim() || undefined,
      document_id: form.document_id ?? undefined,
      project_name: form.project_name?.trim() || undefined,
      approved_date: form.approved_date ?? undefined,
      block_method: form.block_method?.trim() || undefined,
      start_station_name: form.start_station_name?.trim() || undefined,
      end_station_name: form.end_station_name?.trim() || undefined,
      project_id: form.project_id ?? undefined,
      reason: form.reason?.trim() || undefined,
    };
    if (initial) updateMut.mutate({ id: initial.id, body: payload });
    else createMut.mutate(payload);
  }

  const isPending = createMut.isPending || updateMut.isPending;

  // 노선 공통 계산
  const selectedRoute = isDepot ? null : routes.find(r => r.id === form.route_id);
  const isHighSpeed   = selectedRoute?.line_type === '고속선';

  function trackColor(track: TrackName, checked: boolean) {
    if (!checked) return 'bg-gray-100 text-gray-500';
    if (track.startsWith('T')) { const n = parseInt(track.slice(1)); return n % 2 === 1 ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'; }
    return track.startsWith('상') ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* 헤더 */}
        <div className="px-5 py-2.5 border-b flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-sm">{initial ? '차단명령 수정' : '차단명령 등록'}</h2>
          <div className="flex items-center gap-2">
            <>
              {pendingPdfFile && (
                <span className="text-xs text-blue-600 max-w-[140px] truncate" title={pendingPdfFile.name}>
                  {pendingPdfFile.name}
                </span>
              )}
              <button type="button" onClick={() => pdfInputRef.current?.click()}
                className="px-3 py-1 text-xs border rounded-lg text-gray-600 hover:bg-gray-50">
                {pendingPdfFile ? 'PDF 변경' : '근거문서 PDF 첨부'}
              </button>
              {pendingPdfFile && (
                <button type="button" onClick={() => setPendingPdfFile(null)}
                  className="text-xs text-red-400 hover:text-red-600">✕</button>
              )}
              <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden" onChange={handlePdfSelected} />
            </>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-5 py-3 space-y-3">

          {/* ① 기본정보 */}
          <Section title="기본정보">
            {/* 시행주체 — 장비/인력동원 체크박스 제거 */}
            <Row>
              <L w="w-16">시행주체 *</L>
              {IMPLEMENTERS.map((imp) => (
                <button key={imp} type="button"
                  onClick={() => { set('implementer', imp); set('is_external', imp === '외부'); }}
                  className={`px-2.5 py-0.5 text-xs rounded border font-medium transition-colors ${
                    form.implementer === imp
                      ? imp === '외부' ? 'bg-yellow-500 text-white border-yellow-500' : 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}>{imp}</button>
              ))}
            </Row>

            {/* 사업명 */}
            <Row>
              <L w="w-16">사업명</L>
              <select value={form.project_id ?? ''} onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                const proj = projects.find(p => p.id === id);
                set('project_id', id);
                if (proj) set('project_name', proj.name);
              }} className={`${SI} flex-1`}>
                <option value="">없음</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>[{p.project_type}] {p.name}{p.status !== '진행중' ? ` (${p.status})` : ''}</option>
                ))}
              </select>
              <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="신규 공사명" className={`${SI} w-28`} />
              <button type="button" disabled={!newProjectName.trim() || createProjectMut.isPending}
                onClick={() => createProjectMut.mutate({ name: newProjectName.trim(), project_type: '공사', implementer: form.implementer ?? '철도공사', status: '진행중' })}
                className="px-2 py-0.5 text-xs bg-green-600 text-white rounded disabled:opacity-40 hover:bg-green-700 whitespace-nowrap">
                + 등록
              </button>
            </Row>

            {/* 작업내용 */}
            <Row>
              <L w="w-16">작업내용 *</L>
              <textarea rows={2} value={form.reason ?? ''} onChange={(e) => set('reason', e.target.value)}
                placeholder="예: 경부선 안양~의왕간 레일 교환 작업"
                className={`${SI} flex-1 resize-none`} />
            </Row>

            {/* 작업형태 */}
            <Row>
              <L w="w-16">작업형태 *</L>
              {WORK_TYPES.map(({ value, label, desc }) => (
                <button key={value} type="button" onClick={() => set('work_type', value)} title={desc}
                  className={`px-2.5 py-0.5 text-xs rounded border font-medium transition-colors ${
                    form.work_type === value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}>{label}</button>
              ))}
            </Row>

            {/* 관련근거 */}
            <Row>
              <L w="w-16">승인문서번호</L>
              <input type="text" value={form.doc_no ?? ''} onChange={(e) => set('doc_no', e.target.value)}
                placeholder="시행문 문서번호" className={`${SI} flex-1`} />
              <L w="w-12">승인일자</L>
              <input type="date" value={form.approved_date ?? ''} onChange={(e) => set('approved_date', e.target.value || null)} className={SI} />
            </Row>
          </Section>

          {/* ② 작업 구간 및 일시 */}
          <Section title="작업 구간 및 일시">
            {/* 소속조직 + 분야 — 한 줄 */}
            <Row>
              <L w="w-16">소속조직</L>
              {isSuperuser ? (
                <select value={form.organization_id ?? ''} onChange={(e) => set('organization_id', e.target.value ? Number(e.target.value) : undefined)} className={`${SI} w-52`}>
                  <option value="">선택 (없음)</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : (
                <span className="w-52 text-sm text-gray-700">{user?.organization_name ?? '—'}</span>
              )}
              <L w="w-8">분야</L>
              <select value={form.field} onChange={(e) => set('field', e.target.value)} className={`${SI} w-20`} disabled={!!userField}>
                {availableFields.map((f) => <option key={f}>{f}</option>)}
              </select>
            </Row>

            {/* 작업노선 + 본선/기지 탭 → 차단종류 */}
            <Row>
              <L w="w-16">작업노선 *</L>
              {isDepot ? (
                <SearchableSelect
                  options={depots}
                  value={form.rail_route_id}
                  onChange={(id) => set('rail_route_id', id)}
                  placeholder="기지 검색..."
                  getLabel={(d) => `${d.name}${d.route_category ? ` (${d.route_category})` : ''}`}
                  className="flex-1"
                />
              ) : (
                <SearchableSelect
                  options={routes}
                  value={form.route_id > 0 ? form.route_id : null}
                  onChange={(id) => {
                    const newRouteId = id ?? 0;
                    const newRoute = routes.find(r => r.id === newRouteId);
                    const newTracks = availableTracks(newRoute?.default_track_count ?? 2);
                    const validTracks = (form.tracks as TrackName[]).filter(t => newTracks.includes(t));
                    setForm(f => ({
                      ...f,
                      route_id: newRouteId,
                      tracks: validTracks.length > 0 ? validTracks : [newTracks[0]],
                    }));
                  }}
                  placeholder="노선 검색..."
                  getLabel={(r) => r.name}
                  className="flex-1"
                />
              )}
              <button type="button"
                onClick={() => { setRouteType('line'); setForm((f) => ({ ...f, rail_route_id: null, track_name: null, tracks: ['하선'] as TrackName[] })); }}
                className={`px-2.5 py-0.5 text-xs rounded border font-medium shrink-0 transition-colors ${routeType === 'line' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                역간
              </button>
              <button type="button"
                onClick={() => { setRouteType('yard'); setForm((f) => ({ ...f, rail_route_id: null, start_km: null, end_km: null })); }}
                className={`px-2.5 py-0.5 text-xs rounded border font-medium shrink-0 transition-colors ${routeType === 'yard' ? 'bg-purple-600 text-white border-purple-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                역구내
              </button>
              <button type="button"
                onClick={() => { setRouteType('depot'); setForm((f) => ({ ...f, route_id: 0, start_km: null, end_km: null, tracks: ['상선', '하선'] as TrackName[] })); }}
                className={`px-2.5 py-0.5 text-xs rounded border font-medium shrink-0 transition-colors ${isDepot ? 'bg-orange-600 text-white border-orange-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                기지
              </button>
              <span className="w-px h-4 bg-gray-200 shrink-0" />
              <L w="w-14">차단종류</L>
              <select value={form.block_type} onChange={(e) => set('block_type', e.target.value)} className={`${SI} w-36`}>
                {/* 현재 값이 목록에 없으면 추가 (기존 데이터 보호) */}
                {!BLOCK_TYPES.includes(form.block_type) && (
                  <option value={form.block_type}>{form.block_type}</option>
                )}
                {BLOCK_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Row>

            {/* 역구내/기지 선로·구역명 */}
            {(isDepot || isYard) && (
              <Row>
                <L w="w-16">{isYard ? '역/구역명' : '선로/구역명'}</L>
                <input type="text" value={form.track_name ?? ''} onChange={(e) => set('track_name', e.target.value || null)}
                  placeholder={isYard ? '예: 수원역구내, 서울역 3번홈' : '예: 유치선1, 검수선A, 전체'} className={`${SI} flex-1`} />
              </Row>
            )}

            {/* 작업구간: 역간 전용 (시작역 ~ 종료역) */}
            {!isDepot && !isYard && (
              <Row>
                <L w="w-16">작업구간</L>
                <input type="text" value={form.start_station_name ?? ''} onChange={(e) => set('start_station_name', e.target.value)}
                  placeholder="시작역" className={`${SI} flex-1`} />
                <span className="text-xs text-gray-400 shrink-0">~</span>
                <input type="text" value={form.end_station_name ?? ''} onChange={(e) => set('end_station_name', e.target.value)}
                  placeholder="종료역" className={`${SI} flex-1`} />
              </Row>
            )}

            {/* 작업선로 + KP: 역구내·고속선·2복선+=셀렉터 / 복선 역간=간단 버튼 */}
            {!isDepot && (
              <Row>
                <L w="w-16">작업선로 *</L>
                {(isYard || isHighSpeed || (selectedRoute?.default_track_count ?? 2) >= 4) ? (
                  // 역구내·고속선·2복선+: 드롭다운 다중선택
                  <TrackMultiSelect
                    options={getTrackOptions(selectedRoute?.default_track_count ?? 2, isHighSpeed)}
                    value={form.tracks as string[]}
                    onChange={(tracks) => set('tracks', tracks as TrackName[])}
                  />
                ) : (
                  // 복선 역간: 상선/하선/상하선 버튼
                  <>
                    {SIMPLE_TRACKS.map((mode) => {
                      const isActive = getSimpleTrack() === mode;
                      return (
                        <button key={mode} type="button" onClick={() => setSimpleTrack(mode)}
                          className={`px-2.5 py-0.5 text-xs rounded border font-medium transition-colors ${
                            isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                          }`}>{mode}</button>
                      );
                    })}
                  </>
                )}
                <span className="w-px h-4 bg-gray-200 shrink-0 mx-0.5" />
                {isYard && <span className="text-xs text-gray-400 shrink-0">(KP 선택)</span>}
                <span className="text-xs text-gray-500 shrink-0">시작</span>
                <input type="number" step="0.1" min="0"
                  value={form.start_km ?? ''}
                  onChange={(e) => set('start_km', e.target.value === '' ? null : Number(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  placeholder="0.0"
                  className={`${SI} w-20`} />
                <span className="text-xs text-gray-500 shrink-0">km  종료</span>
                <input type="number" step="0.1" min="0"
                  value={form.end_km ?? ''}
                  onChange={(e) => set('end_km', e.target.value === '' ? null : Number(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  placeholder="0.0"
                  className={`${SI} w-20`} />
                <span className="text-xs text-gray-500 shrink-0">km</span>
              </Row>
            )}

            {/* 전차선 단전 — 역간·역구내·기지 모두 표시 */}
            <Row>
              <L w="w-16">전차선 단전</L>
              {substations.length > 0 ? (
                <>
                  <SearchableSelect
                    options={substations}
                    value={form.start_rail_facility_id}
                    onChange={(id) => setForm(f => ({ ...f, start_rail_facility_id: id, section_note: buildSectionNote(id, f.end_rail_facility_id, catenaryTracks) }))}
                    placeholder="변전소(시작) 검색..."
                    getLabel={(s) => `${s.name}${s.detail_category ? ` (${s.detail_category})` : ''} ${s.kp}km`}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-400 shrink-0">~</span>
                  <SearchableSelect
                    options={substations}
                    value={form.end_rail_facility_id}
                    onChange={(id) => setForm(f => ({ ...f, end_rail_facility_id: id, section_note: buildSectionNote(f.start_rail_facility_id, id, catenaryTracks) }))}
                    placeholder="변전소(종료) 검색..."
                    getLabel={(s) => `${s.name}${s.detail_category ? ` (${s.detail_category})` : ''} ${s.kp}km`}
                    className="flex-1"
                  />
                </>
              ) : (
                <span className="text-xs text-gray-400 italic">
                  {(form.route_id || form.rail_route_id) ? '이 노선의 변전설비 없음' : '노선 선택 후 로드됩니다'}
                </span>
              )}
              <L w="w-14">단전구간</L>
              <TrackMultiSelect
                options={getTrackOptions(selectedRoute?.default_track_count ?? 2, isHighSpeed)}
                value={catenaryTracks}
                onChange={(tracks) => {
                  setCatenaryTracks(tracks);
                  setForm(f => ({ ...f, section_note: buildSectionNote(f.start_rail_facility_id, f.end_rail_facility_id, tracks) }));
                }}
                allowEmpty
                className="w-32"
              />
            </Row>

            {/* 작업 일시 */}
            <Row>
              <L w="w-16">작업일자 *</L>
              <input type="date" value={form.work_date} onChange={(e) => set('work_date', e.target.value)} className={SI} required />
              <L w="w-12">시작시각 *</L>
              <input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} className={SI} required />
              <L w="w-12">종료시각 *</L>
              <input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} className={SI} required />
            </Row>
          </Section>

          {/* ③ 투입 장비 */}
          <Section title="투입 장비">
            <Row>
              <L w="w-16">투입장비</L>
              <input type="text" value={form.equipment_name ?? ''} onChange={(e) => set('equipment_name', e.target.value)}
                placeholder="예: MTT, 레일연마기, 유압크레인" className={`${SI} flex-1`} />
              <L w="w-12">작업자수</L>
              <input type="number" min={0} value={form.worker_count ?? ''} onChange={(e) => set('worker_count', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="인원" className={`${SI} w-16`} />
              <span className="text-xs text-gray-500 shrink-0">명</span>
            </Row>
            <Row>
              <L w="w-16">열차서행</L>
              <input type="number" min={0} max={300} step={5} value={form.speed_restriction ?? ''} onChange={(e) => set('speed_restriction', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="속도" className={`${SI} w-16`} />
              <span className="text-xs text-gray-500 shrink-0">km/h</span>
              <input type="text" value={form.speed_restriction_note ?? ''} onChange={(e) => set('speed_restriction_note', e.target.value)}
                placeholder="구간 또는 사유" className={`${SI} flex-1`} />
            </Row>
          </Section>

          {/* ④ 작업 관계자 */}
          <Section title="작업 관계자">
            <div className="grid grid-cols-[9.5rem_1fr_1fr] gap-x-2 gap-y-1 items-center">
              <span className="text-[10px] text-gray-400"></span>
              <span className="text-[10px] text-gray-400 pl-1">성명</span>
              <span className="text-[10px] text-gray-400 pl-1">연락처</span>

              <span className="text-xs text-gray-700">작업책임자 *</span>
              <input type="text" value={form.work_supervisor} onChange={(e) => set('work_supervisor', e.target.value)} className={SI} required />
              <input type="tel" value={form.work_supervisor_phone ?? ''} onChange={(e) => set('work_supervisor_phone', e.target.value)} placeholder="010-0000-0000" className={SI} />

              <span className="text-xs text-gray-700">철도운행안전관리자 *</span>
              <input type="text" value={form.safety_manager} onChange={(e) => set('safety_manager', e.target.value)} className={SI} required />
              <input type="tel" value={form.safety_manager_phone ?? ''} onChange={(e) => set('safety_manager_phone', e.target.value)} placeholder="010-0000-0000" className={SI} />

              <span className="text-xs text-gray-700">전기철도안전관리자</span>
              <input type="text" value={form.electric_safety_manager ?? ''} onChange={(e) => set('electric_safety_manager', e.target.value)} className={SI} />
              <input type="tel" value={form.electric_safety_manager_phone ?? ''} onChange={(e) => set('electric_safety_manager_phone', e.target.value)} placeholder="010-0000-0000" className={SI} />

              <span className="text-xs text-gray-700">시행부서장</span>
              <input type="text" value={form.dept_head ?? ''} onChange={(e) => set('dept_head', e.target.value)} className={SI} />
              <input type="tel" value={form.dept_head_phone ?? ''} onChange={(e) => set('dept_head_phone', e.target.value)} placeholder="010-0000-0000" className={SI} />

              <span className="text-xs text-gray-700">시공사</span>
              <input type="text" value={form.contractor ?? ''} onChange={(e) => set('contractor', e.target.value)} className={SI} />
              <input type="tel" value={form.contractor_phone ?? ''} onChange={(e) => set('contractor_phone', e.target.value)} placeholder="010-0000-0000" className={SI} />

              <span className="text-xs text-gray-700">열차감시원</span>
              <input type="text" value={form.train_watcher ?? ''} onChange={(e) => set('train_watcher', e.target.value)} className={SI} />
              <input type="tel" value={form.train_watcher_phone ?? ''} onChange={(e) => set('train_watcher_phone', e.target.value)} placeholder="010-0000-0000" className={SI} />
            </div>
          </Section>

          {/* ⑤ 안전관리 */}
          <Section title="안전관리">
            <Row>
              <L w="w-16">위험등급</L>
              {([null, 'A', 'B', 'C'] as const).map((lv) => {
                const labels: Record<string, string> = { A: 'A — 위험', B: 'B — 주의', C: 'C — 일반' };
                const colors: Record<string, string> = { A: 'border-red-500 bg-red-50 text-red-700', B: 'border-amber-500 bg-amber-50 text-amber-700', C: 'border-green-500 bg-green-50 text-green-700' };
                const sel = form.danger_level === lv;
                return (
                  <button key={String(lv)} type="button" onClick={() => set('danger_level', lv)}
                    className={`px-2.5 py-0.5 text-xs rounded border font-medium transition-colors ${sel ? (lv ? colors[lv] : 'border-gray-400 bg-gray-100 text-gray-700') : 'border-gray-200 text-gray-400 hover:border-gray-300'}`}>
                    {lv ? labels[lv] : '미지정'}
                  </button>
                );
              })}
            </Row>
            <Row>
              <L w="w-16">전차선 보호</L>
              {(['양단접지', '단접지'] as const).map((v) => (
                <button key={v} type="button"
                  onClick={() => set('catenary_protection', form.catenary_protection === v ? null : v)}
                  className={`px-2.5 py-0.5 text-xs rounded border transition-colors ${form.catenary_protection === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                  {v}
                </button>
              ))}
              {form.catenary_protection && (
                <button type="button" onClick={() => set('catenary_protection', null)} className="text-xs text-gray-400 hover:text-gray-600">해제</button>
              )}
            </Row>
            <Row>
              <L w="w-16">보호조치코드</L>
              <span className="text-[10px] text-gray-400 mr-1">(고속선)</span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] text-gray-500 shrink-0">ZEP</span>
                  <input type="text" value={form.zep ?? ''} onChange={(e) => set('zep', e.target.value)} className={`${SI} w-16`} />
                </div>
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] text-gray-500 shrink-0">ZCP</span>
                  <input type="text" value={form.zcp ?? ''} onChange={(e) => set('zcp', e.target.value)} className={`${SI} w-16`} />
                </div>
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] text-gray-500 shrink-0">CPT</span>
                  <input type="text" value={form.cpt ?? ''} onChange={(e) => set('cpt', e.target.value)} className={`${SI} w-16`} />
                </div>
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] text-gray-500 shrink-0">TZEP</span>
                  <input type="text" value={form.tzep ?? ''} onChange={(e) => set('tzep', e.target.value)} className={`${SI} w-16`} />
                </div>
              </div>
            </Row>
            <Row>
              <L w="w-16">안전관리항목</L>
              <textarea rows={2} value={form.safety_items ?? ''} onChange={(e) => set('safety_items', e.target.value)}
                placeholder="항목별 줄바꿈 입력" className={`${SI} flex-1 resize-none`} />
            </Row>
            <Row>
              <L w="w-16">비고</L>
              <textarea rows={1} value={form.note ?? ''} onChange={(e) => set('note', e.target.value)}
                className={`${SI} flex-1 resize-none`} />
            </Row>
          </Section>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </form>

        {/* 푸터 */}
        <div className="px-5 py-2.5 border-t flex justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50">취소</button>
          <button type="button" onClick={handleSubmit} disabled={isPending}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 유틸 컴포넌트 ─────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest whitespace-nowrap">{title}</span>
        <div className="h-px bg-gray-200 flex-1" />
      </div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 flex-wrap">{children}</div>;
}

function L({ w = 'w-20', children }: { w?: string; children: React.ReactNode }) {
  return <span className={`${w} shrink-0 text-xs text-gray-600 whitespace-nowrap`}>{children}</span>;
}

const SI = 'border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';

// ── 다중선택 선로 셀렉터 ──────────────────────────────────────────────────────
function TrackMultiSelect({
  options,
  value,
  onChange,
  allowEmpty = false,
  className = '',
}: {
  options: TrackOption[];
  value: string[];
  onChange: (tracks: string[]) => void;
  allowEmpty?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  function toggle(v: string) {
    if (value.includes(v)) {
      const next = value.filter(t => t !== v);
      if (next.length > 0 || allowEmpty) onChange(next);
    } else {
      onChange([...value, v]);
    }
  }

  const label =
    value.length === 0 ? '없음' :
    value.length <= 3 ? value.join(', ') :
    `${value.length}선 선택`;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`${SI} flex items-center gap-1 min-w-[80px] w-full`}
      >
        <span className="flex-1 text-left text-xs truncate">{label}</span>
        <span className="text-gray-400 text-[10px] shrink-0">▾</span>
      </button>
      {open && (
        <div
          className="absolute z-50 bg-white border border-gray-200 rounded shadow-lg p-2 min-w-max"
          style={{ top: '100%', left: 0 }}
        >
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {options.map(opt => {
              const checked = value.includes(opt.value);
              return (
                <label key={opt.value} className="flex items-center gap-2 px-1 py-0.5 rounded cursor-pointer hover:bg-gray-50 select-none">
                  <input type="checkbox" checked={checked} onChange={() => toggle(opt.value)} className="rounded" />
                  <span className={`text-xs font-medium ${opt.isUp ? 'text-blue-700' : 'text-orange-700'}`}>
                    {opt.label}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="border-t mt-1 pt-1 flex gap-2">
            <button type="button" className="text-[10px] text-blue-600 hover:underline"
              onMouseDown={(e) => { e.preventDefault(); onChange(options.map(o => o.value)); }}>
              전체선택
            </button>
            {allowEmpty && value.length > 0 && (
              <button type="button" className="text-[10px] text-gray-500 hover:underline"
                onMouseDown={(e) => { e.preventDefault(); onChange([]); }}>
                전체해제
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 검색형 콤보박스 ────────────────────────────────────────────────────────────
// 항목이 많은 노선·변전소 등 — 텍스트 검색이 기본, 전체 목록은 포커스 시 드롭다운으로 보조

function SearchableSelect<T extends { id: number }>({
  options,
  value,
  onChange,
  placeholder = '검색...',
  getLabel,
  className = '',
}: {
  options: T[];
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  placeholder?: string;
  getLabel: (item: T) => string;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = options.find(o => o.id === value);
  const filtered = query.trim().length > 0
    ? options.filter(o => getLabel(o).toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        value={open ? query : (selected ? getLabel(selected) : '')}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className={`${SI} w-full ${selected && !open ? 'pr-6' : ''}`}
        autoComplete="off"
      />
      {selected && !open && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onChange(null); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs leading-none"
        >✕</button>
      )}
      {open && (
        <ul className="absolute z-50 min-w-full bg-white border border-gray-200 rounded shadow-lg max-h-52 overflow-y-auto text-sm" style={{ top: '100%', left: 0 }}>
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-400 italic">
              {query.trim().length > 0 ? '검색 결과 없음' : '항목 없음'}
            </li>
          ) : (
            <>
              {filtered.slice(0, 60).map(item => (
                <li
                  key={item.id}
                  onMouseDown={() => { onChange(item.id); setOpen(false); setQuery(''); }}
                  className={`px-3 py-1.5 cursor-pointer hover:bg-blue-50 whitespace-nowrap ${value === item.id ? 'bg-blue-100 font-medium' : ''}`}
                >
                  {getLabel(item)}
                </li>
              ))}
              {filtered.length > 60 && (
                <li className="px-3 py-1 text-xs text-gray-400 italic border-t">
                  +{filtered.length - 60}개 더 있음 — 검색어를 입력하세요
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
