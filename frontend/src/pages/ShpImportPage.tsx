/**
 * ShpImportPage — 국가기본도_철도중심선 SHP → route_geometry DB 저장
 *
 * 기능:
 *  1. SHP 파일 내 노선 목록 조회
 *  2. 체크박스로 import할 노선 선택
 *  3. import 실행 → 결과 표시
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchShpRoutes, importShpRoutes } from '../api/admin';
import type { ShpRouteInfo, ShpImportResult } from '../api/admin';

const CLASS_COLORS: Record<string, string> = {
  '고속철도': 'bg-red-100 text-red-700',
  '보통철도': 'bg-blue-100 text-blue-700',
  '도시철도': 'bg-green-100 text-green-700',
};

export default function ShpImportPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importResults, setImportResults] = useState<ShpImportResult[] | null>(null);
  const [importSummary, setImportSummary] = useState<{ total: number; success: number } | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['shp-routes'],
    queryFn: fetchShpRoutes,
    staleTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: (codes: string[]) => importShpRoutes(codes),
    onSuccess: (res) => {
      setImportResults(res.results);
      setImportSummary({ total: res.total, success: res.success });
      setSelected(new Set());
    },
  });

  const routes: ShpRouteInfo[] = data?.routes ?? [];

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(routes.map((r) => r.route_code)));
    } else {
      setSelected(new Set());
    }
  }

  function toggleOne(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function handleImport() {
    if (selected.size === 0) return;
    setImportResults(null);
    setImportSummary(null);
    mutation.mutate(Array.from(selected));
  }

  const allChecked = routes.length > 0 && selected.size === routes.length;
  const indeterminate = selected.size > 0 && selected.size < routes.length;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold mb-1">SHP 노선 Import</h1>
      <p className="text-sm text-gray-500 mb-4">
        국가기본도_철도중심선(TN_RLROAD_CTLN)에서 노선 geometry를 읽어 DB에 저장합니다.
        기존 route_geometry 데이터는 선택한 노선만 교체됩니다.
      </p>

      {/* SHP 파일 미존재 */}
      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-4 text-sm">
          {(error as any)?.response?.data?.detail ?? 'SHP 파일을 로드할 수 없습니다.'}
          <p className="mt-1 text-red-500 text-xs">
            maps/raw/railway_line/TN_RLROAD_CTLN.shp 파일이 서버에 있는지 확인하세요.
          </p>
        </div>
      )}

      {isLoading && (
        <div className="text-gray-400 text-sm">SHP 파일 파싱 중...</div>
      )}

      {data && !data.shp_available && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 rounded p-4 text-sm">
          SHP 파일이 서버에 없습니다. maps/raw/railway_line/TN_RLROAD_CTLN.shp 를 확인하세요.
        </div>
      )}

      {data?.shp_available && routes.length > 0 && (
        <>
          {/* 툴바 */}
          <div className="flex items-center gap-3 mb-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = indeterminate; }}
                onChange={(e) => toggleAll(e.target.checked)}
                className="w-4 h-4"
              />
              전체 선택 ({selected.size}/{routes.length})
            </label>
            <button
              onClick={handleImport}
              disabled={selected.size === 0 || mutation.isPending}
              className="ml-auto px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? `import 중... (${selected.size}개)` : `선택 노선 import (${selected.size}개)`}
            </button>
          </div>

          {/* 노선 목록 테이블 */}
          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left">노선 코드</th>
                  <th className="px-3 py-2 text-left">노선명 (SHP)</th>
                  <th className="px-3 py-2 text-left">구분</th>
                  <th className="px-3 py-2 text-right">레코드 수</th>
                  <th className="px-3 py-2 text-center">DB 등록</th>
                  <th className="px-3 py-2 text-center">Geometry</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {routes.map((r) => (
                  <tr
                    key={r.route_code}
                    className={`hover:bg-gray-50 cursor-pointer ${selected.has(r.route_code) ? 'bg-blue-50' : ''}`}
                    onClick={() => toggleOne(r.route_code)}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(r.route_code)}
                        onChange={() => toggleOne(r.route_code)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{r.route_code}</td>
                    <td className="px-3 py-2 font-medium">{r.name_kr}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CLASS_COLORS[r.shp_class] ?? 'bg-gray-100 text-gray-600'}`}>
                        {r.shp_class}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">{r.record_count.toLocaleString()}</td>
                    <td className="px-3 py-2 text-center">{r.in_db ? '✅' : '❌'}</td>
                    <td className="px-3 py-2 text-center">{r.has_geometry ? '✅' : '⬜'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400 mt-2">
            * DB 등록: routes 테이블 존재 여부 / Geometry: route_geometry 저장 여부
          </p>
        </>
      )}

      {/* import 진행 중 */}
      {mutation.isPending && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
          SHP 데이터를 읽어 DB에 저장하는 중입니다. 잠시 기다려 주세요...
        </div>
      )}

      {/* import 오류 */}
      {mutation.isError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          import 오류: {(mutation.error as any)?.response?.data?.detail ?? '알 수 없는 오류'}
        </div>
      )}

      {/* import 결과 */}
      {importResults && importSummary && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-sm">
              import 완료 — {importSummary.success}/{importSummary.total}개 노선 성공
            </span>
          </div>
          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">노선 코드</th>
                  <th className="px-3 py-2 text-left">결과</th>
                  <th className="px-3 py-2 text-right">Segment 수</th>
                  <th className="px-3 py-2 text-right">총 좌표 수 (high LOD)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {importResults.map((r) => (
                  <tr key={r.route_code} className={r.status === '완료' ? '' : 'bg-red-50'}>
                    <td className="px-3 py-2 font-mono text-xs">{r.route_code}</td>
                    <td className="px-3 py-2">
                      <span className={r.status === '완료' ? 'text-green-600 font-medium' : 'text-red-600'}>
                        {r.status === '완료' ? '✅ 완료' : `❌ ${r.status}`}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{r.status === '완료' ? r.segments : '-'}</td>
                    <td className="px-3 py-2 text-right">{r.status === '완료' ? r.total_pts.toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
