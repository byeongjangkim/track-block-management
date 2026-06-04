import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createBlockOrder, updateBlockOrder, parsePdfForBlockOrder } from '../../api/blockOrders';
import { fetchRoutes } from '../../api/routes';
import { fetchOrganizations } from '../../api/organizations';
import { fetchDepotRoutes, fetchRailSubstations } from '../../api/map';
import { useAuthStore } from '../../store/authStore';
import type { BlockOrder, BlockOrderCreate, TrackName } from '../../types';
import { availableTracks, HIGH_SPEED_TRACKS, T_TRACK_LABEL } from '../../types';
import type { AxiosError } from 'axios';

interface Props {
  initial?: BlockOrder;                        // 수정 시
  initialValues?: Partial<BlockOrderCreate>;   // PDF 추출값 자동 채움 (신규 등록 시)
  lowConfidence?: boolean;                     // PDF 파싱 신뢰도 < 0.6 경고 표시
  onClose: () => void;
}

const ALL_FIELDS    = ['시설', '전기', '건축'];
const BLOCK_TYPES   = ['선로차단', '전차선단전', '작업구간설정', '보호지구작업', '임시완속', '속도제한'];
const POWER_CUT_TYPE = '전차선단전';
const WORK_TYPES    = [
  { value: '인력', label: '인력작업', desc: '밀차 등 인력·공기구류' },
  { value: '장비', label: '장비작업', desc: '보선장비·전철장비 등 철도차량' },
  { value: '기계', label: '기계작업', desc: '건설기계관리법 상 건설기계' },
];
const IMPLEMENTERS  = ['철도공사', '철도공단', '외부'];
type RouteType = 'line' | 'depot';

function today() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY: BlockOrderCreate = {
  route_id: 0,
  rail_route_id: null,
  tracks: ['하선'] as TrackName[],
  track_name: null,
  start_km: 0,
  end_km: 0,
  section_note: '',
  start_facility_id: null,
  end_facility_id: null,
  start_rail_facility_id: null,
  end_rail_facility_id: null,
  danger_level: null,
  parent_id: null,
  equipment_name: '',
  speed_restriction: null,
  speed_restriction_note: '',
  catenary_protection: null,
  zep: '',
  zcp: '',
  cpt: '',
  tzep: '',
  worker_count: null,
  work_date: today(),
  start_time: '09:00',
  end_time: '17:00',
  field: ALL_FIELDS[0],
  block_type: '선로차단',
  work_type: null,
  has_equipment: false,
  has_labor: true,
  implementer: '철도공사',
  is_external: false,
  doc_no: '',
  dept_head: '',
  dept_head_phone: '',
  work_supervisor: '',
  work_supervisor_phone: '',
  safety_manager: '',
  safety_manager_phone: '',
  electric_safety_manager: '',
  electric_safety_manager_phone: '',
  contractor: '',
  train_watcher: '',
  train_watcher_phone: '',
  safety_items: '',
  note: '',
};

