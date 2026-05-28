import { useEffect, useRef, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3 from 'd3';
import {
  fetchAllRailRouteGeometry,
  fetchAllRailStations,
  fetchOrgBoundaries,
  fetchOrgViewport,
  fetchSigungu,
  type RailRouteFeature,
  type RailRouteFeatureCollection,
  type OrgBoundaryCollection,
  type OrgViewport,
  type FacilityFeature,
  type FacilityCollection,
  type BlockSegmentCollection,
  type BlockSegmentFeature,
  type SigungCollection,
  type SigungFeature,
} from '../../api/map';
import type { FacilityFilter } from '../../types';

interface Props {
  orgId: number | null;
  showOrgBoundary: boolean;
  /** routes-computed 레이어 line_type 필터 — Set에 포함된 line_type은 숨김 */
  hiddenLineTypes?: Set<'고속선' | '일반선'>;
  /** 시설물 분류 필터 — null이면 시설물 미표시 */
  facilityFilter?: FacilityFilter | null;
  /** 특정 노선 코드로 시설물 필터링 (null=전체) */
  filterRouteCode?: string | null;
  /** 위험지구(2m)/보호지구(30m) 시각화 ON/OFF */
  showDangerZone?: boolean;
  /** 차단명령 구간 오버레이 데이터 */
  blockSegments?: BlockSegmentCollection | null;
  /** 선택된 차단명령 ID (강조 표시) */
  selectedBlockId?: number | null;
}

// ── 색상 정의 ──────────────────────────────────────────────────────────────

function computedRouteStroke(lineType: '고속선' | '일반선'): string {
  return lineType === '고속선' ? '#dc2626' : '#374151';
}

const FIELD_COLORS: Record<string, string> = {
  all: '#2563eb',
  시설: '#7c3aed',
  전기: '#d97706',
  건축: '#dc2626',
};

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
  if (type === '변전소') {
    switch (stationType) {
      case '전기실':     return '#0284c7';
      case '통신실':     return '#16a34a';
      case '신호기계실': return '#b45309';
      default:           return '#7c3aed';
    }
  }
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

const LEGEND_COLORS = {
  관리역:     '#1d4ed8',
  보통역:     '#3b82f6',
  무인역:     '#60a5fa',
  신호장:     '#818cf8',
  신호소:     '#a78bfa',
  터널:       '#6b7280',
  교량:       '#0891b2',
  건널목:     '#f59e0b',
  변전소:     '#7c3aed',
  분기:       '#059669',
  전기실:     '#0284c7',
  통신실:     '#16a34a',
  신호기계실: '#b45309',
};

const BLOCK_DIR_COLORS: Record<string, string> = {
  UP:   '#ef4444',
  DOWN: '#f97316',
};

const BLOCK_OFFSET_SVG = 4;

function buildOffsetPath(
  coords: [number, number][],
  direction: 'UP' | 'DOWN',
  projection: d3.GeoProjection,
): string {
  const pts = coords
    .map(([lon, lat]) => projection([lon, lat]))
    .filter((p): p is [number, number] => p !== null);

  if (pts.length < 2) return '';

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
    const nx = -dy / len;
    const ny =  dx / len;
    return [p[0] + sign * BLOCK_OFFSET_SVG * nx, p[1] + sign * BLOCK_OFFSET_SVG * ny];
  });

  return d3.line()(offsetPts) ?? '';
}

interface FacilityPopup {
  x: number;
  y: number;
  name: string;
  type: string;
  info: string;
}

const SIDO_FILLS: Record<string, string> = {
  '11': 'rgba(248,113,113,0.15)',
  '26': 'rgba(96,165,250,0.15)',
  '27': 'rgba(167,139,250,0.15)',
  '28': 'rgba(52,211,153,0.15)',
  '29': 'rgba(251,191,36,0.15)',
  '30': 'rgba(251,191,36,0.15)',
  '31': 'rgba(167,139,250,0.15)',
  '36': 'rgba(248,113,113,0.15)',
  '41': 'rgba(251,191,36,0.15)',
  '43': 'rgba(96,165,250,0.15)',
  '44': 'rgba(52,211,153,0.15)',
  '46': 'rgba(96,165,250,0.15)',
  '47': 'rgba(52,211,153,0.15)',
  '48': 'rgba(248,113,113,0.15)',
  '50': 'rgba(96,165,250,0.15)',
  '51': 'rgba(248,113,113,0.15)',
  '52': 'rgba(167,139,250,0.15)',
};

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

