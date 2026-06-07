import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { bulkParsePdfs, bulkCreateBlockOrders } from '../../api/blockOrders';
import { lookupProjectByName } from '../../api/projects';
import type { ParsedRow, BulkBlockOrderItem, TrackName } from '../../types';

interface Props {
  routes: { id: number; name: string }[];
  defaultOrgId?: number;
  onClose: () => void;
  onSaved: (count: number) => void;
}

const FIELDS = ['시설', '전기', '건축'] as const;

// 일반선 + 고속선 T번호 모두 포함
const TRACK_OPTIONS: TrackName[] = [
  '상선', '하선',
  '상1', '상2', '상3', '하1', '하2', '하3',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8',
];

const VALID_TRACK_SET = new Set<string>(TRACK_OPTIONS);
function isTrackName(value: string): value is TrackName {
  return VALID_TRACK_SET.has(value);
}

// 편집 가능한 행 상태
interface EditableRow extends ParsedRow {
  _id: number;
  selected: boolean;
  route_id: number | '';
}

let _rowIdCounter = 0;
function nextId() { return ++_rowIdCounter; }

export default function PdfImportModal({ routes, defaultOrgId, onClose, onSaved }: Props) {
  const qc = useQueryClient();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [detailFile, setDetailFile] = useState<File | null>(null);
  const [selectedRouteName, setSelectedRouteName] = useState('');

  const coverInputRef = useRef<HTMLInputElement>(null);
  const detailInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<EditableRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const [saveResult, setSaveResult] = useState<{ saved: number; failed: number; errors: string[] } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function handleCoverFile(e: React.ChangeEvent<HTMLInputElement>) {
    setCoverFile(e.target.files?.[0] ?? null);
  }
  function handleDetailFile(e: React.ChangeEvent<HTMLInputElement>) {
    setDetailFile(e.target.files?.[0] ?? null);
  }

  function routeIdByName(name: string | null): number | '' {
    if (!name) return '';
    const r = routes.find((r) => r.name === name || r.name.includes(name) || name.includes(r.name));
    return r ? r.id : '';
  }

  // ── Step 1 → Step 2: 파싱 요청 ───────────────────────────────────────────────

  async function handleParse() {
    if (!coverFile && !detailFile) return;
    setIsParsing(true);
    setParseError(null);
    try {
      const result = await bulkParsePdfs({
        coverFile: coverFile ?? undefined,
        detailFile: detailFile ?? undefined,
        routeName: selectedRouteName || undefined,
      });

      if (result.error && result.rows.length === 0) {
        setParseError(result.error);
        setIsParsing(false);
        return;
      }

      const finalRouteName = selectedRouteName || result.route_name || '';
      const editableRows: EditableRow[] = result.rows.map((row) => ({
        ...row,
        _id: nextId(),
        selected: !row.needs_review,
        route_id: routeIdByName(row.route_name || finalRouteName),
        route_name: row.route_name || finalRouteName,
      }));

      setRows(editableRows);
      if (!selectedRouteName && result.route_name) setSelectedRouteName(result.route_name);
      setStep(2);
    } catch (err: unknown) {
      setParseError(`파싱 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsParsing(false);
    }
  }

  // ── Step 2 행 편집 ────────────────────────────────────────────────────────────

  function toggleRow(id: number) {
    setRows((prev) => prev.map((r) => r._id === id ? { ...r, selected: !r.selected } : r));
  }
  function toggleAll() {
    const allSelected = rows.every((r) => r.selected);
    setRows((prev) => prev.map((r) => ({ ...r, selected: !allSelected })));
  }
  function updateRow(id: number, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r) => r._id === id ? { ...r, ...patch, needs_review: false } : r));
  }

  // ── Step 2 → Step 3: 저장 ────────────────────────────────────────────────────

  async function handleSave() {
    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) return;

    // 필수값 검사:
    // - km 없음은 section_note(전차선 단전 구간명) 또는 start_station_name(역간구간)이 있으면 허용
    const invalid = selected.filter(
      (r) => !r.route_id || !r.tracks?.length || !r.work_date ||
             !r.start_time || !r.end_time ||
             (r.start_km === null && !r.section_note && !r.start_station_name)
    );
    if (invalid.length > 0) {
      alert(`${invalid.length}건에 필수 값(노선, 선로, 날짜, 시각)이 없습니다. 확인 후 다시 저장하세요.`);
      return;
    }

    setIsSaving(true);
    try {
      // project_name → project_id 자동 연결 (이름이 있는 경우 lookup)
      const projectNameToId = new Map<string, number>();
      const uniqueNames = [...new Set(selected.map(r => r.project_name).filter(Boolean) as string[])];
      await Promise.all(uniqueNames.map(async (name) => {
        const proj = await lookupProjectByName(name);
        if (proj) projectNameToId.set(name, proj.id);
      }));

      const items: BulkBlockOrderItem[] = selected.map((r) => ({
        route_id: r.route_id as number,
        organization_id: defaultOrgId,
        tracks: r.tracks?.length ? r.tracks : ['상선'],
        start_km: r.start_km ?? null,
        end_km: r.end_km ?? null,
        section_note: r.section_note ?? null,
        // tc12: 역간구간 시작·종료역명
        start_station_name: r.start_station_name ?? null,
        end_station_name: r.end_station_name ?? null,
        work_date: r.work_date as string,
        start_time: r.start_time as string,
        end_time: r.end_time as string,
        field: r.field,
        block_type: r.block_type ?? '선로차단',
        work_type: null,
        has_equipment: r.has_equipment ?? false,
        has_labor: r.has_labor ?? true,
        implementer: '철도공사',
        is_external: false,
        // 문서 정보
        doc_no: r.doc_no ?? null,
        // 담당자 (전화번호 포함)
        dept_head: r.dept_head ?? null,
        dept_head_phone: r.dept_head_phone ?? null,
        work_supervisor: r.work_supervisor ?? '',
        work_supervisor_phone: r.work_supervisor_phone ?? null,
        safety_manager: r.safety_manager ?? '',
        safety_manager_phone: r.safety_manager_phone ?? null,
        electric_safety_manager: r.electric_safety_manager ?? null,
        electric_safety_manager_phone: r.electric_safety_manager_phone ?? null,
        contractor: r.contractor ?? null,
        contractor_phone: r.contractor_phone ?? null,   // tc11
        train_watcher: r.train_watcher ?? null,
        train_watcher_phone: r.train_watcher_phone ?? null,
        reason: r.reason ?? null,
        // tc13: 공사/사업 자동 연결
        project_id: r.project_name ? (projectNameToId.get(r.project_name) ?? null) : null,
        // tc11: 관련사업명·승인일자·차단방법·동원장비
        project_name: r.project_name ?? null,
        approved_date: r.approved_date ?? null,
        block_method: r.block_method ?? null,
        equipment_name: r.equipment_name ?? null,
        // 고속선 보호코드
        zep:  r.zep  ?? null,
        zcp:  r.zcp  ?? null,
        cpt:  r.cpt  ?? null,
        tzep: r.tzep ?? null,
      }));

      const result = await bulkCreateBlockOrders(items);
      setSaveResult(result);
      qc.invalidateQueries({ queryKey: ['block-orders'] });
      setStep(3);
      onSaved(result.saved);
    } catch (err: unknown) {
      alert(`저장 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  }

  // ── 유틸 ─────────────────────────────────────────────────────────────────────

  const needsClass = (row: EditableRow, field: keyof EditableRow) => {
    const val = row[field];
    return (val === null || val === '' || val === undefined)
      ? 'border border-red-400 bg-red-50' : '';
  };

  const selectedCount = rows.filter((r) => r.selected).length;

  // 구간 표시: 역간구간(시작역~종료역) 또는 단전구간(section_note)
  function sectionDisplay(row: EditableRow): string {
    if (row.start_station_name && row.end_station_name)
      return `${row.start_station_name}~${row.end_station_name}`;
    if (row.start_station_name) return row.start_station_name;
    if (row.section_note) return row.section_note;
    return '';
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-800">PDF 일괄 등록</h2>
            <div className="flex gap-4 mt-1">
              {([1, 2, 3] as const).map((s) => (
                <span key={s} className={`text-xs ${step === s ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                  {s === 1 ? '① 파일 선택' : s === 2 ? '② 내용 확인' : '③ 저장 결과'}
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-auto">

          {/* ── Step 1: 파일 선택 ── */}
          {step === 1 && (
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                {/* 시행문 */}
                <div className="border-2 border-dashed rounded-lg p-4 text-center">
                  <p className="text-sm font-medium text-gray-700 mb-2">시행문 PDF</p>
                  <p className="text-xs text-gray-400 mb-3">문서번호·작업책임자·관련사업명·승인일자·시공사 정보 포함</p>
                  {coverFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs text-green-600 font-medium">{coverFile.name}</span>
                      <button onClick={() => { setCoverFile(null); if (coverInputRef.current) coverInputRef.current.value = ''; }}
                        className="text-gray-400 hover:text-red-500 text-xs">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => coverInputRef.current?.click()}
                      className="text-sm text-blue-600 hover:text-blue-800 underline">파일 선택</button>
                  )}
                  <input ref={coverInputRef} type="file" accept=".pdf" className="hidden" onChange={handleCoverFile} />
                </div>

                {/* 세부내역 */}
                <div className="border-2 border-dashed rounded-lg p-4 text-center">
                  <p className="text-sm font-medium text-gray-700 mb-2">세부내역 PDF</p>
                  <p className="text-xs text-gray-400 mb-3">차단 일정 표 포함 (핵심 파일)</p>
                  {detailFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs text-green-600 font-medium">{detailFile.name}</span>
                      <button onClick={() => { setDetailFile(null); if (detailInputRef.current) detailInputRef.current.value = ''; }}
                        className="text-gray-400 hover:text-red-500 text-xs">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => detailInputRef.current?.click()}
                      className="text-sm text-blue-600 hover:text-blue-800 underline">파일 선택</button>
                  )}
                  <input ref={detailInputRef} type="file" accept=".pdf" className="hidden" onChange={handleDetailFile} />
                </div>
              </div>

              {(coverFile || detailFile) && !(coverFile && detailFile) && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-xs text-yellow-700">
                  {!coverFile && '시행문 PDF를 추가로 업로드하면 작업책임자·관련사업명·시공사 정보를 자동으로 가져올 수 있습니다.'}
                  {!detailFile && '세부내역 PDF를 추가로 업로드하면 차단 일정을 일괄 등록할 수 있습니다.'}
                </div>
              )}

              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600 whitespace-nowrap">노선 확인</span>
                <div className="relative">
                  <select
                    value={selectedRouteName}
                    onChange={(e) => setSelectedRouteName(e.target.value)}
                    className="h-9 w-48 border rounded-lg pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white appearance-none cursor-pointer"
                  >
                    <option value="">자동 감지</option>
                    {routes.map((r) => (
                      <option key={r.id} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
                </div>
                <span className="text-xs text-gray-400">PDF에서 자동 감지 후 여기서 수정 가능</span>
              </div>

              {parseError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-xs text-red-700">{parseError}</div>
              )}

              <div className="flex justify-between items-center pt-2">
                <button onClick={() => { setStep(2); setRows([]); }}
                  className="text-sm text-gray-500 hover:text-gray-700 underline">
                  파일 없이 직접 입력 →
                </button>
                <button
                  onClick={handleParse}
                  disabled={(!coverFile && !detailFile) || isParsing}
                  className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40"
                >
                  {isParsing ? '분석 중...' : '다음 →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: 파싱 결과 확인 ── */}
          {step === 2 && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  총 <span className="font-semibold text-gray-900">{rows.length}</span>건 파싱 /
                  확인 필요 <span className="font-semibold text-orange-500">{rows.filter((r) => r.needs_review).length}</span>건
                </div>
                <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
                  {rows.every((r) => r.selected) ? '전체 해제' : '전체 선택'}
                </button>
              </div>

              {rows.length === 0 && (
                <div className="text-center text-sm text-gray-400 py-8">
                  파싱된 차단명령이 없습니다. 파일을 확인하거나 직접 입력하세요.
                </div>
              )}

              {rows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="text-xs w-full">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="px-2 py-2 text-center w-8">☑</th>
                        <th className="px-2 py-2 text-left">노선</th>
                        <th className="px-2 py-2 text-left">선로</th>
                        <th className="px-2 py-2 text-left">차단종류</th>
                        <th className="px-2 py-2 text-left">작업일자</th>
                        <th className="px-2 py-2 text-left">시작</th>
                        <th className="px-2 py-2 text-left">종료</th>
                        <th className="px-2 py-2 text-right">시작km</th>
                        <th className="px-2 py-2 text-right">종료km</th>
                        <th className="px-2 py-2 text-left">역간구간/단전구간</th>
                        <th className="px-2 py-2 text-left">분야</th>
                        <th className="px-2 py-2 text-left min-w-36">사유/시행사항</th>
                        <th className="px-2 py-2 text-left min-w-32">관련사업명</th>
                        <th className="px-2 py-2 text-left">승인일자</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((row) => (
                        <tr key={row._id}
                          className={`${row.needs_review ? 'bg-orange-50' : ''} ${row.selected ? '' : 'opacity-40'}`}>

                          {/* 선택 */}
                          <td className="px-2 py-1 text-center">
                            <input type="checkbox" checked={row.selected} onChange={() => toggleRow(row._id)} />
                          </td>

                          {/* 노선 */}
                          <td className={`px-1 py-1 ${needsClass(row, 'route_id')}`}>
                            <div className="relative">
                              <select
                                value={row.route_id}
                                onChange={(e) => updateRow(row._id, {
                                  route_id: e.target.value === '' ? '' : Number(e.target.value),
                                })}
                                className="w-24 h-7 border-0 bg-transparent text-xs focus:outline-none appearance-none cursor-pointer pr-4"
                              >
                                <option value="">선택</option>
                                {routes.map((r) => (
                                  <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                              </select>
                              <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
                            </div>
                          </td>

                          {/* 선로 (T번호 포함) */}
                          <td className={`px-1 py-1 ${needsClass(row, 'tracks')}`}>
                            <div className="relative">
                              <select
                                value={row.tracks?.[0] ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  updateRow(row._id, { tracks: isTrackName(v) ? [v] : null });
                                }}
                                className="w-20 h-7 border-0 bg-transparent text-xs focus:outline-none appearance-none cursor-pointer pr-4"
                              >
                                <option value="">-</option>
                                {TRACK_OPTIONS.map((track) => (
                                  <option key={track} value={track}>{track}</option>
                                ))}
                              </select>
                              <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
                            </div>
                          </td>

                          {/* 차단종류 */}
                          <td className={`px-1 py-1 ${needsClass(row, 'block_type')}`}>
                            <div className="relative">
                              <select
                                value={row.block_type ?? ''}
                                onChange={(e) => updateRow(row._id, { block_type: e.target.value || null })}
                                className="w-28 h-7 border-0 bg-transparent text-xs focus:outline-none appearance-none cursor-pointer pr-4"
                              >
                                <option value="">-</option>
                                <option value="선로차단">선로차단</option>
                                <option value="선로일시사용중지">선로일시사용중지</option>
                                <option value="전차선단전">전차선단전</option>
                                <option value="작업구간설정">작업구간설정</option>
                                <option value="보호지구작업">보호지구작업</option>
                                <option value="임시완속">임시완속</option>
                                <option value="속도제한">속도제한</option>
                              </select>
                              <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
                            </div>
                          </td>

                          {/* 날짜 */}
                          <td className={`px-1 py-1 ${needsClass(row, 'work_date')}`}>
                            <input
                              type="date"
                              value={row.work_date ?? ''}
                              onChange={(e) => updateRow(row._id, { work_date: e.target.value })}
                              className="w-32 h-7 border-0 bg-transparent text-xs focus:outline-none"
                            />
                          </td>

                          {/* 시작 시각 */}
                          <td className={`px-1 py-1 ${needsClass(row, 'start_time')}`}>
                            <input
                              type="time"
                              value={row.start_time ?? ''}
                              onChange={(e) => updateRow(row._id, { start_time: e.target.value })}
                              className="w-20 h-7 border-0 bg-transparent text-xs focus:outline-none"
                            />
                          </td>

                          {/* 종료 시각 */}
                          <td className={`px-1 py-1 ${needsClass(row, 'end_time')}`}>
                            <input
                              type="time"
                              value={row.end_time ?? ''}
                              onChange={(e) => updateRow(row._id, { end_time: e.target.value })}
                              className="w-20 h-7 border-0 bg-transparent text-xs focus:outline-none"
                            />
                          </td>

                          {/* 시작 km */}
                          <td className="px-1 py-1 text-right">
                            <input
                              type="number"
                              step="0.001"
                              value={row.start_km ?? ''}
                              onChange={(e) => updateRow(row._id, {
                                start_km: e.target.value === '' ? null : Number(e.target.value),
                              })}
                              className="w-16 h-7 border-0 bg-transparent text-xs text-right focus:outline-none"
                            />
                          </td>

                          {/* 종료 km */}
                          <td className="px-1 py-1 text-right">
                            <input
                              type="number"
                              step="0.001"
                              value={row.end_km ?? ''}
                              onChange={(e) => updateRow(row._id, {
                                end_km: e.target.value === '' ? null : Number(e.target.value),
                              })}
                              className="w-16 h-7 border-0 bg-transparent text-xs text-right focus:outline-none"
                            />
                          </td>

                          {/* 역간구간 / 단전구간 */}
                          <td className="px-1 py-1 whitespace-nowrap">
                            {sectionDisplay(row) ? (
                              <span className={`text-xs ${row.section_note ? 'text-blue-600' : 'text-gray-700'}`}>
                                {sectionDisplay(row)}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300">-</span>
                            )}
                          </td>

                          {/* 분야 */}
                          <td className="px-1 py-1">
                            <div className="relative">
                              <select
                                value={row.field}
                                onChange={(e) => updateRow(row._id, {
                                  field: e.target.value,
                                  field_confidence: 'high' as const,
                                })}
                                className={`w-16 h-7 border-0 bg-transparent text-xs focus:outline-none appearance-none cursor-pointer pr-4
                                  ${row.field_confidence === 'low' ? 'text-orange-500 font-medium' : 'text-gray-700'}`}
                              >
                                {FIELDS.map((f) => (
                                  <option key={f} value={f}>{f}</option>
                                ))}
                              </select>
                              <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▾</span>
                            </div>
                          </td>

                          {/* 사유/시행사항 */}
                          <td className="px-1 py-1 text-gray-500 truncate max-w-36" title={row.reason ?? ''}>
                            {row.reason}
                          </td>

                          {/* 관련사업명 */}
                          <td className="px-1 py-1 text-gray-500 truncate max-w-32" title={row.project_name ?? ''}>
                            {row.project_name
                              ? <span className="text-gray-700">{row.project_name}</span>
                              : <span className="text-gray-300">-</span>}
                          </td>

                          {/* 승인일자 */}
                          <td className="px-1 py-1 text-gray-500 whitespace-nowrap">
                            {row.approved_date ?? <span className="text-gray-300">-</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 파싱 결과 메타 정보 (시행문에서 추출한 공통 정보) */}
              {rows.length > 0 && (() => {
                const r0 = rows[0];
                const hasMeta = r0.work_supervisor || r0.safety_manager || r0.contractor || r0.doc_no;
                if (!hasMeta) return null;
                return (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1">
                    <p className="font-medium text-gray-700 mb-1">시행문에서 추출된 공통 정보 (전체 행에 적용)</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                      {r0.doc_no && <span>문서번호: <b>{r0.doc_no}</b></span>}
                      {r0.dept_head && <span>시행부서장: {r0.dept_head}{r0.dept_head_phone ? ` (${r0.dept_head_phone})` : ''}</span>}
                      {r0.work_supervisor && <span>작업책임자: {r0.work_supervisor}{r0.work_supervisor_phone ? ` (${r0.work_supervisor_phone})` : ''}</span>}
                      {r0.safety_manager && <span>철도운행안전관리자: {r0.safety_manager}{r0.safety_manager_phone ? ` (${r0.safety_manager_phone})` : ''}</span>}
                      {r0.electric_safety_manager && <span>전기철도안전관리자: {r0.electric_safety_manager}</span>}
                      {r0.contractor && <span>시공사: {r0.contractor}{r0.contractor_phone ? ` (${r0.contractor_phone})` : ''}</span>}
                      {r0.train_watcher && <span>열차감시원: {r0.train_watcher}{r0.train_watcher_phone ? ` (${r0.train_watcher_phone})` : ''}</span>}
                      {r0.equipment_name && <span>동원장비: {r0.equipment_name}</span>}
                      {r0.block_method && <span>차단방법: <b className="text-blue-700">{r0.block_method}</b></span>}
                      {(r0.zep || r0.zcp || r0.cpt || r0.tzep) && (
                        <span>보호조치: {[r0.zep && `ZEP:${r0.zep}`, r0.zcp && `ZCP:${r0.zcp}`, r0.cpt && `CPT:${r0.cpt}`, r0.tzep && `TZEP:${r0.tzep}`].filter(Boolean).join(' / ')}</span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {rows.filter((r) => r.needs_review).length > 0 && (
                <div className="text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded-lg">
                  ⚠ 주황색 행은 선로·km 등 확인이 필요합니다. 수정 후 저장하거나 체크 해제하세요.
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: 저장 결과 ── */}
          {step === 3 && saveResult && (
            <div className="p-6 space-y-4">
              <div className={`rounded-lg px-4 py-3 ${saveResult.failed === 0 ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                <p className="text-sm font-medium">
                  저장 완료: <span className="text-green-700">{saveResult.saved}건</span>
                  {saveResult.failed > 0 && <> / 실패: <span className="text-red-600">{saveResult.failed}건</span></>}
                </p>
              </div>
              {saveResult.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <p className="text-xs font-medium text-red-700 mb-1">실패 내역</p>
                  <ul className="text-xs text-red-600 space-y-0.5">
                    {saveResult.errors.map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="flex justify-between items-center px-6 py-4 border-t shrink-0">
          {step === 1 && (
            <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">취소</button>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-gray-700">← 이전</button>
              <button
                onClick={handleSave}
                disabled={selectedCount === 0 || isSaving}
                className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                {isSaving ? '저장 중...' : `선택 항목 저장 (${selectedCount}건)`}
              </button>
            </>
          )}
          {step === 3 && (
            <button onClick={onClose} className="ml-auto px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
