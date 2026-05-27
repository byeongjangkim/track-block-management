import { useEffect, useRef, useMemo, useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import * as d3 from 'd3';
import {
  fetchAllGeometry,
  fetchOrgBoundaries,
  fetchOrgViewport,
  fetchRouteFacilities,
  fetchSigungu,
  type RouteFeatureCollection,
  type OrgBoundaryCollection,
  type OrgViewport,
  type FacilityFeature,
  type BlockSegmentCollection,
  type BlockSegmentFeature,
  type SigungCollection,
  type SigungFeature,
} from '../../api/map';
import { fetchRoutes } from '../../api/routes';

interface Props {
  orgId: number | null;
  showOrgBoundary: boolean;
  hiddenRoutes: Set<string>;
  /** 시설물 표시 ON/OFF — true이면 hiddenRoutes에 없는 전 노선 시설물 표시 (lat/lon 기반) */
  showFacilities?: boolean;
  /** 차단명령 구간 오버레이 데이터 (차단현황도에서 전달) */
  blockSegments?: BlockSegmentCollection | null;
  /** 선택된 차단명령 ID (강조 표시) */
  selectedBlockId?: number | null;
}

// ── 색상 정의 ──────────────────────────────────────────────────────────────

function routeStroke(code: string, source: string): string {
  const isHigh = code.endsWith('_high');
  if (source === 'user') return isHigh ? '#dc2626' : '#374151';
  return isHigh ? '#fca5a5' : '#9ca3af';
}

const FIELD_COLORS: Record<string, string> = {
  all: '#2563eb',
  시설: '#7c3aed',
  전기: '#d97706',
  건축: '#dc2626',
};

// 시설물 색상 — 대분류(type) + 소분류(station_type) 기반
function facilityColor(type: string, stationType: string | null): string {
  if (type === '역') {
    switch (stationType) {
      case '관리역': return '#1d4ed8';
      case '보통역': return '#3b82f6';
      case '무인역': return '#60a5fa';
      case '신호장': return '#818cf8';
      case '신호소': return '#a78bfa';
      default:       return '#3b82f6';
    }
  }
  if (type === '변전소') return '#7c3aed';
  if (type === '구조물') {
    switch (stationType) {
      case '터널':   return '#6b7280';
      case '교량':   return '#0891b2';
      case '과선교': return '#dc2626';
      case '건널목': return '#f59e0b';
      case '분기':   return '#059669';
      default:       return '#6b7280';
    }
  }
  return '#9ca3af';
}

// 범례용 색상 (고정)
const LEGEND_COLORS = {
  관리역: '#1d4ed8',
  보통역: '#3b82f6',
  신호장: '#818cf8',
  터널:   '#6b7280',
  교량:   '#0891b2',
  건널목: '#f59e0b',
  변전소: '#7c3aed',
  분기:   '#059669',
};

// 차단방향별 색상
const BLOCK_DIR_COLORS: Record<string, string> = {
  UP:   '#ef4444',  // 빨간색 (상선 — 좌측)
  DOWN: '#f97316',  // 주황색 (하선 — 우측)
};

// 차단구간 오프셋 (SVG 좌표 단위, 줌과 함께 스케일)
// UP(상선) = 좌측 (+방향), DOWN(하선) = 우측 (-방향)
const BLOCK_OFFSET_SVG = 4;

/**
 * GeoJSON 좌표 배열을 투영 후 방향별 수직 오프셋을 적용한 SVG path d 문자열 반환.
 * UP: 선로 진행 방향(km 증가)의 좌측, DOWN: 우측.
 */
function buildOffsetPath(
  coords: [number, number][],
  direction: 'UP' | 'DOWN',
  projection: d3.GeoProjection,
): string {
  const pts = coords
    .map(([lon, lat]) => projection([lon, lat]))
    .filter((p): p is [number, number] => p !== null);

  if (pts.length < 2) return '';

  // UP=좌측 → normal 방향 부호 +1, DOWN=우측 → -1
  const sign = direction === 'UP' ? 1 : -1;

  const offsetPts: [number, number][] = pts.map((p, i) => {
    let dx: number, dy: number;
    if (i === 0) {
      dx = pts[1][0] - pts[0][0];
      dy = pts[1][1] - pts[0][1];
    } else if (i === pts.length - 1) {
      dx = pts[i][0] - pts[i - 1][0];
      dy = pts[i][1] - pts[i - 1][1];
    } else {
      dx = pts[i + 1][0] - pts[i - 1][0];
      dy = pts[i + 1][1] - pts[i - 1][1];
    }
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return p;
    // 스크린 좌표계(y-down)에서 좌측 법선 벡터: (-dy, dx)
    const nx = -dy / len;
    const ny =  dx / len;
    return [p[0] + sign * BLOCK_OFFSET_SVG * nx, p[1] + sign * BLOCK_OFFSET_SVG * ny];
  });

  return d3.line()(offsetPts) ?? '';
}

// 시설물 팝업 상태
interface FacilityPopup {
  x: number;        // SVG 컨테이너 기준 픽셀 좌표
  y: number;
  name: string;
  type: string;
  info: string;     // "노선A  km X\n노선B  km Y" 형태
}

// ── 시도별 연한 채움색 (인접 시도 간 자연스러운 구분) ────────────────────────
// 4색 정리(four-color theorem) 기반 배정, 불투명도 0.15
const SIDO_FILLS: Record<string, string> = {
  '11': 'rgba(248,113,113,0.15)',  // 서울 — 연장밋빛
  '26': 'rgba(96,165,250,0.15)',   // 부산 — 연파랑
  '27': 'rgba(167,139,250,0.15)', // 대구 — 연보라
  '28': 'rgba(52,211,153,0.15)',  // 인천 — 연에메랄드
  '29': 'rgba(251,191,36,0.15)',  // 광주 — 연노랑
  '30': 'rgba(251,191,36,0.15)',  // 대전 — 연노랑
  '31': 'rgba(167,139,250,0.15)', // 울산 — 연보라
  '36': 'rgba(248,113,113,0.15)', // 세종 — 연장밋빛
  '41': 'rgba(251,191,36,0.15)',  // 경기 — 연노랑
  '43': 'rgba(96,165,250,0.15)',  // 충북 — 연파랑
  '44': 'rgba(52,211,153,0.15)',  // 충남 — 연에메랄드
  '46': 'rgba(96,165,250,0.15)',  // 전남 — 연파랑
  '47': 'rgba(52,211,153,0.15)',  // 경북 — 연에메랄드
  '48': 'rgba(248,113,113,0.15)', // 경남 — 연장밋빛
  '50': 'rgba(96,165,250,0.15)',  // 제주 — 연파랑
  '51': 'rgba(248,113,113,0.15)', // 강원 — 연장밋빛
  '52': 'rgba(167,139,250,0.15)', // 전북 — 연보라
};

// ── 시군구 배경 공통 렌더 함수 ──────────────────────────────────────────────
function _renderSigungu(
  bgLayer:    d3.Selection<SVGGElement, unknown, null, undefined>,
  labelLayer: d3.Selection<SVGGElement, unknown, null, undefined>,
  features:   SigungFeature[],
  pathGen:    d3.GeoPath,
  proj:       d3.GeoProjection,
) {
  bgLayer
    .selectAll<SVGPathElement, SigungFeature>('path.sigungu')
    .data(features)
    .join('path')
    .attr('class', 'sigungu')
    .attr('d', (d) => pathGen(d as any) ?? '')
    .attr('fill', (d) =>
      d.properties.admin_level === 1
        ? (SIDO_FILLS[d.properties.sig_cd] ?? 'rgba(200,210,220,0.15)')
        : 'none'
    )
    .attr('stroke', (d) => d.properties.admin_level === 1 ? '#6b8299' : '#8fa5b8')
    .attr('stroke-width', (d) => d.properties.admin_level === 1 ? 1.0 : 0.5)
    .attr('vector-effect', 'non-scaling-stroke');

  labelLayer
    .selectAll<SVGTextElement, SigungFeature>('text.sigungu-label')
    .data(features)
    .join('text')
    .attr('class', 'sigungu-label')
    .attr('x', (d) => { const pt = proj(d.properties.centroid); return pt ? pt[0] : 0; })
    .attr('y', (d) => { const pt = proj(d.properties.centroid); return pt ? pt[1] : 0; })
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .style('font-size', '9px')
    .style('fill', (d) => d.properties.admin_level === 1 ? '#334155' : '#64748b')
    .style('font-weight', (d) => d.properties.admin_level === 1 ? '600' : '400')
    .style('pointer-events', 'none')
    .style('user-select', 'none')
    .text((d) => d.properties.name);
}

// 줌 스케일 기준 (초기 줌 ~0.95)
const ZOOM_STATION       = 0.8;  // 관리역: 초기 화면부터 표시
const ZOOM_STATION2      = 3;    // 보통역·무인역·신호장·신호소: 중간 확대 후 표시
const ZOOM_SEGMENT       = 3;    // 구조물(터널·교량·과선교): 약간 확대 후 표시
const ZOOM_DETAIL        = 8;    // 변전소·건널목·분기: 크게 확대 후 표시
const ZOOM_SIGUNGU_LABEL  = 2;    // 시군구 레이블 표시 시작 배율
const ZOOM_SIGUNGU_LEVEL2 = 1.5; // 시군 경계 표시 시작 배율
const ZOOM_SIGUNGU_LEVEL3 = 4.0; // 구 경계 표시 시작 배율


export default function RailwayMap({
  orgId,
  showOrgBoundary,
  hiddenRoutes,
  showFacilities = false,
  blockSegments = null,
  selectedBlockId = null,
}: Props) {
  const svgRef            = useRef<SVGSVGElement>(null);
  const gRef              = useRef<SVGGElement>(null);
  const zoomRef           = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const projRef           = useRef<d3.GeoProjection | null>(null);
  const scaleRef          = useRef<number>(1);
  const zoomDisplayRef    = useRef<HTMLSpanElement>(null);           // 줌 배율 표시 DOM 직접 제어
  const sigunguDataRef    = useRef<SigungCollection | null>(null);  // 최신 sigungu 데이터 (D3 init에서 참조)
  const [facilityPopup, setFacilityPopup] = useState<FacilityPopup | null>(null);
  const setPopupRef = useRef(setFacilityPopup);

  // ── 데이터 조회 ─────────────────────────────────────────────────────────
  const { data: allGeo } = useQuery<RouteFeatureCollection>({
    queryKey: ['map-all-geometry'],
    queryFn: () => fetchAllGeometry(),
    staleTime: 0,
  });

  const { data: orgBoundary } = useQuery<OrgBoundaryCollection>({
    queryKey: ['map-org-boundary', orgId],
    queryFn: () => fetchOrgBoundaries(orgId!),
    enabled: showOrgBoundary && orgId != null,
    staleTime: 0,
  });

  const { data: orgViewport } = useQuery<OrgViewport>({
    queryKey: ['map-org-viewport', orgId],
    queryFn: () => fetchOrgViewport(orgId!),
    enabled: orgId != null,
    staleTime: Infinity,
  });

  // 전 노선 목록 (시설물 조회 대상 결정용)
  const { data: allRoutes = [] } = useQuery({
    queryKey: ['routes'],
    queryFn: fetchRoutes,
    staleTime: Infinity,
  });

  // 시군구 배경 지도 (level=2: 시도+시군구)
  const { data: sigunguData } = useQuery<SigungCollection>({
    queryKey: ['map-sigungu', 2],
    queryFn: () => fetchSigungu(2),
    staleTime: Infinity,
  });
  // 렌더 마다 ref를 최신값으로 갱신 — D3 init(stale closure) 내에서 안전하게 참조
  sigunguDataRef.current = sigunguData ?? null;

  // showFacilities=true 이고 hiddenRoutes에 없는 노선 전체 대상
  const targetRouteCodes = useMemo(() => {
    if (!showFacilities) return [] as string[];
    return allRoutes.map((r) => r.code).filter((code) => !hiddenRoutes.has(code));
  }, [showFacilities, allRoutes, hiddenRoutes]);

  // 대상 노선마다 병렬 조회
  const facilityQueries = useQueries({
    queries: targetRouteCodes.map((code) => ({
      queryKey: ['map-facilities', code],
      queryFn: () => fetchRouteFacilities(code),
      staleTime: 60_000,
    })),
  });

  // 모든 노선 시설물을 하나의 배열로 병합 + GPS 중복 마커 병합
  // 같은 (lon, lat) 좌표의 Point 시설물은 하나의 마커로 합치고
  // _lines 필드에 [{route_name, km}] 배열로 다중 노선 정보를 보존한다.
  const mergedFacilityFeatures = useMemo(() => {
    const all = facilityQueries.flatMap((q) => q.data?.features ?? []);

    const points = all.filter((f) => f.geometry.type === 'Point');
    const segs   = all.filter((f) => f.geometry.type !== 'Point');

    // (lon, lat) 소수점 5자리 키로 그룹화 (약 1m 오차 허용)
    type Pt = typeof points[0];
    const groups = new Map<string, Pt[]>();
    for (const f of points) {
      const [lon, lat] = (f.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates;
      const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(f);
    }

    const deduped: (Pt & { _lines: { route_name: string; km: number }[] })[] = [];
    for (const group of groups.values()) {
      // 대표 마커: 관리역 우선, 없으면 역, 없으면 첫 번째
      const rep = group.find((f) => f.properties.type === '역' && f.properties.station_type === '관리역')
        ?? group.find((f) => f.properties.type === '역')
        ?? group[0];
      const _lines = group.map((f) => ({
        route_name: f.properties.route_name,
        km: f.properties.km,
      }));
      deduped.push({ ...rep, _lines });
    }

    return [...segs, ...deduped];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilityQueries.map((q) => q.dataUpdatedAt).join(',')]);

  // ── D3 초기화 ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || !allGeo || allGeo.features.length === 0) return;

    const svg = d3.select(svgRef.current);
    const container = svgRef.current.parentElement!;
    const W = container.clientWidth  || 900;
    const H = container.clientHeight || 700;

    svg.attr('width', W).attr('height', H);

    if (!projRef.current) {
      // 목표: 최소 줌(k=0.5)에서 한국이 뷰포트의 90%를 차지
      // scale × Mercator_height(0.1036 rad) × 0.5 = H × 0.90  → scale = H × 17.4
      // scale × lon_range(0.1134 rad) × 0.5 = W × 0.90         → scale = W × 15.9
      const scale = Math.min(W * 15.9, H * 17.4);
      projRef.current = d3.geoMercator()
        .center([127.7, 36.3])
        .scale(scale)
        .translate([W / 2, H / 2]);
    }
    const projection = projRef.current;
    const pathGen = d3.geoPath().projection(projection);

    const g = d3.select(gRef.current!);

    // 전체 레이어 구성
    g.selectAll('*').remove();
    g.append('g').attr('class', 'sigungu-background');
    g.append('g').attr('class', 'sigungu-labels');
    g.append('g').attr('class', 'routes');
    g.append('g').attr('class', 'org-boundaries');
    g.append('g').attr('class', 'block-segments');
    g.append('g').attr('class', 'facility-segments');
    g.append('g').attr('class', 'facility-points');

    // 시군구 배경 렌더링 (init 시점에 이미 로드된 경우)
    const sgInit = sigunguDataRef.current;
    if (sgInit) {
      _renderSigungu(
        g.select<SVGGElement>('.sigungu-background'),
        g.select<SVGGElement>('.sigungu-labels'),
        sgInit.features,
        pathGen,
        projection,
      );
    }

    // 노선 경로 렌더링
    g.select<SVGGElement>('.routes')
      .selectAll<SVGPathElement, (typeof allGeo.features)[0]>('path.route')
      .data(
        allGeo.features,
        (d) => `${d.properties.route_code}-${d.properties.source}-${d.properties.segment}`,
      )
      .join('path')
      .attr('class', (d) => `route route-${d.properties.route_code}`)
      .attr('d', (d) => pathGen(d as any) ?? '')
      .attr('fill', 'none')
      .attr('stroke', (d) => routeStroke(d.properties.route_code, d.properties.source))
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', (d) => d.properties.source === 'shp' ? '4 3' : null)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('opacity', (d) => d.properties.source === 'shp' ? 0.5 : 1)
      .attr('display', (d) => hiddenRoutes.has(d.properties.route_code) ? 'none' : null);

    // 줌 설정
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 30])
      .on('zoom', ({ transform }) => {
        g.attr('transform', transform.toString());
        scaleRef.current = transform.k;
        _updateFacilityVisibility(transform.k);

        if (zoomDisplayRef.current) {
          zoomDisplayRef.current.textContent = `×${transform.k.toFixed(1)}`;
        }
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    // SVG 배경 클릭 시 팝업 닫힘
    svg.on('click', () => setPopupRef.current(null));

    // k=0.5에서 한국 중심([W/2,H/2])을 화면 중심에 배치
    // screen = SVG * k + tx → W/2 = W/2 * 0.5 + W/4  ✓
    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(W / 4, H / 4).scale(0.5),
    );

  }, [allGeo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 줌에 따른 시설물 가시성 + 고정 크기 보정 ───────────────────────────
  // scale(1/k): 부모 <g>의 줌 배율을 상쇄 → 마커·텍스트가 화면에서 항상 동일 크기
  function _updateFacilityVisibility(k: number) {
    if (!gRef.current || !projRef.current) return;
    const g    = d3.select(gRef.current);
    const proj = projRef.current;

    // 시군구 경계: admin_level별 단계적 표시
    // level3 중 광역시/특별시 직할 구(full_name 2단어)는 시군과 동일 기준 적용
    g.selectAll<SVGPathElement, SigungFeature>('path.sigungu')
      .attr('display', (d) => {
        const lvl = d.properties.admin_level;
        if (lvl === 1) return null;
        if (lvl === 2) return k >= ZOOM_SIGUNGU_LEVEL2 ? null : 'none';
        const isMetroGu = d.properties.full_name.split(' ').length === 2;
        const threshold = isMetroGu ? ZOOM_SIGUNGU_LEVEL2 : ZOOM_SIGUNGU_LEVEL3;
        return k >= threshold ? null : 'none';
      });

    // 시군구 레이블: admin_level별 단계적 표시 + 글자 크기 역보정
    g.selectAll<SVGTextElement, SigungFeature>('text.sigungu-label')
      .attr('display', (d) => {
        const lvl = d.properties.admin_level;
        if (lvl === 1) return 'none';
        if (lvl === 2) return k >= ZOOM_SIGUNGU_LABEL ? null : 'none';
        const isMetroGu = d.properties.full_name.split(' ').length === 2;
        const threshold = isMetroGu ? ZOOM_SIGUNGU_LABEL : ZOOM_SIGUNGU_LEVEL3;
        return k >= threshold ? null : 'none';
      })
      .style('font-size', `${9 / k}px`);

    // Point 시설물: 가시성 판단 + 역보정 스케일 적용
    g.selectAll<SVGGElement, FacilityFeature>('g.facility-point-item').each(function(d) {
      const { type, station_type } = d.properties;
      let visible = false;
      if (type === '역') {
        visible = station_type === '관리역' ? k >= ZOOM_STATION : k >= ZOOM_STATION2;
      } else if (type === '변전소') {
        visible = k >= ZOOM_DETAIL;
      } else if (type === '구조물') {
        // 건널목·분기는 Point로 렌더, 터널·교량·과선교는 Segment로 렌더
        visible = (station_type === '건널목' || station_type === '분기') && k >= ZOOM_DETAIL;
      }

      const el = d3.select(this);
      el.attr('display', visible ? null : 'none');

      // 투영 좌표 기준으로 translate 유지하면서 크기 역보정
      const coords = (d.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates;
      const pt = proj(coords);
      if (pt) el.attr('transform', `translate(${pt[0]},${pt[1]}) scale(${1 / k})`);
    });

    // 구간 시설물 (구조물/터널·교량·과선교) — vector-effect로 선 두께는 이미 고정
    g.selectAll<SVGPathElement, FacilityFeature>('path.facility-segment').each(function(d) {
      const { type, station_type } = d.properties;
      const isLinearStructure = type === '구조물' && (station_type === '터널' || station_type === '교량' || station_type === '과선교');
      d3.select(this).attr('display', isLinearStructure && k >= ZOOM_SEGMENT ? null : 'none');
    });
  }

  // ── hiddenRoutes 변경 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!gRef.current || !allGeo) return;
    const g = d3.select(gRef.current);
    g.selectAll<SVGPathElement, (typeof allGeo.features)[0]>('path.route')
      .attr('display', (d) => hiddenRoutes.has(d.properties.route_code) ? 'none' : null);
  }, [hiddenRoutes, allGeo]);

  // ── 시군구 배경 레이어 (sigunguData가 allGeo 이후에 도착한 경우) ──────────
  useEffect(() => {
    if (!gRef.current || !projRef.current || !sigunguData) return;
    const g = d3.select(gRef.current);
    const bgLayer    = g.select<SVGGElement>('.sigungu-background');
    const labelLayer = g.select<SVGGElement>('.sigungu-labels');
    if (bgLayer.empty() || labelLayer.empty()) return;

    bgLayer.selectAll('*').remove();
    labelLayer.selectAll('*').remove();

    const pathGen = d3.geoPath().projection(projRef.current);
    _renderSigungu(bgLayer, labelLayer, sigunguData.features, pathGen, projRef.current);
    _updateFacilityVisibility(scaleRef.current);
  }, [sigunguData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 조직 viewport 적용 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!allGeo || allGeo.features.length === 0) return;
    if (!orgViewport || !projRef.current || !zoomRef.current || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const container = svgRef.current.parentElement!;
    const W = container.clientWidth  || 900;
    const H = container.clientHeight || 700;

    const center = projRef.current([orgViewport.center_lon, orgViewport.center_lat]);
    if (!center) return;

    const k = orgViewport.zoom_level;
    svg.call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(W / 2 - k * center[0], H / 2 - k * center[1]).scale(k),
    );
  }, [allGeo, orgViewport]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 조직 관할 경계 업데이트 ─────────────────────────────────────────────
  useEffect(() => {
    if (!gRef.current || !projRef.current) return;
    const g = d3.select(gRef.current);
    const layer = g.select<SVGGElement>('.org-boundaries');
    layer.selectAll('*').remove();
    if (!showOrgBoundary || !orgBoundary || orgBoundary.features.length === 0) return;

    const pathGen = d3.geoPath().projection(projRef.current);
    layer
      .selectAll<SVGPathElement, (typeof orgBoundary.features)[0]>('path.org-boundary')
      .data(orgBoundary.features)
      .join('path')
      .attr('class', 'org-boundary')
      .attr('d', (d) => pathGen(d as any) ?? '')
      .attr('fill', 'none')
      .attr('stroke', (d) => FIELD_COLORS[d.properties.field] ?? '#2563eb')
      .attr('stroke-width', 4)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('opacity', 0.7)
      .attr('stroke-linecap', 'round')
      .append('title')
      .text((d) => {
        const p = d.properties;
        return `${p.organization_name} — ${p.route_name}\n${p.field} | ${p.start_km}~${p.end_km}km`;
      });
  }, [showOrgBoundary, orgBoundary]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 차단명령 구간 레이어 ─────────────────────────────────────────────────
  // UP(상선) = 선로 좌측 오프셋, DOWN(하선) = 우측 오프셋
  // 전차선 단전(section_type='power_cut') = 점선 스타일
  useEffect(() => {
    if (!gRef.current || !projRef.current) return;
    const proj = projRef.current;
    const g = d3.select(gRef.current);
    const layer = g.select<SVGGElement>('.block-segments');
    layer.selectAll('*').remove();
    if (!blockSegments || blockSegments.features.length === 0) return;

    layer
      .selectAll<SVGPathElement, BlockSegmentFeature>('path.block-segment')
      .data(blockSegments.features)
      .join('path')
      .attr('class', 'block-segment')
      .attr('d', (d) =>
        buildOffsetPath(
          d.geometry.coordinates as [number, number][],
          d.properties.direction,
          proj,
        )
      )
      .attr('fill', 'none')
      .attr('stroke', (d) => BLOCK_DIR_COLORS[d.properties.direction] ?? '#ef4444')
      .attr('stroke-width', (d) => d.properties.id === selectedBlockId ? 6 : 4)
      .attr('stroke-dasharray', (d) =>
        d.properties.section_type === 'power_cut' ? '8 4' : null
      )
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('opacity', (d) => d.properties.id === selectedBlockId ? 1.0 : 0.75)
      .attr('stroke-linecap', 'round')
      .style('cursor', 'pointer')
      .append('title')
      .text((d) => {
        const p = d.properties;
        const loc = p.section_type === 'power_cut'
          ? (p.section_note ?? p.display_km)
          : `${p.display_km}km`;
        const dir = p.direction === 'UP' ? '상선(좌)' : '하선(우)';
        return `${p.route_name} ${loc} [${dir}]\n${p.work_date} ${p.start_time}~${p.end_time}\n${p.field} / ${p.block_type}`;
      });
  }, [blockSegments, selectedBlockId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 시설물 레이어 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gRef.current || !projRef.current) return;
    const g = d3.select(gRef.current);

    const segLayer   = g.select<SVGGElement>('.facility-segments');
    const pointLayer = g.select<SVGGElement>('.facility-points');
    segLayer.selectAll('*').remove();
    pointLayer.selectAll('*').remove();

    if (mergedFacilityFeatures.length === 0) return;

    const pathGen = d3.geoPath().projection(projRef.current);

    // ① 구간 시설물 (LineString: 구조물/터널·교량·과선교)
    const segFeatures = mergedFacilityFeatures.filter(
      (f) => f.geometry.type === 'LineString',
    );
    segLayer
      .selectAll<SVGPathElement, FacilityFeature>('path.facility-segment')
      .data(segFeatures)
      .join('path')
      .attr('class', 'facility-segment')
      .attr('d', (d) => pathGen(d as any) ?? '')
      .attr('fill', 'none')
      .attr('stroke', (d) => facilityColor(d.properties.type, d.properties.station_type))
      .attr('stroke-width', 4)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('opacity', 0.8)
      .attr('stroke-linecap', 'round')
      .attr('display', 'none')  // 초기 숨김 — 줌에서 제어
      .append('title')
      .text((d) => `[${d.properties.station_type ?? d.properties.type}] ${d.properties.name}\n${d.properties.km}~${d.properties.km_end}km`);

    // ② Point 시설물
    const pointFeatures = mergedFacilityFeatures.filter(
      (f) => f.geometry.type === 'Point',
    );

    type MergedFeature = FacilityFeature & { _lines: { route_name: string; km: number }[] };

    const pointGroups = pointLayer
      .selectAll<SVGGElement, MergedFeature>('g.facility-point-item')
      .data(pointFeatures as MergedFeature[])
      .join('g')
      .attr('class', 'facility-point-item')
      .attr('display', 'none')  // 초기 숨김 — 가시성·transform은 _updateFacilityVisibility 일괄 처리
      .style('cursor', 'pointer')
      .on('click', function(event: MouseEvent, d: MergedFeature) {
        event.stopPropagation();
        const svgEl = svgRef.current;
        if (!svgEl) return;
        const rect = svgEl.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;

        const label = d.properties.station_type ?? d.properties.type;
        const info = d._lines
          .map((l) => `${l.route_name}  ${l.km}km`)
          .join('\n');
        setPopupRef.current({
          x: px, y: py,
          name: d.properties.name,
          type: label,
          info,
        });
      });

    // 관리역: 큰 원 + 역명
    pointGroups.filter((d) => d.properties.type === '역' && d.properties.station_type === '관리역')
      .call((sel) => {
        sel.append('circle')
          .attr('r', 4)
          .attr('fill', LEGEND_COLORS.관리역)
          .attr('stroke', 'white')
          .attr('stroke-width', 1.5)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('text')
          .attr('x', 6)
          .attr('y', 3)
          .attr('font-size', '11px')
          .attr('fill', LEGEND_COLORS.관리역)
          .attr('font-weight', '600')
          .style('pointer-events', 'none')
          .text((d) => d.properties.name);
        sel.append('title').text((d) => `[관리역] ${d.properties.name}  클릭하여 상세 보기`);
      });

    // 보통역·무인역: 중간 원 + 역명
    pointGroups.filter((d) => d.properties.type === '역' && d.properties.station_type !== '관리역' && d.properties.station_type !== '신호장' && d.properties.station_type !== '신호소')
      .call((sel) => {
        sel.append('circle')
          .attr('r', 2.5)
          .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type))
          .attr('stroke', 'white')
          .attr('stroke-width', 1)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('text')
          .attr('x', 5)
          .attr('y', 3)
          .attr('font-size', '10px')
          .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type))
          .style('pointer-events', 'none')
          .text((d) => d.properties.name);
        sel.append('title').text((d) => `[${d.properties.station_type}] ${d.properties.name}  클릭하여 상세 보기`);
      });

    // 신호장·신호소: 작은 다이아몬드
    pointGroups.filter((d) => d.properties.type === '역' && (d.properties.station_type === '신호장' || d.properties.station_type === '신호소'))
      .call((sel) => {
        sel.append('polygon')
          .attr('points', '0,-3 3,0 0,3 -3,0')
          .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type))
          .attr('stroke', 'white').attr('stroke-width', 1)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('title').text((d) => `[${d.properties.station_type}] ${d.properties.name}  KP ${d.properties.km}km`);
      });

    // 변전소: 사각형
    pointGroups.filter((d) => d.properties.type === '변전소')
      .call((sel) => {
        sel.append('rect')
          .attr('x', -4).attr('y', -4).attr('width', 8).attr('height', 8)
          .attr('fill', LEGEND_COLORS.변전소)
          .attr('stroke', 'white').attr('stroke-width', 1)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('title').text((d) => `[${d.properties.station_type ?? '변전소'}] ${d.properties.name}  KP ${d.properties.km}km`);
      });

    // 건널목: × 마커
    pointGroups.filter((d) => d.properties.type === '구조물' && d.properties.station_type === '건널목')
      .call((sel) => {
        const s = 4;
        sel.append('line')
          .attr('x1', -s).attr('y1', -s).attr('x2', s).attr('y2', s)
          .attr('stroke', LEGEND_COLORS.건널목).attr('stroke-width', 2)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('line')
          .attr('x1', s).attr('y1', -s).attr('x2', -s).attr('y2', s)
          .attr('stroke', LEGEND_COLORS.건널목).attr('stroke-width', 2)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('title').text((d) => `[건널목] ${d.properties.name}  KP ${d.properties.km}km`);
      });

    // 분기: 다이아몬드
    pointGroups.filter((d) => d.properties.type === '구조물' && d.properties.station_type === '분기')
      .call((sel) => {
        sel.append('polygon')
          .attr('points', '0,-5 5,0 0,5 -5,0')
          .attr('fill', LEGEND_COLORS.분기)
          .attr('stroke', 'white').attr('stroke-width', 1)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('title').text((d) => `[분기] ${d.properties.name}  KP ${d.properties.km}km`);
      });

    // 초기 가시성 적용
    _updateFacilityVisibility(scaleRef.current);

  }, [mergedFacilityFeatures]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 줌 컨트롤 핸들러 ─────────────────────────────────────────────────────
  function handleZoomIn() {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 1.5);
  }
  function handleZoomOut() {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 1 / 1.5);
  }
  function handleZoomReset() {
    if (!svgRef.current || !zoomRef.current) return;
    const container = svgRef.current.parentElement!;
    const W = container.clientWidth  || 900;
    const H = container.clientHeight || 700;
    d3.select(svgRef.current).transition().duration(400).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(W / 4, H / 4).scale(0.5),
    );
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full bg-[#e8edf2]">
      <svg ref={svgRef} className="w-full h-full">
        <g ref={gRef} />
      </svg>

      {/* 시설물 팝업 */}
      {facilityPopup && (
        <div
          className="absolute z-10 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm pointer-events-none"
          style={{
            left: facilityPopup.x + 12,
            top:  facilityPopup.y - 8,
            maxWidth: 240,
            // 화면 오른쪽 가장자리 넘침 방지는 CSS transform으로 처리
            transform: facilityPopup.x > (svgRef.current?.clientWidth ?? 0) - 260
              ? 'translateX(-110%)'
              : undefined,
          }}
        >
          <div className="font-semibold text-gray-800 mb-1 border-b pb-1">
            <span className="text-xs text-gray-400 mr-1">{facilityPopup.type}</span>
            {facilityPopup.name}
          </div>
          <table className="text-xs text-gray-600 w-full">
            <tbody>
              {facilityPopup.info.split('\n').map((line, i) => {
                const [routeName, km] = line.split(/\s{2,}/);
                return (
                  <tr key={i}>
                    <td className="pr-3 text-gray-700">{routeName}</td>
                    <td className="text-right font-mono text-blue-600">{km}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 범례 */}
      <div className="absolute bottom-4 left-4 bg-white/90 rounded-lg shadow px-3 py-2 text-xs space-y-1 border">
        <div className="font-medium text-gray-600 mb-1">노선 구분</div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-px bg-gray-700" />
          <span className="text-gray-600">일반선 (공식)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-px bg-red-600" />
          <span className="text-gray-600">고속선 (공식)</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          <span className="text-gray-400">SHP 참조</span>
        </div>
        {mergedFacilityFeatures.length > 0 && (
          <>
            <div className="border-t pt-1 mt-1 font-medium text-gray-600">시설물 — 역</div>
            {(['관리역', '보통역', '신호장'] as const).map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: LEGEND_COLORS[k] }} />
                <span className="text-gray-600">{k}</span>
              </div>
            ))}
            <div className="border-t pt-1 mt-1 font-medium text-gray-600">구조물</div>
            {(['터널', '교량', '건널목'] as const).map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: LEGEND_COLORS[k] }} />
                <span className="text-gray-600">{k}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: LEGEND_COLORS.변전소 }} />
              <span className="text-gray-600">변전소</span>
            </div>
          </>
        )}
        {blockSegments && blockSegments.features.length > 0 && (
          <>
            <div className="border-t pt-1 mt-1 font-medium text-gray-600">차단구간</div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-6 h-1.5 rounded" style={{ backgroundColor: BLOCK_DIR_COLORS.UP }} />
              <span className="text-gray-600">상선 (UP)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-6 h-1.5 rounded" style={{ backgroundColor: BLOCK_DIR_COLORS.DOWN }} />
              <span className="text-gray-600">하선 (DOWN)</span>
            </div>
          </>
        )}
        {showOrgBoundary && (
          <>
            <div className="border-t pt-1 mt-1 font-medium text-gray-600">관할 구간</div>
            {Object.entries(FIELD_COLORS).map(([field, color]) => (
              <div key={field} className="flex items-center gap-2">
                <span className="inline-block w-6 h-1 rounded" style={{ backgroundColor: color }} />
                <span className="text-gray-600">{field === 'all' ? '전체' : field}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* 줌 컨트롤 */}
      <div className="absolute top-4 right-4 flex flex-col items-center gap-1">
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 bg-white/90 border rounded shadow text-gray-700 hover:bg-gray-100 font-bold text-lg leading-none"
          title="확대"
        >+</button>
        <span
          ref={zoomDisplayRef}
          className="text-center text-xs text-gray-600 bg-white/80 rounded px-1 py-0.5 min-w-[2.5rem]"
        >×1.0</span>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 bg-white/90 border rounded shadow text-gray-700 hover:bg-gray-100 font-bold text-xl leading-none"
          title="축소"
        >−</button>
        <button
          onClick={handleZoomReset}
          className="mt-1 w-8 h-8 bg-white/90 border rounded shadow text-gray-500 hover:bg-gray-100 text-[10px] leading-none"
          title="전국 조망"
        >전체</button>
      </div>

      {/* 조작 안내 */}
      <div className="absolute bottom-4 right-4 text-xs text-gray-400 bg-white/80 px-2 py-1 rounded">
        스크롤·버튼: 확대/축소 · 드래그: 이동
      </div>

      {!allGeo && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
          노선도 데이터를 불러오는 중...
        </div>
      )}
    </div>
  );
}
