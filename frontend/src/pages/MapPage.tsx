import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { fetchOrganizations } from '../api/organizations';
import { fetchRoutes } from '../api/routes';
import RailwayMap from '../components/map/RailwayMap';
import type { Route } from '../types';

// 고속철도 route_code 목록 (ROUTE_MANAGEMENT.md 기준)
const HIGH_SPEED_CODES = new Set([
  'gyeongbu_high', 'honam_high', 'gangneung', 'donghae_ktx', 'jungbu_naeryuk', 'suseo_pyeongtaek',
]);
// KORAIL 운영 지하철
const SUBWAY_CODES = new Set(['suin', 'bundang']);

function classifyRoute(code: string): '고속철도' | '지하철' | '보통철도' {
  if (HIGH_SPEED_CODES.has(code)) return '고속철도';
  if (SUBWAY_CODES.has(code)) return '지하철';
  return '보통철도';
}

export default function MapPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperuser = user?.role === 'system_superuser';

  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(
    user?.organization_id ?? null,
  );
  const [showOrgBoundary, setShowOrgBoundary] = useState(
    user?.role === 'org_admin' || user?.role === 'user',
  );
  const [hiddenRoutes, setHiddenRoutes] = useState<Set<string>>(new Set());
  const [showFacilities, setShowFacilities] = useState(false);

  // superuser용 조직 목록
  const { data: orgs = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: fetchOrganizations,
    enabled: isSuperuser,
    staleTime: Infinity,
  });

  // 전체 노선 목록 (레이어 토글용)
  const { data: routes = [] } = useQuery({
    queryKey: ['routes'],
    queryFn: fetchRoutes,
    staleTime: Infinity,
  });

  const mapOrgId = isSuperuser ? selectedOrgId : (user?.organization_id ?? null);

  function toggleRoute(code: string) {
    setHiddenRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleGroup(codes: string[], hide: boolean) {
    setHiddenRoutes((prev) => {
      const next = new Set(prev);
      for (const code of codes) {
        if (hide) next.add(code);
        else next.delete(code);
      }
      return next;
    });
  }

  // 그룹별 분류
  const grouped: Record<'고속철도' | '보통철도' | '지하철', Route[]> = {
    '고속철도': [],
    '보통철도': [],
    '지하철': [],
  };
  for (const r of routes) {
    grouped[classifyRoute(r.code)].push(r);
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── 사이드바 ──────────────────────────────────────────────────── */}
      <aside className="w-52 bg-white border-r flex flex-col shrink-0 overflow-hidden">

        {/* superuser: 조직 선택 */}
        {isSuperuser && (
          <div className="p-3 border-b shrink-0">
            <label className="block text-xs text-gray-500 mb-1">조직 선택</label>
            <select
              value={selectedOrgId ?? ''}
              onChange={(e) =>
                setSelectedOrgId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full border rounded px-2 py-1 text-xs"
            >
              <option value="">전국 조망</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* 시설물 표시 */}
        <div className="p-3 border-b shrink-0">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showFacilities}
              onChange={(e) => setShowFacilities(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <span className="text-gray-600">시설물 표시</span>
          </label>
          {showFacilities && (
            <p className="text-xs text-blue-400 mt-1 ml-5">표시 중인 노선 · 확대 시 단계 표시</p>
          )}
        </div>

        {/* 관할 구간 표시 */}
        {mapOrgId != null && (
          <div className="p-3 border-b shrink-0">
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showOrgBoundary}
                onChange={(e) => setShowOrgBoundary(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              <span className="text-gray-600">관할 구간 표시</span>
            </label>
            {showOrgBoundary && (
              <p className="text-xs text-blue-500 mt-1 ml-5">
                {isSuperuser
                  ? orgs.find((o) => o.id === selectedOrgId)?.name ?? ''
                  : user?.organization_name ?? ''}
              </p>
            )}
          </div>
        )}

        {/* 노선 레이어 토글 */}
        <div className="flex flex-col flex-1 overflow-hidden border-b">
          <div className="px-3 py-2 shrink-0 text-xs font-medium text-gray-500">노선 표시</div>
          <div className="overflow-y-auto flex-1 px-2 pb-2 space-y-3">
            {(['고속철도', '보통철도', '지하철'] as const).map((group) => {
              const groupRoutes = grouped[group];
              if (groupRoutes.length === 0) return null;
              const codes = groupRoutes.map((r) => r.code);
              const allHidden = codes.every((c) => hiddenRoutes.has(c));
              const someHidden = codes.some((c) => hiddenRoutes.has(c));
              return (
                <div key={group}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600">{group}</span>
                    <button
                      onClick={() => toggleGroup(codes, !allHidden)}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >
                      {allHidden ? '전체 표시' : someHidden ? '전체 표시' : '전체 숨김'}
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {groupRoutes.map((r) => (
                      <label
                        key={r.code}
                        className="flex items-center gap-1.5 text-xs cursor-pointer select-none py-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={!hiddenRoutes.has(r.code)}
                          onChange={() => toggleRoute(r.code)}
                          className="w-3 h-3 shrink-0"
                        />
                        <span className={hiddenRoutes.has(r.code) ? 'text-gray-400' : 'text-gray-700'}>
                          {r.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 안내 */}
        {mapOrgId == null && routes.length === 0 && (
          <div className="p-3">
            <p className="text-xs text-gray-400 leading-relaxed">
              조직을 선택하면 관할 구간이 강조 표시됩니다.
            </p>
          </div>
        )}

      </aside>

      {/* ── 지도 영역 ──────────────────────────────────────────────────── */}
      <main className="flex-1 relative overflow-hidden">
        <RailwayMap
          orgId={mapOrgId}
          showOrgBoundary={showOrgBoundary && mapOrgId != null}
          hiddenRoutes={hiddenRoutes}
          showFacilities={showFacilities}
        />
      </main>
    </div>
  );
}