export default function BlockOrderForm({ initial, initialValues, lowConfidence, onClose }: Props) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isSuperuser = user?.role === 'system_superuser';

  const userField = user?.field && user.field !== 'all' ? user.field : null;
  const availableFields = userField ? [userField] : ALL_FIELDS;

  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: fetchRoutes });
  const { data: depots = [] } = useQuery({ queryKey: ['depot-routes'], queryFn: fetchDepotRoutes, staleTime: Infinity });
  const { data: orgs = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: fetchOrganizations,
    enabled: isSuperuser,
    staleTime: Infinity,
  });

  const [form, setForm] = useState<BlockOrderCreate>(() =>
    initial
      ? {
          route_id: initial.route_id,
          organization_id: initial.organization_id ?? undefined,
          tracks: initial.tracks,
          start_km: initial.start_km ?? 0,
          end_km: initial.end_km ?? 0,
          section_note: initial.section_note ?? '',
          start_facility_id: initial.start_facility_id ?? null,
          end_facility_id: initial.end_facility_id ?? null,
          start_rail_facility_id: initial.start_rail_facility_id ?? null,
          end_rail_facility_id: initial.end_rail_facility_id ?? null,
          danger_level: initial.danger_level ?? null,
          parent_id: initial.parent_id ?? null,
          equipment_name: initial.equipment_name ?? '',
          speed_restriction: initial.speed_restriction ?? null,
          speed_restriction_note: initial.speed_restriction_note ?? '',
          catenary_protection: initial.catenary_protection ?? null,
          zep:  initial.zep  ?? '',
          zcp:  initial.zcp  ?? '',
          cpt:  initial.cpt  ?? '',
          tzep: initial.tzep ?? '',
          worker_count: initial.worker_count ?? null,
          work_date: initial.work_date,
          start_time: initial.start_time.slice(0, 5),
          end_time: initial.end_time.slice(0, 5),
          field: initial.field,
          block_type: initial.block_type,
          work_type: initial.work_type ?? null,
          has_equipment: initial.has_equipment,
          has_labor: initial.has_labor,
          implementer: initial.implementer ?? '철도공사',
          is_external: initial.is_external,
          doc_no: initial.doc_no ?? '',
          dept_head: initial.dept_head ?? '',
          dept_head_phone: initial.dept_head_phone ?? '',
          work_supervisor: initial.work_supervisor,
          work_supervisor_phone: initial.work_supervisor_phone ?? '',
          safety_manager: initial.safety_manager,
          safety_manager_phone: initial.safety_manager_phone ?? '',
          electric_safety_manager: initial.electric_safety_manager ?? '',
          electric_safety_manager_phone: initial.electric_safety_manager_phone ?? '',
          contractor: initial.contractor ?? '',
          train_watcher: initial.train_watcher ?? '',
          train_watcher_phone: initial.train_watcher_phone ?? '',
          safety_items: initial.safety_items ?? '',
          note: initial.note ?? '',
        }
      : {
          ...EMPTY,
          field: userField ?? ALL_FIELDS[0],
          organization_id: isSuperuser ? undefined : (user?.organization_id ?? undefined),
          ...initialValues,
        }
  );

  // 노선 유형: 'line'=일반 본선, 'depot'=기지
  const [routeType, setRouteType] = useState<RouteType>(() =>
    initial?.rail_route_id && !initial?.route_id ? 'depot' : 'line'
  );
  const isDepot = routeType === 'depot';

  // 노선 목록 로드 후 기본값 설정 (신규 등록, 본선 모드)
  useEffect(() => {
    if (!initial && !isDepot && routes.length > 0 && form.route_id === 0) {
      setForm((f) => ({ ...f, route_id: routes[0].id }));
    }
  }, [routes, initial, isDepot, form.route_id]);

  // org_admin: 자기 조직 자동 설정
  useEffect(() => {
    if (!isSuperuser && user?.organization_id && !form.organization_id) {
      setForm((f) => ({ ...f, organization_id: user.organization_id ?? undefined }));
    }
  }, [isSuperuser, user?.organization_id, form.organization_id]);

  const [error, setError] = useState('');

  // 전차선 단전 시 변전소 목록 — rail_facilities 변전설비 (SS/SP/SSP/PP/ATP 등)
  const substationsRouteId = isDepot ? undefined : (form.route_id || undefined);
  const substationsRailRouteId = isDepot ? (form.rail_route_id || undefined) : undefined;
  const { data: substations = [] } = useQuery({
    queryKey: ['rail-substations', substationsRouteId, substationsRailRouteId],
    queryFn: () => fetchRailSubstations({
      route_id: substationsRouteId,
      rail_route_id: substationsRailRouteId,
    }),
    enabled: form.block_type === POWER_CUT_TYPE && (!!substationsRouteId || !!substationsRailRouteId),
    staleTime: 60_000,
  });

  // PDF 파싱 상태
  const [isParsing, setIsParsing] = useState(false);
  const [parsedLowConf, setParsedLowConf] = useState(lowConfidence ?? false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof BlockOrderCreate>(key: K, value: BlockOrderCreate[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function extractError(err: unknown): string {
    const ae = err as AxiosError<{ detail: string }>;
    return ae?.response?.data?.detail ?? '저장 중 오류가 발생했습니다.';
  }

  async function handlePdfSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsParsing(true);
    try {
      const result = await parsePdfForBlockOrder(file);
      if (result.error) {
        setError(`PDF 파싱 오류: ${result.error}`);
        return;
      }
      // route_name → route_id 매칭
      const matched = routes.find((r) =>
        result.route_name
          ? r.name.includes(result.route_name) || result.route_name.includes(r.name)
          : false
      );
      setForm((f) => ({
        ...f,
        ...(matched ? { route_id: matched.id } : {}),
        ...(result.tracks ? { tracks: result.tracks } : {}),
        ...(result.start_km != null ? { start_km: result.start_km } : {}),
        ...(result.end_km != null ? { end_km: result.end_km } : {}),
        ...(result.work_date ? { work_date: result.work_date } : {}),
        ...(result.start_time ? { start_time: result.start_time } : {}),
        ...(result.end_time ? { end_time: result.end_time } : {}),
        ...(result.field ? { field: result.field } : {}),
        ...(result.block_type ? { block_type: result.block_type } : {}),
        ...(result.dept_head ? { dept_head: result.dept_head } : {}),
        ...(result.dept_head_phone ? { dept_head_phone: result.dept_head_phone } : {}),
        ...(result.work_supervisor ? { work_supervisor: result.work_supervisor } : {}),
        ...(result.work_supervisor_phone ? { work_supervisor_phone: result.work_supervisor_phone } : {}),
        ...(result.safety_manager ? { safety_manager: result.safety_manager } : {}),
        ...(result.safety_manager_phone ? { safety_manager_phone: result.safety_manager_phone } : {}),
        ...(result.electric_safety_manager ? { electric_safety_manager: result.electric_safety_manager } : {}),
        ...(result.electric_safety_manager_phone ? { electric_safety_manager_phone: result.electric_safety_manager_phone } : {}),
        ...(result.contractor ? { contractor: result.contractor } : {}),
        ...(result.train_watcher ? { train_watcher: result.train_watcher } : {}),
        ...(result.train_watcher_phone ? { train_watcher_phone: result.train_watcher_phone } : {}),
      }));
      setParsedLowConf(result.confidence < 0.6);
      setError('');
    } catch {
      setError('PDF 분석 중 오류가 발생했습니다.');
    } finally {
      setIsParsing(false);
    }
  }

  const createMut = useMutation({
    mutationFn: createBlockOrder,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['block-orders'] }); onClose(); },
    onError: (err) => setError(extractError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<BlockOrderCreate> }) =>
      updateBlockOrder(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['block-orders'] }); onClose(); },
    onError: (err) => setError(extractError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const isPowerCut = form.block_type === POWER_CUT_TYPE;

    if (isDepot) {
      if (!form.rail_route_id) { setError('기지를 선택하세요.'); return; }
    } else {
      if (form.route_id === 0) { setError('노선을 선택하세요.'); return; }
    }
    if (isPowerCut) {
      if (!form.start_rail_facility_id) { setError('시작 변전소를 선택하세요.'); return; }
      if (!form.end_rail_facility_id)   { setError('종료 변전소를 선택하세요.'); return; }
    } else if (!isDepot) {
      if ((form.start_km ?? 0) >= (form.end_km ?? 0)) {
        setError('종료 거리정은 시작 거리정보다 커야 합니다.'); return;
      }
    }
    if (!form.work_supervisor.trim()) { setError('작업책임자를 입력하세요.'); return; }
    if (!form.safety_manager.trim()) { setError('안전관리자를 입력하세요.'); return; }

    const payload: BlockOrderCreate = {
      ...form,
      // 기지 모드: route_id=null, rail_route_id=기지 ID
      route_id:      isDepot ? null : form.route_id,
      rail_route_id: isDepot ? form.rail_route_id : form.rail_route_id,
      track_name:    isDepot ? (form.track_name?.trim() || null) : null,
      start_km:      isPowerCut || isDepot ? null : form.start_km,
      end_km:        isPowerCut || isDepot ? null : form.end_km,
      start_facility_id:      null,  // 레거시 — 신규 등록 시 미사용
      end_facility_id:        null,
      start_rail_facility_id: isPowerCut ? form.start_rail_facility_id : null,
      end_rail_facility_id:   isPowerCut ? form.end_rail_facility_id   : null,
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
      zep:  form.zep?.trim()  || undefined,
      zcp:  form.zcp?.trim()  || undefined,
      cpt:  form.cpt?.trim()  || undefined,
      tzep: form.tzep?.trim() || undefined,
      worker_count: form.worker_count ?? undefined,
      note: form.note?.trim() || undefined,
    };

    if (initial) {
      updateMut.mutate({ id: initial.id, body: payload });
    } else {
      createMut.mutate(payload);
    }
  }

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* 헤더 */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-lg">
            {initial ? '차단명령 수정' : '차단명령 등록'}
          </h2>
          <div className="flex items-center gap-2">
            {/* 시행문 PDF 불러오기 — 단건 폼 자동 채움용 */}
            {!initial && (
              <>
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={isParsing}
                  title="시행문 PDF 1개를 업로드하여 이 폼을 자동으로 채웁니다"
                  className="px-3 py-1.5 text-xs border rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {isParsing ? 'PDF 분석 중...' : '시행문 PDF 불러오기'}
                </button>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handlePdfSelected}
                />
              </>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>
        </div>

        {/* PDF 파싱 신뢰도 낮음 경고 */}
        {parsedLowConf && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 text-amber-700 text-xs">
            일부 필드를 인식하지 못했습니다. 내용을 확인 후 저장하세요.
          </div>
        )}

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-4 space-y-5">

          {/* 소속 조직 */}
          <Field label={`소속 조직${isSuperuser ? ' *' : ''}`}>
            {isSuperuser ? (
              <select
                value={form.organization_id ?? ''}
                onChange={(e) => set('organization_id', e.target.value ? Number(e.target.value) : undefined)}
                className={SELECT}
              >
                <option value="">선택 (없음)</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            ) : (
              <div className={`${INPUT} bg-gray-50 text-gray-500`}>
                {user?.organization_name ?? '—'}
              </div>
            )}
          </Field>

          {/* 노선 유형 탭 */}
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => { setRouteType('line'); setForm((f) => ({ ...f, rail_route_id: null, track_name: null, tracks: ['하선'] as TrackName[] })); }}
              className={`px-3 py-1.5 rounded-lg border font-medium transition-colors ${!isDepot ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            >
              본선 작업
            </button>
            <button
              type="button"
              onClick={() => { setRouteType('depot'); setForm((f) => ({ ...f, route_id: 0, start_km: null, end_km: null, tracks: ['상선', '하선'] as TrackName[] })); }}
              className={`px-3 py-1.5 rounded-lg border font-medium transition-colors ${isDepot ? 'bg-orange-600 text-white border-orange-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            >
              기지 작업
            </button>
          </div>

          {/* 노선 · 차단 선로 */}
          <div className="grid grid-cols-2 gap-4">
            {isDepot ? (
              <Field label="기지 *">
                <select
                  value={form.rail_route_id ?? ''}
                  onChange={(e) => set('rail_route_id', e.target.value ? Number(e.target.value) : null)}
                  className={SELECT}
                  required
                >
                  <option value="">기지 선택</option>
                  {depots.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}{d.route_category ? ` (${d.route_category})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="노선 *">
                <select
                  value={form.route_id ?? 0}
                  onChange={(e) => {
                    const newRouteId = Number(e.target.value);
                    const newRoute = routes.find(r => r.id === newRouteId);
                    const newTracks = availableTracks(newRoute?.default_track_count ?? 2);
                    // 기존 선택된 선로가 새 노선에서 유효하지 않으면 첫 번째 선로로 초기화
                    const validTracks = (form.tracks as TrackName[]).filter(t => newTracks.includes(t));
                    set('route_id', newRouteId);
                    set('tracks', validTracks.length > 0 ? validTracks : [newTracks[0]]);
                  }}
                  className={SELECT}
                  required
                >
                  <option value={0} disabled>선택</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </Field>
            )}
            {/* 차단 선로 체크박스 */}
            {(() => {
              const selectedRoute = isDepot ? null : routes.find(r => r.id === form.route_id);
              const trackCount = selectedRoute?.default_track_count ?? 2;
              const isHighSpeed = selectedRoute?.line_type === '고속선';
              const trackOptions: TrackName[] = isDepot
                ? ['상선', '하선']
                : isHighSpeed
                  ? HIGH_SPEED_TRACKS
                  : availableTracks(trackCount);

              function trackColor(track: TrackName, checked: boolean) {
                if (!checked) return 'bg-gray-100 text-gray-500';
                if (track.startsWith('T')) {
                  const n = parseInt(track.slice(1));
                  return n % 2 === 1 ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700';
                }
                return track.startsWith('상') ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700';
              }

              return (
                <Field label={`차단 선로 *${isHighSpeed ? ' (고속선 T번호)' : ''}`}>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1">
                    {trackOptions.map(track => {
                      const checked = (form.tracks as TrackName[]).includes(track);
                      const label = T_TRACK_LABEL[track] ?? track;
                      return (
                        <label key={track} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const current = form.tracks as TrackName[];
                              if (e.target.checked) {
                                set('tracks', [...current, track]);
                              } else {
                                const next = current.filter(t => t !== track);
                                if (next.length > 0) set('tracks', next);
                              }
                            }}
                            className="rounded"
                          />
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${trackColor(track, checked)}`}>
                            {label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Field>
              );
            })()}
          </div>

          {/* 기지 선로/구역명 */}
          {isDepot && (
            <Field label="선로/구역명">
              <input
                type="text"
                value={form.track_name ?? ''}
                onChange={(e) => set('track_name', e.target.value || null)}
                placeholder="예: 유치선1, 검수선A, 전체"
                className={INPUT}
              />
            </Field>
          )}

          {/* 거리정 / 변전소 — 기지 모드에서는 숨김 */}
          {!isDepot && (
            form.block_type === POWER_CUT_TYPE ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label="시작 변전소 (SP/SS/SSP) *">
                  <select
                    value={form.start_rail_facility_id ?? ''}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const sub = substations.find((s) => s.id === id);
                      const endSub = substations.find((s) => s.id === form.end_rail_facility_id);
                      setForm((f) => ({
                        ...f,
                        start_rail_facility_id: id,
                        section_note: sub && endSub ? `${sub.name}~${endSub.name}` : f.section_note,
                      }));
                    }}
                    className={SELECT}
                  >
                    <option value="">변전소 선택</option>
                    {substations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}{s.detail_category ? ` (${s.detail_category})` : ''} — {s.kp}km
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="종료 변전소 (SP/SS/SSP) *">
                  <select
                    value={form.end_rail_facility_id ?? ''}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const startSub = substations.find((s) => s.id === form.start_rail_facility_id);
                      const sub = substations.find((s) => s.id === id);
                      setForm((f) => ({
                        ...f,
                        end_rail_facility_id: id,
                        section_note: startSub && sub ? `${startSub.name}~${sub.name}` : f.section_note,
                      }));
                    }}
                    className={SELECT}
                  >
                    <option value="">변전소 선택</option>
                    {substations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}{s.detail_category ? ` (${s.detail_category})` : ''} — {s.kp}km
                      </option>
                    ))}
                  </select>
                </Field>
                {substations.length === 0 && (
                  <p className="col-span-2 text-xs text-amber-600">
                    이 노선에 등록된 변전설비가 없습니다. 시설물 관리에서 변전설비를 먼저 등록하세요.
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Field label="시작 거리정 (km) *">
                  <input
                    type="number" step="0.1" min="0"
                    value={form.start_km ?? 0}
                    onChange={(e) => set('start_km', Number(e.target.value))}
                    className={INPUT}
                    required
                  />
                </Field>
                <Field label="종료 거리정 (km) *">
                  <input
                    type="number" step="0.1" min="0"
                    value={form.end_km ?? 0}
                    onChange={(e) => set('end_km', Number(e.target.value))}
                    className={INPUT}
                    required
                  />
                </Field>
              </div>
            )
          )}

          {/* 일시 */}
          <div className="grid grid-cols-3 gap-4">
            <Field label="작업일자 *">
              <input
                type="date"
                value={form.work_date}
                onChange={(e) => set('work_date', e.target.value)}
                className={INPUT}
                required
              />
            </Field>
            <Field label="시작 시각 *">
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => set('start_time', e.target.value)}
                className={INPUT}
                required
              />
            </Field>
            <Field label="종료 시각 *">
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => set('end_time', e.target.value)}
                className={INPUT}
                required
              />
            </Field>
          </div>

          {/* 분야·차단종류 */}
          <div className="grid grid-cols-2 gap-4">
            <Field label={`분야 *${userField ? ` (${userField} 고정)` : ''}`}>
              <select
                value={form.field}
                onChange={(e) => set('field', e.target.value)}
                className={SELECT}
                disabled={!!userField}
              >
                {availableFields.map((f) => <option key={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="차단종류 *">
              <select
                value={form.block_type}
                onChange={(e) => set('block_type', e.target.value)}
                className={SELECT}
              >
                {BLOCK_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>

          {/* 위험등급 */}
          <Field label="위험등급">
            <div className="flex gap-2">
              {([null, 'A', 'B', 'C'] as const).map((lv) => {
                const labels: Record<string, string> = { A: 'A — 위험', B: 'B — 주의', C: 'C — 일반' };
                const colors: Record<string, string> = { A: 'border-red-500 bg-red-50 text-red-700', B: 'border-amber-500 bg-amber-50 text-amber-700', C: 'border-green-500 bg-green-50 text-green-700' };
                const selected = form.danger_level === lv;
                return (
                  <button
                    key={String(lv)}
                    type="button"
                    onClick={() => set('danger_level', lv)}
                    className={`flex-1 py-1.5 text-xs rounded border font-medium transition-colors ${
                      selected
                        ? (lv ? colors[lv] : 'border-gray-400 bg-gray-100 text-gray-700')
                        : 'border-gray-200 text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    {lv ? labels[lv] : '미지정'}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* 작업형태 */}
          <Field label="작업형태 *">
            <div className="flex gap-2 flex-wrap">
              {WORK_TYPES.map(({ value, label, desc }) => (
                <label
                  key={value}
                  className={`flex-1 min-w-[6rem] border rounded-lg px-3 py-2 cursor-pointer select-none transition-colors ${
                    form.work_type === value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="work_type"
                    value={value}
                    checked={form.work_type === value}
                    onChange={() => set('work_type', value)}
                    className="hidden"
                  />
                  <div className={`text-sm font-medium ${form.work_type === value ? 'text-blue-700' : 'text-gray-700'}`}>
                    {label}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{desc}</div>
                </label>
              ))}
            </div>
          </Field>

          {/* 시행주체 */}
          <Field label="시행주체 *">
            <div className="flex gap-2">
              {IMPLEMENTERS.map((imp) => (
                <button
                  key={imp}
                  type="button"
                  onClick={() => {
                    set('implementer', imp);
                    set('is_external', imp === '외부');
                  }}
                  className={`flex-1 py-1.5 text-sm rounded border font-medium transition-colors ${
                    form.implementer === imp
                      ? imp === '외부'
                        ? 'bg-yellow-500 text-white border-yellow-500'
                        : 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {imp}
                </button>
              ))}
            </div>
          </Field>

          {/* 레거시 체크박스 (has_equipment, has_labor 보조정보) */}
          <div className="flex gap-6">
            <CheckboxField label="장비 동원" checked={form.has_equipment} onChange={(v) => set('has_equipment', v)} />
            <CheckboxField label="인력 동원" checked={form.has_labor} onChange={(v) => set('has_labor', v)} />
          </div>

          {/* 담당자 */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="작업책임자 *">
              <input type="text" value={form.work_supervisor}
                onChange={(e) => set('work_supervisor', e.target.value)}
                className={INPUT} required />
            </Field>
            <Field label="작업책임자 연락처">
              <input type="tel" value={form.work_supervisor_phone ?? ''}
                onChange={(e) => set('work_supervisor_phone', e.target.value)}
                placeholder="010-0000-0000" className={INPUT} />
            </Field>
            <Field label="철도운행안전관리자 *">
              <input type="text" value={form.safety_manager}
                onChange={(e) => set('safety_manager', e.target.value)}
                className={INPUT} required />
            </Field>
            <Field label="철도운행안전관리자 연락처">
              <input type="tel" value={form.safety_manager_phone ?? ''}
                onChange={(e) => set('safety_manager_phone', e.target.value)}
                placeholder="010-0000-0000" className={INPUT} />
            </Field>
            <Field label="전기철도안전관리자">
              <input type="text" value={form.electric_safety_manager ?? ''}
                onChange={(e) => set('electric_safety_manager', e.target.value)}
                className={INPUT} />
            </Field>
            <Field label="전기철도안전관리자 연락처">
              <input type="tel" value={form.electric_safety_manager_phone ?? ''}
                onChange={(e) => set('electric_safety_manager_phone', e.target.value)}
                placeholder="010-0000-0000" className={INPUT} />
            </Field>
            <Field label="시행부서장">
              <input type="text" value={form.dept_head ?? ''}
                onChange={(e) => set('dept_head', e.target.value)}
                className={INPUT} />
            </Field>
            <Field label="시행부서장 연락처">
              <input type="tel" value={form.dept_head_phone ?? ''}
                onChange={(e) => set('dept_head_phone', e.target.value)}
                placeholder="010-0000-0000" className={INPUT} />
            </Field>
            <Field label="시공사">
              <input type="text" value={form.contractor ?? ''}
                onChange={(e) => set('contractor', e.target.value)}
                className={INPUT} />
            </Field>
            <Field label="열차감시원">
              <input type="text" value={form.train_watcher ?? ''}
                onChange={(e) => set('train_watcher', e.target.value)}
                className={INPUT} />
            </Field>
            <Field label="열차감시원 연락처">
              <input type="tel" value={form.train_watcher_phone ?? ''}
                onChange={(e) => set('train_watcher_phone', e.target.value)}
                placeholder="010-0000-0000" className={INPUT} />
            </Field>
          </div>

          {/* 투입장비 */}
          <Field label="투입장비 (작업차량)">
            <input type="text" value={form.equipment_name ?? ''}
              onChange={(e) => set('equipment_name', e.target.value)}
              placeholder="예: MTT, 레일연마기, 유압크레인"
              className={INPUT} />
          </Field>

          {/* 열차서행 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">열차서행</label>
            <div className="flex gap-2 items-center">
              <input
                type="number" min={0} max={300} step={5}
                value={form.speed_restriction ?? ''}
                onChange={(e) => set('speed_restriction', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="제한속도"
                className={INPUT}
                style={{ width: '90px' }}
              />
              <span className="text-sm text-gray-500">km/h</span>
              <input type="text" value={form.speed_restriction_note ?? ''}
                onChange={(e) => set('speed_restriction_note', e.target.value)}
                placeholder="구간 또는 사유"
                className={INPUT} />
            </div>
          </div>

          {/* 전차선 보호장치 */}
          <Field label="전차선 보호장치">
            <div className="flex gap-2">
              {(['양단접지', '단접지'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set('catenary_protection', form.catenary_protection === v ? null : v)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    form.catenary_protection === v
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {v}
                </button>
              ))}
              {form.catenary_protection && (
                <button type="button" onClick={() => set('catenary_protection', null)}
                  className="text-xs text-gray-400 hover:text-gray-600 ml-1">
                  해제
                </button>
              )}
            </div>
          </Field>

          {/* 관제사 보호조치 / 작업자 보호조치 (고속선) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              보호조치 코드 <span className="text-gray-400 font-normal">(고속선 전용)</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-gray-500 mb-1">관제사 보호조치</div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-400">ZEP</label>
                    <input type="text" value={form.zep ?? ''}
                      onChange={(e) => set('zep', e.target.value)}
                      placeholder="ZEP 코드" className={INPUT} />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-400">ZCP</label>
                    <input type="text" value={form.zcp ?? ''}
                      onChange={(e) => set('zcp', e.target.value)}
                      placeholder="ZCP 코드" className={INPUT} />
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500 mb-1">작업자 보호조치</div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-400">CPT</label>
                    <input type="text" value={form.cpt ?? ''}
                      onChange={(e) => set('cpt', e.target.value)}
                      placeholder="CPT 코드" className={INPUT} />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-400">TZEP</label>
                    <input type="text" value={form.tzep ?? ''}
                      onChange={(e) => set('tzep', e.target.value)}
                      placeholder="TZEP 코드" className={INPUT} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 작업자 수 */}
          <Field label="작업자 수">
            <input
              type="number"
              min={0}
              value={form.worker_count ?? ''}
              onChange={(e) => set('worker_count', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="인원 수"
              className={INPUT}
              style={{ width: '120px' }}
            />
          </Field>

          {/* 안전관리항목 */}
          <Field label="안전관리항목">
            <textarea rows={3} value={form.safety_items ?? ''}
              onChange={(e) => set('safety_items', e.target.value)}
              placeholder="항목별 줄바꿈 입력"
              className={INPUT + ' resize-none'} />
          </Field>

          {/* 비고 */}
          <Field label="비고">
            <textarea rows={2} value={form.note ?? ''}
              onChange={(e) => set('note', e.target.value)}
              className={INPUT + ' resize-none'} />
          </Field>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </form>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t flex justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
            취소
          </button>
          <button type="button" onClick={handleSubmit} disabled={isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 소형 유틸 컴포넌트 ────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function CheckboxField({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded" />
      {label}
    </label>
  );
}

const INPUT = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const SELECT = INPUT;