const ZOOM_STATION       = 0.8;
const ZOOM_STATION2      = 3;
const ZOOM_SEGMENT       = 3;
const ZOOM_DETAIL        = 8;
const ZOOM_SIGUNGU_LABEL  = 2;
const ZOOM_SIGUNGU_LEVEL2 = 1.5;
const ZOOM_SIGUNGU_LEVEL3 = 4.0;


export default function RailwayMap({
  orgId,
  showOrgBoundary,
  hiddenLineTypes = new Set(),
  facilityFilter = null,
  filterRouteCode = null,
  showDangerZone = false,
  blockSegments = null,
  selectedBlockId = null,
}: Props) {
  const svgRef            = useRef<SVGSVGElement>(null);
  const gRef              = useRef<SVGGElement>(null);
  const zoomRef           = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const projRef           = useRef<d3.GeoProjection | null>(null);
  const scaleRef          = useRef<number>(1);
  const zoomDisplayRef    = useRef<HTMLSpanElement>(null);
  const sigunguDataRef    = useRef<SigungCollection | null>(null);
  // stale-closure 방지 refs — zoom handler에서 최신 상태에 접근
  const facilityFilterRef  = useRef<FacilityFilter | null>(null);
  const filterRouteCodeRef = useRef<string | null>(null);
  const [facilityPopup, setFacilityPopup] = useState<FacilityPopup | null>(null);
  const setPopupRef = useRef(setFacilityPopup);

  // 매 렌더마다 refs 동기화
  facilityFilterRef.current  = facilityFilter;
  filterRouteCodeRef.current = filterRouteCode;

  // ── 데이터 조회 ─────────────────────────────────────────────────────────

  const { data: allRailGeo } = useQuery<RailRouteFeatureCollection>({
    queryKey: ['map-all-rail-geometry'],
    queryFn: () => fetchAllRailRouteGeometry('high'),
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

  const { data: sigunguData } = useQuery<SigungCollection>({
    queryKey: ['map-sigungu', 2],
    queryFn: () => fetchSigungu(2),
    staleTime: Infinity,
  });
  sigunguDataRef.current = sigunguData ?? null;

  const { data: railStations } = useQuery<FacilityCollection>({
    queryKey: ['map-all-rail-stations'],
    queryFn: fetchAllRailStations,
    enabled: facilityFilter != null,
    staleTime: Infinity,
  });

  // GPS 중복 마커 병합
  const mergedFacilityFeatures = useMemo(() => {
    const all = [...(railStations?.features ?? [])];
    const points = all.filter((f) => f.geometry.type === 'Point');
    const segs   = all.filter((f) => f.geometry.type !== 'Point');

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
      const rep = group.find((f) => f.properties.type === '역' && f.properties.station_type === '관리역')
        ?? group.find((f) => f.properties.type === '역')
        ?? group[0];
      const _lines = group.map((f) => ({ route_name: f.properties.route_name, km: f.properties.km }));
      deduped.push({ ...rep, _lines });
    }

    return [...segs, ...deduped];
  }, [railStations]);

  // ── D3 초기화 ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || !allRailGeo || allRailGeo.features.length === 0) return;

    const svg = d3.select(svgRef.current);
    const container = svgRef.current.parentElement!;
    const W = container.clientWidth  || 900;
    const H = container.clientHeight || 700;

    svg.attr('width', W).attr('height', H);

    if (!projRef.current) {
      const scale = Math.min(W * 15.9, H * 17.4);
      projRef.current = d3.geoMercator()
        .center([127.7, 36.3])
        .scale(scale)
        .translate([W / 2, H / 2]);
    }
    const projection = projRef.current;
    const pathGen = d3.geoPath().projection(projection);

    const g = d3.select(gRef.current!);
    g.selectAll('*').remove();
    g.append('g').attr('class', 'sigungu-background');
    g.append('g').attr('class', 'sigungu-labels');
    g.append('g').attr('class', 'routes-computed');
    g.append('g').attr('class', 'org-boundaries');
    g.append('g').attr('class', 'danger-zones');      // 위험/보호구간 (block-segments 아래)
    g.append('g').attr('class', 'block-segments');
    g.append('g').attr('class', 'facility-segments');
    g.append('g').attr('class', 'facility-points');

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
    svg.on('click', () => setPopupRef.current(null));

    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(W / 4, H / 4).scale(0.5),
    );

  }, [allRailGeo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 줌에 따른 시설물 가시성 + 고정 크기 보정 ───────────────────────────
  function _updateFacilityVisibility(k: number) {
    if (!gRef.current || !projRef.current) return;
    const g    = d3.select(gRef.current);
    const proj = projRef.current;
    const ff   = facilityFilterRef.current;
    const frc  = filterRouteCodeRef.current;

    // 시군구 경계 가시성
    g.selectAll<SVGPathElement, SigungFeature>('path.sigungu')
      .attr('display', (d) => {
        const lvl = d.properties.admin_level;
        if (lvl === 1) return null;
        if (lvl === 2) return k >= ZOOM_SIGUNGU_LEVEL2 ? null : 'none';
        const isMetroGu = d.properties.full_name.split(' ').length === 2;
        const threshold = isMetroGu ? ZOOM_SIGUNGU_LEVEL2 : ZOOM_SIGUNGU_LEVEL3;
        return k >= threshold ? null : 'none';
      });

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

    // Point 시설물: facilityFilter + routeCode 체크 후 줌 가시성 적용
    g.selectAll<SVGGElement, FacilityFeature>('g.facility-point-item').each(function(d) {
      const { type, station_type, route_code } = d.properties;

      // 노선 필터
      if (frc != null && route_code !== frc) {
        d3.select(this).attr('display', 'none');
        return;
      }

      // 분류 필터 (세분화된 키 사용)
      let typeOk = false;
      if (ff != null) {
        if (type === '역') {
          if      (station_type === '관리역') typeOk = ff.역관리역;
          else if (station_type === '보통역') typeOk = ff.역보통역;
          else if (station_type === '무인역') typeOk = ff.역무인역;
          else if (station_type === '신호장') typeOk = ff.역신호장;
          else if (station_type === '신호소') typeOk = ff.역신호소;
          else                               typeOk = ff.역보통역;  // station_type 미설정 fallback
        } else if (type === '변전소') {
          if (!station_type || ['ss','sp','ssp','atp','pp'].includes(station_type))
            typeOk = ff.전기변전소;
          else if (station_type === '전기실')     typeOk = ff.전기전기실;
          else if (station_type === '통신실')     typeOk = ff.전기통신실;
          else if (station_type === '신호기계실') typeOk = ff.전기신호기계실;
          else                                    typeOk = ff.전기변전소;
        } else if (type === '구조물') {
          if      (station_type === '건널목') typeOk = ff.구조물건널목;
          else if (station_type === '분기')   typeOk = ff.구조물분기;
          // 터널·교량·과선교는 LineString — segments에서 처리
        }
      }

      if (!typeOk) {
        d3.select(this).attr('display', 'none');
        return;
      }

      // 줌 가시성
      let visible = false;
      if (type === '역') {
        const isSignal = station_type === '신호장' || station_type === '신호소';
        visible = station_type === '관리역' ? k >= ZOOM_STATION
                : isSignal                  ? k >= ZOOM_STATION2
                :                             k >= ZOOM_STATION2;
      } else if (type === '변전소') {
        visible = k >= ZOOM_DETAIL;
      } else if (type === '구조물') {
        visible = (station_type === '건널목' || station_type === '분기') && k >= ZOOM_DETAIL;
      }

      const el = d3.select(this);
      el.attr('display', visible ? null : 'none');

      const coords = (d.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates;
      const pt = proj(coords);
      if (pt) el.attr('transform', `translate(${pt[0]},${pt[1]}) scale(${1 / k})`);
    });

    // 구간 시설물 (터널·교량·과선교) — 세분화된 키 사용
    g.selectAll<SVGPathElement, FacilityFeature>('path.facility-segment').each(function(d) {
      const { type, station_type, route_code } = d.properties;

      if (frc != null && route_code !== frc) {
        d3.select(this).attr('display', 'none');
        return;
      }

      let typeOk = false;
      if (ff != null && type === '구조물') {
        if      (station_type === '터널')   typeOk = ff.구조물터널;
        else if (station_type === '교량')   typeOk = ff.구조물교량;
        else if (station_type === '과선교') typeOk = ff.구조물과선교;
      }

      const isLinear = type === '구조물' &&
        (station_type === '터널' || station_type === '교량' || station_type === '과선교');
      d3.select(this).attr('display', isLinear && k >= ZOOM_SEGMENT && typeOk ? null : 'none');
    });
  }

  // ── hiddenLineTypes 변경 → routes-computed 레이어 display 갱신 ───────────
  useEffect(() => {
    if (!gRef.current || !allRailGeo) return;
    const g = d3.select(gRef.current);
    g.selectAll<SVGPathElement, RailRouteFeature>('path.route-computed')
      .attr('display', (d) => hiddenLineTypes.has(d.properties.line_type) ? 'none' : null);
  }, [hiddenLineTypes, allRailGeo]);

  // ── facilityFilter / filterRouteCode 변경 → 가시성 재계산 ───────────────
  useEffect(() => {
    _updateFacilityVisibility(scaleRef.current);
  }, [facilityFilter, filterRouteCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── rail_computed_geometry 노선 렌더링 ───────────────────────────────────
  useEffect(() => {
    if (!gRef.current || !projRef.current || !allRailGeo || allRailGeo.features.length === 0) return;
    const g       = d3.select(gRef.current);
    const layer   = g.select<SVGGElement>('.routes-computed');
    if (layer.empty()) return;

    const pathGen = d3.geoPath().projection(projRef.current);

    layer
      .selectAll<SVGPathElement, RailRouteFeature>('path.route-computed')
      .data(allRailGeo.features, (d) => String(d.properties.rail_route_id))
      .join('path')
      .attr('class', (d) => `route-computed route-computed-${d.properties.korail_route_code}`)
      .attr('d', (d) => pathGen(d as any) ?? '')
      .attr('fill', 'none')
      .attr('stroke', (d) => computedRouteStroke(d.properties.line_type))
      .attr('stroke-width', 1.5)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('display', (d) => hiddenLineTypes.has(d.properties.line_type) ? 'none' : null);
  }, [allRailGeo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 시군구 배경 레이어 ─────────────────────────────────────────────────
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
    if (!allRailGeo || allRailGeo.features.length === 0) return;
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
  }, [allRailGeo, orgViewport]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── 위험지구/보호지구 레이어 (block-segments 아래) ──────────────────────
  useEffect(() => {
    if (!gRef.current || !projRef.current) return;
    const proj = projRef.current;
    const g = d3.select(gRef.current);
    const layer = g.select<SVGGElement>('.danger-zones');
    layer.selectAll('*').remove();
    if (!showDangerZone || !blockSegments || blockSegments.features.length === 0) return;

    // 보호지구 (30m 대표: 너비 20px, 투명도 0.12)
    layer
      .selectAll<SVGPathElement, BlockSegmentFeature>('path.protect-zone')
      .data(blockSegments.features)
      .join('path')
      .attr('class', 'protect-zone')
      .attr('d', (d) =>
        buildOffsetPath(d.geometry.coordinates as [number, number][], d.properties.direction, proj)
      )
      .attr('fill', 'none')
      .attr('stroke', (d) => BLOCK_DIR_COLORS[d.properties.direction] ?? '#ef4444')
      .attr('stroke-width', 20)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('opacity', 0.12)
      .attr('stroke-linecap', 'round')
      .style('pointer-events', 'none');

    // 위험지구 (2m 대표: 너비 8px, 투명도 0.28)
    layer
      .selectAll<SVGPathElement, BlockSegmentFeature>('path.danger-zone')
      .data(blockSegments.features)
      .join('path')
      .attr('class', 'danger-zone')
      .attr('d', (d) =>
        buildOffsetPath(d.geometry.coordinates as [number, number][], d.properties.direction, proj)
      )
      .attr('fill', 'none')
      .attr('stroke', (d) => BLOCK_DIR_COLORS[d.properties.direction] ?? '#ef4444')
      .attr('stroke-width', 8)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('opacity', 0.28)
      .attr('stroke-linecap', 'round')
      .style('pointer-events', 'none');
  }, [showDangerZone, blockSegments]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 차단명령 구간 레이어 ─────────────────────────────────────────────────
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

    // ① 구간 시설물 (LineString)
    const segFeatures = mergedFacilityFeatures.filter((f) => f.geometry.type === 'LineString');
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
      .attr('display', 'none')
      .append('title')
      .text((d) => `[${d.properties.station_type ?? d.properties.type}] ${d.properties.name}\n${d.properties.km}~${d.properties.km_end}km`);

    // ② Point 시설물
    const pointFeatures = mergedFacilityFeatures.filter((f) => f.geometry.type === 'Point');

    type MergedFeature = FacilityFeature & { _lines: { route_name: string; km: number }[] };

    const pointGroups = pointLayer
      .selectAll<SVGGElement, MergedFeature>('g.facility-point-item')
      .data(pointFeatures as MergedFeature[])
      .join('g')
      .attr('class', 'facility-point-item')
      .attr('display', 'none')
      .style('cursor', 'pointer')
      .on('click', function(event: MouseEvent, d: MergedFeature) {
        event.stopPropagation();
        const svgEl = svgRef.current;
        if (!svgEl) return;
        const rect = svgEl.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const label = d.properties.station_type ?? d.properties.type;
        const info = d._lines.map((l) => `${l.route_name}  ${l.km}km`).join('\n');
        setPopupRef.current({ x: px, y: py, name: d.properties.name, type: label, info });
      });

    // 관리역: 큰 원 + 역명
    pointGroups.filter((d) => d.properties.type === '역' && d.properties.station_type === '관리역')
      .call((sel) => {
        sel.append('circle').attr('r', 4).attr('fill', LEGEND_COLORS.관리역)
          .attr('stroke', 'white').attr('stroke-width', 1.5).attr('vector-effect', 'non-scaling-stroke');
        sel.append('text').attr('x', 6).attr('y', 3).attr('font-size', '11px')
          .attr('fill', LEGEND_COLORS.관리역).attr('font-weight', '600')
          .style('pointer-events', 'none').text((d) => d.properties.name);
        sel.append('title').text((d) => `[관리역] ${d.properties.name}  클릭하여 상세 보기`);
      });

    // 보통역·무인역·(미분류): 중간 원 + 역명
    pointGroups.filter((d) =>
      d.properties.type === '역' &&
      d.properties.station_type !== '관리역' &&
      d.properties.station_type !== '신호장' &&
      d.properties.station_type !== '신호소'
    ).call((sel) => {
      sel.append('circle').attr('r', 2.5)
        .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type))
        .attr('stroke', 'white').attr('stroke-width', 1).attr('vector-effect', 'non-scaling-stroke');
      sel.append('text').attr('x', 5).attr('y', 3).attr('font-size', '10px')
        .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type))
        .style('pointer-events', 'none').text((d) => d.properties.name);
      sel.append('title').text((d) => `[${d.properties.station_type}] ${d.properties.name}  클릭하여 상세 보기`);
    });

    // 신호장·신호소: 작은 다이아몬드
    pointGroups.filter((d) =>
      d.properties.type === '역' &&
      (d.properties.station_type === '신호장' || d.properties.station_type === '신호소')
    ).call((sel) => {
      sel.append('polygon').attr('points', '0,-3 3,0 0,3 -3,0')
        .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type))
        .attr('stroke', 'white').attr('stroke-width', 1).attr('vector-effect', 'non-scaling-stroke');
      sel.append('title').text((d) => `[${d.properties.station_type}] ${d.properties.name}  KP ${d.properties.km}km`);
    });

    // 변전소/전기설비: 사각형 (station_type에 따라 색상 구분)
    pointGroups.filter((d) => d.properties.type === '변전소')
      .call((sel) => {
        sel.append('rect').attr('x', -4).attr('y', -4).attr('width', 8).attr('height', 8)
          .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type))
          .attr('stroke', 'white').attr('stroke-width', 1)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('title').text((d) => `[${d.properties.station_type ?? '변전소'}] ${d.properties.name}  KP ${d.properties.km}km`);
      });

    // 건널목: × 마커
    pointGroups.filter((d) => d.properties.type === '구조물' && d.properties.station_type === '건널목')
      .call((sel) => {
        const s = 4;
        sel.append('line').attr('x1', -s).attr('y1', -s).attr('x2', s).attr('y2', s)
          .attr('stroke', LEGEND_COLORS.건널목).attr('stroke-width', 2).attr('vector-effect', 'non-scaling-stroke');
        sel.append('line').attr('x1', s).attr('y1', -s).attr('x2', -s).attr('y2', s)
          .attr('stroke', LEGEND_COLORS.건널목).attr('stroke-width', 2).attr('vector-effect', 'non-scaling-stroke');
        sel.append('title').text((d) => `[건널목] ${d.properties.name}  KP ${d.properties.km}km`);
      });

    // 분기: 다이아몬드
    pointGroups.filter((d) => d.properties.type === '구조물' && d.properties.station_type === '분기')
      .call((sel) => {
        sel.append('polygon').attr('points', '0,-5 5,0 0,5 -5,0')
          .attr('fill', LEGEND_COLORS.분기).attr('stroke', 'white').attr('stroke-width', 1)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('title').text((d) => `[분기] ${d.properties.name}  KP ${d.properties.km}km`);
      });

    _updateFacilityVisibility(scaleRef.current);

  }, [mergedFacilityFeatures, allRailGeo]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── 범례 파생 ────────────────────────────────────────────────────────────
  const showStationLegend = facilityFilter != null && (
    facilityFilter.역관리역 || facilityFilter.역보통역 || facilityFilter.역무인역 ||
    facilityFilter.역신호장 || facilityFilter.역신호소
  );
  const showStructLegend  = facilityFilter != null && (
    facilityFilter.구조물터널 || facilityFilter.구조물교량 || facilityFilter.구조물과선교 ||
    facilityFilter.구조물건널목 || facilityFilter.구조물분기
  );
  const showElecLegend    = facilityFilter != null && (
    facilityFilter.전기변전소 || facilityFilter.전기전기실 ||
    facilityFilter.전기통신실 || facilityFilter.전기신호기계실
  );

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

      {/* 좌하단 범례: 차단구간·관할구간 (데이터 있을 때만) */}
      {((blockSegments && blockSegments.features.length > 0) || showOrgBoundary) && (
        <div className="absolute bottom-4 left-4 bg-white/90 rounded-lg shadow px-3 py-2 text-xs space-y-1 border">
          {blockSegments && blockSegments.features.length > 0 && (
            <>
              <div className="font-medium text-gray-600">차단구간</div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-6 h-1.5 rounded" style={{ backgroundColor: BLOCK_DIR_COLORS.UP }} />
                <span className="text-gray-600">상선 (UP)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-6 h-1.5 rounded" style={{ backgroundColor: BLOCK_DIR_COLORS.DOWN }} />
                <span className="text-gray-600">하선 (DOWN)</span>
              </div>
              {showDangerZone && (
                <>
                  <div className="border-t pt-1 mt-1 font-medium text-gray-600">구간 표시</div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-6 h-2 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.4)' }} />
                    <span className="text-gray-600">위험지구 2m</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-6 h-2 rounded" style={{ backgroundColor: 'rgba(249,115,22,0.2)' }} />
                    <span className="text-gray-600">보호지구 30m</span>
                  </div>
                </>
              )}
            </>
          )}
          {showOrgBoundary && (
            <>
              <div className={`font-medium text-gray-600 ${blockSegments && blockSegments.features.length > 0 ? 'border-t pt-1 mt-1' : ''}`}>관할 구간</div>
              {Object.entries(FIELD_COLORS).map(([field, color]) => (
                <div key={field} className="flex items-center gap-2">
                  <span className="inline-block w-6 h-1 rounded" style={{ backgroundColor: color }} />
                  <span className="text-gray-600">{field === 'all' ? '전체' : field}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* 줌 컨트롤 */}
      <div className="absolute top-4 right-4 flex flex-col items-center gap-1">
        <button onClick={handleZoomIn}
          className="w-8 h-8 bg-white/90 border rounded shadow text-gray-700 hover:bg-gray-100 font-bold text-lg leading-none"
          title="확대">+</button>
        <span ref={zoomDisplayRef}
          className="text-center text-xs text-gray-600 bg-white/80 rounded px-1 py-0.5 min-w-[2.5rem]">
          ×1.0</span>
        <button onClick={handleZoomOut}
          className="w-8 h-8 bg-white/90 border rounded shadow text-gray-700 hover:bg-gray-100 font-bold text-xl leading-none"
          title="축소">−</button>
        <button onClick={handleZoomReset}
          className="mt-1 w-8 h-8 bg-white/90 border rounded shadow text-gray-500 hover:bg-gray-100 text-[10px] leading-none"
          title="전국 조망">전체</button>
      </div>

      {/* 우하단 컬럼: 통합 범례 + 조작 안내 */}
      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">

        {/* 통합 범례 카드: 노선 구분 + 시설물 */}
        <div className="bg-white/90 rounded-lg shadow px-3 py-2 text-xs space-y-1 border max-h-[60vh] overflow-y-auto">
          {/* 노선 구분 */}
          <div className="font-medium text-gray-600">노선 구분</div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-6 h-px bg-gray-700" />
            <span className="text-gray-600">일반선</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-6 h-px bg-red-600" />
            <span className="text-gray-600">고속선</span>
          </div>

          {/* 시설물 범례 (체크된 항목이 있을 때) */}
          {showStationLegend && (
            <>
              <div className="border-t pt-1 mt-0.5 font-medium text-gray-600">역</div>
              {(
                [
                  ['관리역', LEGEND_COLORS.관리역, facilityFilter?.역관리역],
                  ['보통역', LEGEND_COLORS.보통역, facilityFilter?.역보통역],
                  ['무인역', LEGEND_COLORS.무인역, facilityFilter?.역무인역],
                  ['신호장', LEGEND_COLORS.신호장, facilityFilter?.역신호장],
                  ['신호소', LEGEND_COLORS.신호소, facilityFilter?.역신호소],
                ] as [string, string, boolean | undefined][]
              ).filter(([,, on]) => on).map(([k, c]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c }} />
                  <span className="text-gray-600">{k}</span>
                </div>
              ))}
            </>
          )}
          {showStructLegend && (
            <>
              <div className="border-t pt-1 mt-0.5 font-medium text-gray-600">구조물</div>
              {(
                [
                  ['터널',   LEGEND_COLORS.터널,   facilityFilter?.구조물터널],
                  ['교량',   LEGEND_COLORS.교량,   facilityFilter?.구조물교량],
                  ['과선교', LEGEND_COLORS.교량,   facilityFilter?.구조물과선교],
                  ['건널목', LEGEND_COLORS.건널목, facilityFilter?.구조물건널목],
                  ['분기',   LEGEND_COLORS.분기,   facilityFilter?.구조물분기],
                ] as [string, string, boolean | undefined][]
              ).filter(([,, on]) => on).map(([k, c]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c }} />
                  <span className="text-gray-600">{k}</span>
                </div>
              ))}
            </>
          )}
          {showElecLegend && (
            <>
              <div className="border-t pt-1 mt-0.5 font-medium text-gray-600">전기설비</div>
              {facilityFilter!.전기변전소 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded shrink-0" style={{ backgroundColor: LEGEND_COLORS.변전소 }} />
                  <span className="text-gray-600">변전소</span>
                </div>
              )}
              {facilityFilter!.전기전기실 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded shrink-0" style={{ backgroundColor: LEGEND_COLORS.전기실 }} />
                  <span className="text-gray-600">전기실</span>
                </div>
              )}
              {facilityFilter!.전기통신실 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded shrink-0" style={{ backgroundColor: LEGEND_COLORS.통신실 }} />
                  <span className="text-gray-600">통신실</span>
                </div>
              )}
              {facilityFilter!.전기신호기계실 && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded shrink-0" style={{ backgroundColor: LEGEND_COLORS.신호기계실 }} />
                  <span className="text-gray-600">신호기계실</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* 조작 안내 */}
        <div className="text-xs text-gray-400 bg-white/80 px-2 py-1 rounded">
          스크롤·버튼: 확대/축소 · 드래그: 이동
        </div>

      </div>

      {!allRailGeo && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
          노선도 데이터를 불러오는 중...
        </div>
      )}
    </div>
  );
}
