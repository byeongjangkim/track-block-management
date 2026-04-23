import { useEffect, useRef, useMemo, useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import * as d3 from 'd3';
import {
  fetchAllGeometry,
  fetchOrgBoundaries,
  fetchOrgViewport,
  fetchRouteFacilities,
  type RouteFeatureCollection,
  type OrgBoundaryCollection,
  type OrgViewport,
  type FacilityFeature,
  type BlockSegmentCollection,
  type BlockSegmentFeature,
} from '../../api/map';

interface Props {
  orgId: number | null;
  showOrgBoundary: boolean;
  hiddenRoutes: Set<string>;
  /** 시설물 표시 ON/OFF — true이면 표시 중인 노선 중 user geometry 있는 것 전체 표시 */
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

// 시설물 type별 색상
const FACILITY_COLORS: Record<string, string> = {
  STATION:         '#1d4ed8',  // 파란색 (관리역)
  GENERAL_STATION: '#0ea5e9',  // 하늘색 (일반역)
  TUNNEL:          '#6b7280',  // 회색
  BRIDGE:          '#0891b2',  // 청록색
  OVERPASS:        '#dc2626',  // 빨간색
  CROSSING:        '#f59e0b',  // 노란색
  SUBSTATION:      '#7c3aed',  // 보라색
  JUNCTION:        '#059669',  // 초록색
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

// 줌 스케일 기준 (초기 줌 ~0.95)
const ZOOM_STATION         = 0.8;  // 관리역: 초기 화면부터 표시
const ZOOM_GENERAL_STATION = 3;    // 일반역: 중간 확대 후 표시
const ZOOM_SEGMENT         = 3;    // 터널·교량: 약간 확대 후 표시
const ZOOM_DETAIL          = 8;    // 건널목·변전소·분기점: 크게 확대 후 표시


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

  // user geometry 보유 노선 목록 (allGeo 에서 source='user' 추출)
  const userRouteCodes = useMemo(() => {
    if (!allGeo) return [] as string[];
    return [...new Set(
      allGeo.features
        .filter((f) => f.properties.source === 'user')
        .map((f) => f.properties.route_code),
    )];
  }, [allGeo]);

  // showFacilities=true 이고 현재 표시 중인(숨기지 않은) user 노선만 대상
  const targetRouteCodes = useMemo(() => {
    if (!showFacilities) return [] as string[];
    return userRouteCodes.filter((code) => !hiddenRoutes.has(code));
  }, [showFacilities, userRouteCodes, hiddenRoutes]);

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
      // 대표 마커: STATION 우선, 없으면 GENERAL_STATION, 없으면 첫 번째
      const rep = group.find((f) => f.properties.type === 'STATION')
        ?? group.find((f) => f.properties.type === 'GENERAL_STATION')
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
      projRef.current = d3.geoMercator().fitSize([W, H], allGeo);
    }
    const projection = projRef.current;
    const pathGen = d3.geoPath().projection(projection);

    const g = d3.select(gRef.current!);

    // 최초 초기화: 전체 레이어 구성
    g.selectAll('*').remove();
    g.append('g').attr('class', 'routes');
    g.append('g').attr('class', 'org-boundaries');
    g.append('g').attr('class', 'block-segments');
    g.append('g').attr('class', 'facility-segments');
    g.append('g').attr('class', 'facility-points');

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

    const pad = 0.05;
    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(W * pad, H * pad).scale(1 - pad),
    );

  }, [allGeo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 줌에 따른 시설물 가시성 + 고정 크기 보정 ───────────────────────────
  // scale(1/k): 부모 <g>의 줌 배율을 상쇄 → 마커·텍스트가 화면에서 항상 동일 크기
  function _updateFacilityVisibility(k: number) {
    if (!gRef.current || !projRef.current) return;
    const g    = d3.select(gRef.current);
    const proj = projRef.current;

    // Point 시설물: 가시성 판단 + 역보정 스케일 적용
    g.selectAll<SVGGElement, FacilityFeature>('g.facility-point-item').each(function(d) {
      const ftype = d.properties.type;
      let visible = false;
      if      (ftype === 'STATION')          visible = k >= ZOOM_STATION;
      else if (ftype === 'GENERAL_STATION')  visible = k >= ZOOM_GENERAL_STATION;
      else if (ftype === 'CROSSING' || ftype === 'SUBSTATION' || ftype === 'JUNCTION')
                                             visible = k >= ZOOM_DETAIL;

      const el = d3.select(this);
      el.attr('display', visible ? null : 'none');

      // 투영 좌표 기준으로 translate 유지하면서 크기 역보정
      const coords = (d.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates;
      const pt = proj(coords);
      if (pt) el.attr('transform', `translate(${pt[0]},${pt[1]}) scale(${1 / k})`);
    });

    // 구간 시설물 (TUNNEL·BRIDGE·OVERPASS) — vector-effect로 선 두께는 이미 고정
    g.selectAll<SVGPathElement, FacilityFeature>('path.facility-segment').each(function(d) {
      const ftype = d.properties.type;
      const visible = (ftype === 'TUNNEL' || ftype === 'BRIDGE' || ftype === 'OVERPASS') && k >= ZOOM_SEGMENT;
      d3.select(this).attr('display', visible ? null : 'none');
    });
  }

  // ── hiddenRoutes 변경 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!gRef.current || !allGeo) return;
    const g = d3.select(gRef.current);
    g.selectAll<SVGPathElement, (typeof allGeo.features)[0]>('path.route')
      .attr('display', (d) => hiddenRoutes.has(d.properties.route_code) ? 'none' : null);
  }, [hiddenRoutes, allGeo]);

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

    // ① 구간 시설물 (LineString: TUNNEL·BRIDGE·OVERPASS)
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
      .attr('stroke', (d) => FACILITY_COLORS[d.properties.type] ?? '#6b7280')
      .attr('stroke-width', 4)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('opacity', 0.8)
      .attr('stroke-linecap', 'round')
      .attr('display', 'none')  // 초기 숨김 — 줌에서 제어
      .append('title')
      .text((d) => `[${d.properties.type}] ${d.properties.name}\n${d.properties.km}~${d.properties.km_end}km`);

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
        // SVG 컨테이너 기준 팝업 위치
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;

        const TYPE_LABEL: Record<string, string> = {
          STATION: '관리역', GENERAL_STATION: '일반역', TUNNEL: '터널',
          BRIDGE: '교량', OVERPASS: '과선교', CROSSING: '건널목',
          SUBSTATION: '변전소', JUNCTION: '분기점',
        };
        const info = d._lines
          .map((l) => `${l.route_name}  ${l.km}km`)
          .join('\n');
        setPopupRef.current({
          x: px, y: py,
          name: d.properties.name,
          type: TYPE_LABEL[d.properties.type] ?? d.properties.type,
          info,
        });
      });

    // STATION: 원 + 역명 (관리역)
    pointGroups.filter((d) => d.properties.type === 'STATION')
      .call((sel) => {
        sel.append('circle')
          .attr('r', 4)
          .attr('fill', FACILITY_COLORS.STATION)
          .attr('stroke', 'white')
          .attr('stroke-width', 1.5)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('text')
          .attr('x', 6)
          .attr('y', 3)
          .attr('font-size', '11px')
          .attr('fill', FACILITY_COLORS.STATION)
          .attr('font-weight', '600')
          .style('pointer-events', 'none')
          .text((d) => d.properties.name);
        sel.append('title').text((d) => `[관리역] ${d.properties.name}  클릭하여 상세 보기`);
      });

    // GENERAL_STATION: 작은 원 + 역명 (일반역/소속역)
    pointGroups.filter((d) => d.properties.type === 'GENERAL_STATION')
      .call((sel) => {
        sel.append('circle')
          .attr('r', 2.5)
          .attr('fill', FACILITY_COLORS.GENERAL_STATION)
          .attr('stroke', 'white')
          .attr('stroke-width', 1)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('text')
          .attr('x', 5)
          .attr('y', 3)
          .attr('font-size', '10px')
          .attr('fill', FACILITY_COLORS.GENERAL_STATION)
          .style('pointer-events', 'none')
          .text((d) => d.properties.name);
        sel.append('title').text((d) => `[일반역] ${d.properties.name}  클릭하여 상세 보기`);
      });

    // CROSSING: × 마커
    pointGroups.filter((d) => d.properties.type === 'CROSSING')
      .call((sel) => {
        const s = 4;
        sel.append('line')
          .attr('x1', -s).attr('y1', -s).attr('x2', s).attr('y2', s)
          .attr('stroke', FACILITY_COLORS.CROSSING).attr('stroke-width', 2)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('line')
          .attr('x1', s).attr('y1', -s).attr('x2', -s).attr('y2', s)
          .attr('stroke', FACILITY_COLORS.CROSSING).attr('stroke-width', 2)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('title').text((d) => `[건널목] ${d.properties.name}  KP ${d.properties.km}km`);
      });

    // SUBSTATION: 사각형
    pointGroups.filter((d) => d.properties.type === 'SUBSTATION')
      .call((sel) => {
        sel.append('rect')
          .attr('x', -4).attr('y', -4).attr('width', 8).attr('height', 8)
          .attr('fill', FACILITY_COLORS.SUBSTATION)
          .attr('stroke', 'white').attr('stroke-width', 1)
          .attr('vector-effect', 'non-scaling-stroke');
        sel.append('title').text((d) => `[변전소] ${d.properties.name}  KP ${d.properties.km}km`);
      });

    // JUNCTION: 다이아몬드
    pointGroups.filter((d) => d.properties.type === 'JUNCTION')
      .call((sel) => {
        sel.append('polygon')
          .attr('points', '0,-5 5,0 0,5 -5,0')
          .attr('fill', FACILITY_COLORS.JUNCTION)
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
    const pad = 0.05;
    d3.select(svgRef.current).transition().duration(400).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(W * pad, H * pad).scale(1 - pad),
    );
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full bg-gray-50">
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
            <div className="border-t pt-1 mt-1 font-medium text-gray-600">시설물</div>
            {([
              ['STATION', '관리역'],
              ['GENERAL_STATION', '일반역'],
              ['TUNNEL', '터널'],
              ['BRIDGE', '교량'],
              ['CROSSING', '건널목'],
              ['SUBSTATION', '변전소'],
              ['JUNCTION', '분기점'],
            ] as const).map(([type, label]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: FACILITY_COLORS[type] }} />
                <span className="text-gray-600">{label}</span>
              </div>
            ))}
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
