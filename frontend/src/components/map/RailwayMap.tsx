import { useEffect, useRef, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3 from 'd3';
import { useSettingsStore } from '../../store/settingsStore';
import {
  fetchAllRailRouteGeometry,
  fetchAllRailStations,
  fetchAllRailFacilities,
  fetchOrgBoundaries,
  fetchOrgViewport,
  fetchSigungu,
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

// ── 차단구간 레인 타입 ──────────────────────────────────────────────────────
// BlockSegmentFeature에 레인 인덱스(_lane)를 추가한 확장 타입
type LanedSegment = BlockSegmentFeature & { _lane: number };

// 집합 밴드 렌더링용 데이터 (노선+선로 그룹당 1개)
interface BandData {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  track: string;
  routeTrackCount: number;
  maxLane: number;
  worstDangerLevel: string | null;
}

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
  /**
   * 강조할 차단명령 ID 집합 — 같은 doc_no(사업 건별) 묶음
   * null이면 모든 세그먼트 정상 표시, 비어 있지 않으면 포함된 것만 밝게, 나머지는 흐리게
   */
  highlightedBlockIds?: Set<number> | null;
  /** 차단구간 클릭 시 호출 — id 전달 */
  onBlockSegmentClick?: (id: number) => void;
  /** 선 두께 포화 배율 — 이 k 이상에서 stroke 화면 픽셀 고정 (기본 5) */
  strokeCapZoom?: number;
}

// ── 색상 정의 ──────────────────────────────────────────────────────────────

/**
 * 노선 선 색상 결정 — settingsStore 값 사용 (새로고침 후 반영)
 * 직접 호출 시 colors 파라미터를 전달, zoom handler에서는 routeColorsRef.current 전달
 */
function computedRouteStroke(
  lineType: string,
  hasCatenary: boolean,
  colors = { highway: '#dc2626', electrified: '#f97316', nonElectrified: '#9ca3af' },
): string {
  if (lineType === '고속선') return colors.highway;
  return hasCatenary ? colors.electrified : colors.nonElectrified;
}

// ── SVG 월드 단위 선로 렌더링 유틸 ───────────────────────────────────────────
//
// D3 geoMercator scale=12180 (Korea 기준):
//   1 SVG unit ≈ 418m
//   zoom transform 이 모든 요소를 균일하게 스케일링하므로
//   SVG 단위로 표현하면 non-scaling-stroke / 수동 /k 변환 없이 자동 일관성 달성
//
// 도출 근거 (실측):
//   TRACK_HALF_GAP_SVG=1.0 → k=1.5에서 3px, k=3에서 6px, k=5에서 10px
//   → 차단정보 시인성 확보 줌(k≥3)에서 선로 분리가 명확하고,
//     전국 조망(k≤1)에서는 자연스럽게 보이지 않아 지도가 산만하지 않음

/** SVG 월드 단위 상수 — 모든 railway 레이어가 이 값 기준으로 스케일 */
const TRACK_HALF_GAP_SVG  = 1.0;   // 선로 반간격 (복선: 상선=−1.0, 하선=+1.0)
const ROUTE_STROKE_SVG    = 0.4;   // 노선 중심선 두께
const BLOCK_STROKE_SVG    = ROUTE_STROKE_SVG * 2;  // 선로차단 선 두께 = 노선의 2배 (0.8)
const CATENARY_STROKE_SVG = 1.0;   // 전차선단전 선 두께
const LANE_GAP_SVG        = 0.3;   // 병행 레인 간격
const DANGER_ZONE_SVG     = 8.0;   // 위험지구 시각 폭
const PROTECT_ZONE_SVG    = 16.0;  // 보호지구 시각 폭
const ORG_BOUNDARY_SVG    = 3.0;   // 관할구간 선 두께

/**
 * Soft cap: k≤capZoom까지는 SVG 단위로 자연 스케일,
 * k>capZoom 이후에는 화면 픽셀이 svgVal×capZoom 으로 고정.
 * capZoom은 시스템 설정(map_settings.stroke_cap_zoom)에서 읽어온 값.
 *
 * 예) ROUTE_STROKE_SVG=0.4, capZoom=5:
 *   k=3  → 0.4 SVG → 1.2px screen (자연 성장)
 *   k=5  → 0.4 SVG → 2.0px screen (cap 도달)
 *   k=20 → 0.1 SVG → 2.0px screen (고정)
 */
function capStrokeSvg(svgVal: number, k: number, capZoom: number): number {
  return svgVal * Math.min(1, capZoom / k);
}

/**
 * 선로 오프셋 목록 (SVG 단위, zoom 무관).
 * D3 zoom transform이 자동 스케일링 → LOD 코드 불필요.
 *
 * 단선(1):  [0]
 * 복선(2):  [−1.0, +1.0]
 * 2복선(4): [−3.0, −1.0, +1.0, +3.0]
 * 3복선(6): [−5.0, −3.0, −1.0, +1.0, +3.0, +5.0]
 */
function trackOffsetsSvg(trackCount: number): number[] {
  const h = TRACK_HALF_GAP_SVG;
  const n = [1, 2, 4, 6].includes(trackCount) ? trackCount : 2;
  if (n === 1) return [0];
  const spacing = h * 2;
  const start   = -(n - 1) * h;
  return Array.from({ length: n }, (_, i) => start + i * spacing);
}

/**
 * 좌표 배열(GeoJSON 3D: [lon, lat, kp])을 KP 경계로 분할.
 * segments = [{coords, track_count, has_catenary}, ...]
 */
/**
 * GeoJSON 3D 좌표 배열을 KP 경계로 분할하여 각 구간의 선로수·전차선 유무를 결정.
 *
 * 핵심 수정: has_catenary 의 기본값을 true 로 하드코딩하지 않고
 * defaultHasCatenary (rail_routes.default_has_catenary) 를 사용한다.
 * → 비전철 노선이 zoom 배율에 따라 주황↔회색으로 깜빡이는 버그 수정.
 */
function splitByTrackSections(
  coords: [number, number, number][],
  defaultTrackCount: number,
  defaultHasCatenary: boolean,   // rail_routes.default_has_catenary
  trackSections: { start_kp: number; end_kp: number; track_count: number; has_catenary: boolean }[],
): { coords: [number, number, number][]; track_count: number; has_catenary: boolean }[] {
  if (coords.length < 2 || trackSections.length === 0) {
    // 예외 구간 없음 → 노선 기본값 그대로 반환
    return [{ coords, track_count: defaultTrackCount, has_catenary: defaultHasCatenary }];
  }

  // KP 경계를 모아서 정렬
  const boundaries = new Set<number>();
  for (const s of trackSections) {
    boundaries.add(s.start_kp);
    boundaries.add(s.end_kp);
  }
  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

  // coords를 KP 경계로 분할
  const segments: { coords: [number, number, number][]; track_count: number; has_catenary: boolean }[] = [];

  function getSectionAt(kp: number) {
    const sec = trackSections.find(s => s.start_kp <= kp && kp < s.end_kp);
    // 해당 KP에 예외 구간이 없으면 노선 기본값 사용 (true 하드코딩 제거)
    return sec
      ? { track_count: sec.track_count,     has_catenary: sec.has_catenary }
      : { track_count: defaultTrackCount,   has_catenary: defaultHasCatenary };
  }

  // 경계가 없거나 좌표 KP 범위 내에 경계 없으면 단일 세그먼트
  const kpMin = coords[0][2];
  const kpMax = coords[coords.length - 1][2];
  const relevantBoundaries = sortedBoundaries.filter(b => b > kpMin && b < kpMax);

  if (relevantBoundaries.length === 0) {
    const sec = getSectionAt(kpMin + (kpMax - kpMin) / 2);
    return [{ coords, ...sec }];
  }

  // 경계별로 분할
  let current: [number, number, number][] = [];
  for (const pt of coords) {
    const kp = pt[2];
    for (const boundary of relevantBoundaries) {
      if (current.length > 0 && current[current.length - 1][2] < boundary && kp >= boundary) {
        current.push(pt);
        const sec = getSectionAt(current[0][2]);
        segments.push({ coords: [...current], ...sec });
        current = [pt];
        break;
      }
    }
    if (current.length === 0 || current[current.length - 1] !== pt) {
      current.push(pt);
    }
  }
  if (current.length >= 2) {
    const sec = getSectionAt(current[0][2]);
    segments.push({ coords: current, ...sec });
  }

  return segments.length > 0
    ? segments
    : [{ coords, track_count: defaultTrackCount, has_catenary: defaultHasCatenary }];
}

/**
 * 단일 좌표 배열로 평행 선로 오프셋 경로를 생성.
 * trackOffsetPx: 중심에서의 물리 픽셀 거리 (음수=UP측, 양수=DOWN측)
 */
/**
 * 터널·교량 심볼 SVG 경로 생성.
 *
 * bore_type에 따른 중심 오프셋:
 *   '복선'     → 중심선(0) — 상·하선 모두 포함하는 하나의 심볼
 *   '단선_상선' → UP 선로 위치(-trackHalfGapPx)
 *   '단선_하선' → DOWN 선로 위치(+trackHalfGapPx)
 *
 * station_type에 따른 형태:
 *   '터널'           → 닫힌 사각 윤곽선 □ (채움 없음)
 *   '교량'/'과선교'  → 양 끝 브래킷만 ]  [
 */
function buildTBSymbol(
  coords2D: [number, number][],
  boreType: string,       // 복선 | 단선_상선 | 단선_하선
  stationType: string,    // 터널 | 교량 | 과선교
  projection: d3.GeoProjection,
): string {
  const pts = coords2D
    .map(([lon, lat]) => projection([lon, lat]))
    .filter((p): p is [number, number] => p !== null);
  if (pts.length < 2) return '';

  const start = pts[0];
  const end   = pts[pts.length - 1];

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len < 1e-6) return '';
  const ndx = dx / len;
  const ndy = dy / len;
  const nx = -ndy;
  const ny =  ndx;

  // bore_type에 따른 심볼 중심 오프셋 (SVG 단위)
  let co = 0;
  if (boreType === '단선_상선') co = -TRACK_HALF_GAP_SVG;
  if (boreType === '단선_하선') co = +TRACK_HALF_GAP_SVG;

  // 심볼 폭 (절반, SVG 단위) — 복선: 양쪽 선로 포함, 단선: 선로 하나 + 여유
  const hw = boreType === '복선'
    ? (TRACK_HALF_GAP_SVG + ROUTE_STROKE_SVG / 2 + 0.5)
    : (ROUTE_STROKE_SVG / 2 + 0.8);

  // 심볼 중심 시작·종료점
  const cs: [number, number] = [start[0] + co * nx, start[1] + co * ny];
  const ce: [number, number] = [end[0]   + co * nx, end[1]   + co * ny];

  // 4 모서리 (TOP = UP 방향, BOTTOM = DOWN 방향)
  const c1: [number, number] = [cs[0] + hw * nx, cs[1] + hw * ny]; // start-top
  const c2: [number, number] = [cs[0] - hw * nx, cs[1] - hw * ny]; // start-bottom
  const c3: [number, number] = [ce[0] - hw * nx, ce[1] - hw * ny]; // end-bottom
  const c4: [number, number] = [ce[0] + hw * nx, ce[1] + hw * ny]; // end-top

  const isBridge = stationType === '교량' || stationType === '과선교';

  if (isBridge) {
    // 교량: ] [ 모양 — 양 끝에 수직선 + 안쪽으로 꺾이는 갈고리(cap)
    // 갈고리 길이 = 브래킷 높이의 50%
    const capLen = hw * 0.5;
    const fwdCX = ndx * capLen;
    const fwdCY = ndy * capLen;

    // 시작 브래킷 ] : 갈고리가 바깥쪽(시작 방향 = 뒤쪽)으로 꺾임
    //   ─┐  cap이 왼쪽(뒤쪽)으로 뻗음 → ] 모양
    //    │
    //   ─┘
    const st = [c1[0] - fwdCX, c1[1] - fwdCY];  // top cap 끝 (바깥쪽)
    const sb = [c2[0] - fwdCX, c2[1] - fwdCY];  // bottom cap 끝 (바깥쪽)
    const startBracket = `M${st[0]},${st[1]} L${c1[0]},${c1[1]} L${c2[0]},${c2[1]} L${sb[0]},${sb[1]}`;

    // 끝 브래킷 [ : 갈고리가 바깥쪽(끝 방향 = 앞쪽)으로 꺾임
    //   ┌─  cap이 오른쪽(앞쪽)으로 뻗음 → [ 모양
    //   │
    //   └─
    const et = [c4[0] + fwdCX, c4[1] + fwdCY];  // top cap 끝 (바깥쪽)
    const eb = [c3[0] + fwdCX, c3[1] + fwdCY];  // bottom cap 끝 (바깥쪽)
    const endBracket = `M${et[0]},${et[1]} L${c4[0]},${c4[1]} L${c3[0]},${c3[1]} L${eb[0]},${eb[1]}`;

    return `${startBracket} ${endBracket}`;
  } else {
    // 터널: 닫힌 사각 윤곽선 (채움 없음)
    return `M${c1[0]},${c1[1]} L${c4[0]},${c4[1]} L${c3[0]},${c3[1]} L${c2[0]},${c2[1]} Z`;
  }
}

/** 선로 오프셋(SVG 단위)이 적용된 track path 생성. */
function buildTrackPath(
  coords: [number, number, number][],
  trackOffsetSvg: number,
  projection: d3.GeoProjection,
): string {
  const pts = coords
    .map(([lon, lat]) => projection([lon, lat]))
    .filter((p): p is [number, number] => p !== null);
  if (pts.length < 2) return '';
  if (trackOffsetSvg === 0) return d3.line()(pts) ?? '';

  const offsetPts: [number, number][] = pts.map((p, i) => {
    let dx: number, dy: number;
    if (i === 0)                   { dx = pts[1][0] - pts[0][0]; dy = pts[1][1] - pts[0][1]; }
    else if (i === pts.length - 1) { dx = pts[i][0] - pts[i-1][0]; dy = pts[i][1] - pts[i-1][1]; }
    else                           { dx = pts[i+1][0] - pts[i-1][0]; dy = pts[i+1][1] - pts[i-1][1]; }
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 1e-6) return p;
    const nx = -dy / len;
    const ny =  dx / len;
    return [p[0] + trackOffsetSvg * nx, p[1] + trackOffsetSvg * ny] as [number, number];
  });
  return d3.line()(offsetPts) ?? '';
}

const FIELD_COLORS: Record<string, string> = {
  all: '#2563eb',
  시설: '#7c3aed',
  전기: '#d97706',
  건축: '#dc2626',
};

/**
 * 시설물 색상 결정 — settingsStore 색상 사용 (새로고침 후 반영)
 * fc: facilityColorsRef.current 전달
 */
function facilityColor(
  type: string,
  stationType: string | null,
  fc = {
    stationMaster: '#1d4ed8', stationGeneral: '#3b82f6', stationUnmanned: '#60a5fa',
    signalYard: '#818cf8', signalPost: '#a78bfa',
    substation: '#7c3aed', elecRoom: '#0284c7', commRoom: '#16a34a', signalRoom: '#b45309',
    tunnelBridge: '#6b7280', crossing: '#f59e0b', junction: '#059669',
  },
): string {
  if (type === '역') {
    switch (stationType) {
      case '관리역': return fc.stationMaster;
      case '보통역': return fc.stationGeneral;
      case '무인역': return fc.stationUnmanned;
      case '신호장': return fc.signalYard;
      case '신호소': return fc.signalPost;
      default:       return fc.stationGeneral;
    }
  }
  if (type === '변전소') {
    switch (stationType) {
      case '전기실':     return fc.elecRoom;
      case '통신실':     return fc.commRoom;
      case '신호기계실': return fc.signalRoom;
      default:           return fc.substation;
    }
  }
  if (type === '구조물') {
    switch (stationType) {
      case '터널':   return fc.tunnelBridge;
      case '교량':   return fc.tunnelBridge;
      case '과선교': return fc.tunnelBridge;
      case '건널목': return fc.crossing;
      case '분기':   return fc.junction;
      default:       return fc.tunnelBridge;
    }
  }
  return '#9ca3af';
}

// 방향별 색상 제거 — 방향은 복선 평행선 위치(좌=상선, 우=하선)로만 구분
// 아래 상수는 컴포넌트 내 파생값(TRACK_BLOCK_COLOR_S 등)으로 대체됨

const SIDO_FILLS: Record<string, string> = {
  '11': 'rgba(248,113,113,0.15)', '26': 'rgba(96,165,250,0.15)',
  '27': 'rgba(167,139,250,0.15)', '28': 'rgba(52,211,153,0.15)',
  '29': 'rgba(251,191,36,0.15)',  '30': 'rgba(251,191,36,0.15)',
  '31': 'rgba(167,139,250,0.15)', '36': 'rgba(248,113,113,0.15)',
  '41': 'rgba(251,191,36,0.15)',  '43': 'rgba(96,165,250,0.15)',
  '44': 'rgba(52,211,153,0.15)',  '46': 'rgba(96,165,250,0.15)',
  '47': 'rgba(52,211,153,0.15)',  '48': 'rgba(248,113,113,0.15)',
  '50': 'rgba(96,165,250,0.15)',  '51': 'rgba(248,113,113,0.15)',
  '52': 'rgba(167,139,250,0.15)',
};

interface FacilityPopup { x: number; y: number; name: string; type: string; info: string; }

function svgPolylineMidpoint(pts: [number, number][]): [number, number] | null {
  if (pts.length === 0) return null;
  if (pts.length === 1) return pts[0];
  let total = 0;
  const dists: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0]-pts[i-1][0], dy = pts[i][1]-pts[i-1][1];
    total += Math.sqrt(dx*dx+dy*dy);
    dists.push(total);
  }
  const half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    if (dists[i] >= half) {
      const t = (half-dists[i-1])/(dists[i]-dists[i-1]);
      return [pts[i-1][0]+t*(pts[i][0]-pts[i-1][0]), pts[i-1][1]+t*(pts[i][1]-pts[i-1][1])];
    }
  }
  return pts[pts.length-1];
}

function segmentMidpoint(coords: [number,number][], projection: d3.GeoProjection): [number,number] | null {
  const pts = coords.map(([lon,lat]) => projection([lon,lat])).filter((p): p is [number,number] => p !== null);
  if (pts.length === 0) return null;
  if (pts.length === 1) return pts[0];
  let total = 0;
  const dists: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx=pts[i][0]-pts[i-1][0], dy=pts[i][1]-pts[i-1][1];
    total += Math.sqrt(dx*dx+dy*dy);
    dists.push(total);
  }
  const half = total/2;
  for (let i = 1; i < pts.length; i++) {
    if (dists[i] >= half) {
      const t=(half-dists[i-1])/(dists[i]-dists[i-1]);
      return [pts[i-1][0]+t*(pts[i][0]-pts[i-1][0]), pts[i-1][1]+t*(pts[i][1]-pts[i-1][1])];
    }
  }
  return pts[pts.length-1];
}

/**
 * 선로 오프셋이 적용된 SVG path 문자열 생성 (zoom 무관 SVG 단위).
 *
 * coords: GeoJSON 좌표 배열 [lon, lat].
 *   백엔드가 법선 방향 계산을 위해 블록 KP 범위 밖 맥락 앵커(앞·뒤 1개씩)를
 *   포함해서 반환하므로, 렌더링은 coords[1]~coords[n-2] 구간만 사용한다.
 *   맥락 앵커가 없을 때(2점 이하)는 전체를 사용한다.
 */
function buildOffsetPath(coords:[number,number][], track:string, routeTrackCount:number, projection:d3.GeoProjection, laneIndex=0, blockType=''): string {
  const pts = coords.map(([lon,lat]) => projection([lon,lat])).filter((p): p is [number,number] => p !== null);
  if (pts.length < 2) return '';
  const svgOff = blockSegmentOffsetSvg(track, routeTrackCount, laneIndex, blockType);

  // 법선 방향은 전체 pts(맥락 포함)로 계산, 렌더링은 실제 블록 범위만
  const offsetPts: [number,number][] = pts.map((p,i) => {
    let dx: number, dy: number;
    if (i===0){dx=pts[1][0]-pts[0][0];dy=pts[1][1]-pts[0][1];}
    else if (i===pts.length-1){dx=pts[i][0]-pts[i-1][0];dy=pts[i][1]-pts[i-1][1];}
    else{dx=pts[i+1][0]-pts[i-1][0];dy=pts[i+1][1]-pts[i-1][1];}
    const len=Math.sqrt(dx*dx+dy*dy);
    if (len<1e-6) return p;
    const nx=-dy/len, ny=dx/len;
    return [p[0]+svgOff*nx, p[1]+svgOff*ny] as [number,number];
  });

  // 맥락 앵커 제거: 앞뒤 1점씩 제외 (원본 coords가 3점 이상일 때만)
  const renderPts = pts.length >= 4
    ? offsetPts.slice(1, offsetPts.length - 1)
    : offsetPts;

  return d3.line()(renderPts) ?? '';
}

// 전차선단전 여부 판별
const CATENARY_BLOCK_TYPES = new Set(['전차선단전']);

/**
 * 선로 이름 → 해당 선로의 UP 방향 여부.
 */
function isUpTrack(trackName: string): boolean {
  return trackName === '상선' || trackName.startsWith('상');
}

/**
 * 선로 이름 → trackOffsetsPx 배열 내 인덱스.
 * 복선(2):   상선=0, 하선=1
 * 2복선(4):  상1=0, 상2=1, 하1=2, 하2=3
 * 3복선(6):  상1=0, 상2=1, 상3=2, 하1=3, 하2=4, 하3=5
 * 단선(1):   상선=0
 */
function trackNameToIndex(trackName: string, trackCount: number): number {
  if (trackCount === 1) return 0;
  if (trackCount === 2) {
    if (trackName === '상선') return 0;
    if (trackName === '하선') return 1;
    return isUpTrack(trackName) ? 0 : 1;
  }
  if (trackCount === 4) {
    const map: Record<string, number> = { '상1': 0, '상2': 1, '하1': 2, '하2': 3 };
    return map[trackName] ?? (isUpTrack(trackName) ? 0 : 2);
  }
  if (trackCount === 6) {
    const map: Record<string, number> = { '상1': 0, '상2': 1, '상3': 2, '하1': 3, '하2': 4, '하3': 5 };
    return map[trackName] ?? (isUpTrack(trackName) ? 0 : 3);
  }
  return isUpTrack(trackName) ? 0 : 1;
}

/**
 * 선로차단 레인 중심의 SVG 단위 오프셋 (zoom 무관 — D3 transform이 스케일링).
 *
 * track: 선로 이름 (상선/하선/상1/상2/상3/하1/하2/하3)
 * routeTrackCount: 해당 노선의 선로 수 (1/2/4/6)
 * laneIndex: 동일 선로 위 병행 차단 레인 번호 (0=선로 위, 1+=바깥쪽 누적)
 * blockType: block_type — 작업구간설정/보호지구작업은 최외방에서 추가 이격
 */
function blockSegmentOffsetSvg(
  track: string,
  routeTrackCount: number,
  laneIndex: number,
  blockType = '',
): number {
  const offsets = trackOffsetsSvg(routeTrackCount);
  const isUp = isUpTrack(track);

  // 최외방 선로 SVG 오프셋
  const outerOffsets = trackOffsetsSvg(routeTrackCount);
  const outerPhysical = isUp
    ? outerOffsets[0]                        // 상선 계열: 가장 음수 (위쪽)
    : outerOffsets[outerOffsets.length - 1]; // 하선 계열: 가장 양수 (아래쪽)

  const idx = trackNameToIndex(track, routeTrackCount);
  const physicalSvg = offsets[idx] ?? (isUp ? -TRACK_HALF_GAP_SVG : TRACK_HALF_GAP_SVG);
  const parallelSvg = laneIndex * (BLOCK_STROKE_SVG + LANE_GAP_SVG);

  // 이격 표시: 최외방 선로에서 추가 오프셋
  if (blockType === '작업구간설정') {
    // 차단 없는 인력/기계: 최외방에서 0.5×gap 외방
    const extraOff = TRACK_HALF_GAP_SVG * 0.5;
    return outerPhysical + (isUp ? -extraOff : extraOff);
  }
  if (blockType === '보호지구작업') {
    // 보호지구: 최외방에서 1.0×gap 외방 (사각형 중심)
    const extraOff = TRACK_HALF_GAP_SVG * 1.0;
    return outerPhysical + (isUp ? -extraOff : extraOff);
  }

  return physicalSvg + (isUp ? -parallelSvg : parallelSvg);
}

/** 차단 종류 → 선 스타일 (대시 패턴·투명도·상대 두께) */
/**
 * 차단구간 선 스타일 결정.
 * work_type이 있으면 work_type을 우선 적용:
 *   인력: 실선 (얇음)     — 밀차 등 인력·공기구류
 *   장비: 굵은 실선       — 보선장비·전철장비 등 철도차량
 *   기계: 굵은 점선       — 건설기계관리법 상 건설기계
 * work_type이 없으면 block_type 기반 fallback.
 */
function blockLineStyle(blockType: string, workType?: string | null): {
  dashArray: string | null;
  opacity: number;
  widthScale: number;
} {
  // 선로차단 계열: 작업형태 구분 없이 통일 두께 (BLOCK_STROKE_SVG = 노선의 2배)
  // work_type은 향후 장비 투입 표시 구분에 활용 예정
  if (blockType === '선로차단') {
    return { dashArray: null, opacity: 0.92, widthScale: 1.0 };
  }

  // 차단 없는 인력/기계 이격 표시 (작업구간설정) — 노선 외방 0.5×gap에 실선
  if (blockType === '작업구간설정') {
    return { dashArray: null, opacity: 0.80, widthScale: 1.0 };
  }

  // 속도 제한 계열
  if (blockType === '임시완속' || blockType === '속도제한') {
    return { dashArray: '10 4', opacity: 0.70, widthScale: 0.8 };
  }

  // 보호지구작업 — 사각형+해칭으로 별도 레이어에서 처리, 여기선 fallback
  if (blockType === '보호지구작업') {
    return { dashArray: null, opacity: 0.85, widthScale: 1.0 };
  }

  return { dashArray: null, opacity: 0.75, widthScale: 0.8 };
}

/** 분야 → 레인 우선순위 (낮을수록 노선에 가까운 레인) */
const FIELD_LANE_PRIORITY: Record<string, number> = { '시설': 0, '전기': 1, '건축': 2 };

/**
 * 레인 인덱스 배정.
 * (rail_route_id OR route_name, direction) 그룹 내에서
 * 분야 우선순위 → block_order.id 순으로 정렬하여 순번을 레인 인덱스로 사용.
 */
/**
 * KP 범위 겹침 여부 판단.
 * 두 블록이 실제로 지도 위에서 겹치는지 확인 → 겹칠 때만 다른 레인으로 분리.
 */
function kpOverlaps(a: BlockSegmentFeature, b: BlockSegmentFeature): boolean {
  const aS = a.properties.start_kp ?? a.properties.start_km ?? -Infinity;
  const aE = a.properties.end_kp   ?? a.properties.end_km   ?? Infinity;
  const bS = b.properties.start_kp ?? b.properties.start_km ?? -Infinity;
  const bE = b.properties.end_kp   ?? b.properties.end_km   ?? Infinity;
  return aS < bE && bS < aE;
}

function assignLanes(features: BlockSegmentFeature[]): LanedSegment[] {
  const groups = new Map<string, BlockSegmentFeature[]>();
  for (const f of features) {
    const key = `${f.properties.rail_route_id ?? f.properties.route_name}|${f.properties.track}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  const result: LanedSegment[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const pa = FIELD_LANE_PRIORITY[a.properties.field] ?? 9;
      const pb = FIELD_LANE_PRIORITY[b.properties.field] ?? 9;
      return pa !== pb ? pa - pb : a.properties.id - b.properties.id;
    });
    // KP가 겹치는 블록끼리만 레인을 쌓는다.
    // 겹치지 않는 블록은 항상 lane=0 (선로 위에 직접 표시).
    group.forEach((f) => {
      // 이미 배정된 블록 중 f와 KP가 겹치는 것들의 레인 번호 집합
      const usedLanes = new Set<number>();
      for (const existing of result) {
        const sameGroup =
          (existing.properties.rail_route_id ?? existing.properties.route_name) ===
          (f.properties.rail_route_id ?? f.properties.route_name) &&
          existing.properties.track === f.properties.track;
        if (sameGroup && kpOverlaps(existing, f)) {
          usedLanes.add(existing._lane);
        }
      }
      // 가장 작은 미사용 레인 번호 배정
      let lane = 0;
      while (usedLanes.has(lane)) lane++;
      result.push({ ...f, _lane: lane });
    });
  }
  return result;
}

/**
 * 집합 밴드 데이터 생성.
 * 각 (노선, 선로) 그룹에서 대표 geometry + maxLane + 최고 위험등급을 추출.
 * 단일 레인 그룹은 밴드 불필요 → 제외.
 */
function buildBandData(lanedSegs: LanedSegment[]): BandData[] {
  const DANGER_PRI: Record<string, number> = { A: 3, B: 2, C: 1 };
  const groups = new Map<string, LanedSegment[]>();
  for (const ls of lanedSegs) {
    const key = `${ls.properties.rail_route_id ?? ls.properties.route_name}|${ls.properties.track}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ls);
  }
  const bands: BandData[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const maxLane = Math.max(...group.map(g => g._lane));
    let worst: string | null = null;
    let worstPri = 0;
    for (const g of group) {
      const pri = DANGER_PRI[g.properties.danger_level ?? ''] ?? 0;
      if (pri > worstPri) { worstPri = pri; worst = g.properties.danger_level; }
    }
    const rep = group.find(g => g._lane === maxLane)!;
    bands.push({
      geometry: rep.geometry,
      track: rep.properties.track,
      routeTrackCount: rep.properties.route_track_count,
      maxLane,
      worstDangerLevel: worst,
    });
  }
  return bands;
}

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
  highlightedBlockIds = null,
  onBlockSegmentClick,
  strokeCapZoom: strokeCapZoomProp,
}: Props) {
  // ── 시스템 설정 색상 (새로고침 후 적용) ─────────────────────────────────────
  const { routeColors, blockColors, dangerColors, facilityColors, stationPointsMode, strokeCapZoom: strokeCapZoomStore } = useSettingsStore();
  // prop 우선, 없으면 store 값 사용
  const strokeCapZoom = strokeCapZoomProp ?? strokeCapZoomStore;

  // D3 zoom 핸들러·useEffect에서 최신 색상 참조를 위한 ref
  const routeColorsRef   = useRef(routeColors);
  const blockColorsRef   = useRef(blockColors);
  const dangerColorsRef  = useRef(dangerColors);
  const facilityColorsRef = useRef(facilityColors);
  routeColorsRef.current    = routeColors;
  blockColorsRef.current    = blockColors;
  dangerColorsRef.current   = dangerColors;
  facilityColorsRef.current = facilityColors;

  // 컴포넌트 내 색상 파생값 (D3 useEffect에서 사용)
  const TRACK_BLOCK_COLOR_S  = blockColors.trackBlock;    // 선로차단 노란
  const CATENARY_CUT_COLOR_S = routeColors.catenaryCut;   // 전차선단전 녹색
  const DANGER_MARKER_COLORS_S: Record<string, string> = {
    A: dangerColors.levelA,
    B: dangerColors.levelB,
    C: dangerColors.levelC,
  };
  const DANGER_MARKER_DEFAULT_S = dangerColors.none;
  const LEGEND_COLORS = {
    관리역:     facilityColors.stationMaster,
    보통역:     facilityColors.stationGeneral,
    무인역:     facilityColors.stationUnmanned,
    신호장:     facilityColors.signalYard,
    신호소:     facilityColors.signalPost,
    터널:       facilityColors.tunnelBridge,
    교량:       facilityColors.tunnelBridge,
    건널목:     facilityColors.crossing,
    변전소:     facilityColors.substation,
    분기:       facilityColors.junction,
    전기실:     facilityColors.elecRoom,
    통신실:     facilityColors.commRoom,
    신호기계실: facilityColors.signalRoom,
  };

  const svgRef            = useRef<SVGSVGElement>(null);
  const gRef              = useRef<SVGGElement>(null);
  const zoomRef           = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const projRef           = useRef<d3.GeoProjection | null>(null);
  const scaleRef          = useRef<number>(1);
  const zoomDisplayRef    = useRef<HTMLSpanElement>(null);
  const sigunguDataRef    = useRef<SigungCollection | null>(null);
  // stale-closure 방지 refs — zoom handler에서 최신 상태에 접근
  const facilityFilterRef   = useRef<FacilityFilter | null>(null);
  const filterRouteCodeRef  = useRef<string | null>(null);
  // 줌 변경 시 block-segment 오프셋 재계산에 사용
  const blockSegmentsRef    = useRef<typeof blockSegments>(null);
  const lanedSegmentsRef    = useRef<LanedSegment[]>([]);
  const bandDataRef         = useRef<BandData[]>([]);
  // zoom handler에서 최신 데이터 참조용 (stale closure 방지)
  const allRailGeoRef         = useRef<typeof allRailGeo>(null);
  const hiddenLineTypesRef    = useRef<Set<'고속선' | '일반선'>>(new Set());
  // 노선코드 → 선로수 맵 (터널·교량 각 선로 렌더링에 사용)
  const routeTrackCountMapRef = useRef<Map<string, number>>(new Map());
  // 단선(zoom<1.5) ↔ 복선(zoom≥1.5) 전환 추적 — 경계 통과 시 풀 리빌드 필요
  const prevShowMultiTrackRef  = useRef(false);
  const selectedBlockIdRef     = useRef<number | null>(null);
  const strokeCapZoomRef       = useRef<number>(5);
  selectedBlockIdRef.current   = selectedBlockId ?? null;  // 매 렌더마다 동기화
  strokeCapZoomRef.current     = strokeCapZoom;
  // fly-to 중복 방지: 동일 ID에 대해 blockSegments 갱신 시 재이동하지 않도록 추적
  const lastFlownToRef        = useRef<number | null>(null);
  const [facilityPopup, setFacilityPopup] = useState<FacilityPopup | null>(null);
  const setPopupRef = useRef(setFacilityPopup);

  // 매 렌더마다 refs 동기화 (allRailGeo·hiddenLineTypes는 useQuery 뒤에서 동기화)
  facilityFilterRef.current  = facilityFilter;
  filterRouteCodeRef.current = filterRouteCode;
  hiddenLineTypesRef.current = hiddenLineTypes;

  // ── 데이터 조회 ─────────────────────────────────────────────────────────

  const { data: allRailGeo } = useQuery<RailRouteFeatureCollection>({
    queryKey: ['map-all-rail-geometry', stationPointsMode],
    queryFn: () => fetchAllRailRouteGeometry('high', stationPointsMode),
    staleTime: 0,
  });
  allRailGeoRef.current = allRailGeo ?? null;  // useQuery 이후 동기화

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

  const { data: railFacilitiesData } = useQuery<FacilityCollection>({
    queryKey: ['map-all-rail-facilities'],
    queryFn: fetchAllRailFacilities,
    enabled: facilityFilter != null,
    staleTime: 0,
  });

  // GPS 중복 마커 병합
  const mergedFacilityFeatures = useMemo(() => {
    const all = [
      ...(railStations?.features ?? []),
      ...(railFacilitiesData?.features ?? []),
    ];
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
  }, [railStations, railFacilitiesData]);

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
    g.append('g').attr('class', 'tunnel-bridge');    // 터널·교량: 각 선로 위에 직접 표시 (routes 위)
    g.append('g').attr('class', 'org-boundaries');
    g.append('g').attr('class', 'danger-zones');          // 위험/보호구간
    g.append('g').attr('class', 'catenary-cuts');          // 전차선단전 (녹색, 노선 위)
    g.append('g').attr('class', 'block-bands');            // LOD2: 다중 레인 집합 밴드 (배경)
    g.append('g').attr('class', 'protection-zone-works'); // 보호지구작업 사각형+해칭
    g.append('g').attr('class', 'block-segments');         // 선로차단 (노란, 가장 두꺼움)
    g.append('g').attr('class', 'block-route-badges'); // 줌<1.5: 노선별 집계 배지
    g.append('g').attr('class', 'block-markers');      // 줌≥1.5: 구간 중심점 마커
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
      // 이동 범위 제한: 지도가 컨테이너 외부로 완전히 벗어나지 않도록
      .translateExtent([[-W * 2, -H * 2], [W * 3, H * 3]])
      .on('zoom', ({ transform }) => {
        g.attr('transform', transform.toString());
        scaleRef.current = transform.k;
        _updateFacilityVisibility(transform.k);

        const proj = projRef.current;
        const k = transform.k;

        // 노선 선로 업데이트
        // ┌─ 단선(zoom<1.5) ↔ 복선(zoom≥1.5) 전환 시: path 수가 달라지므로 풀 리빌드
        // └─ 동일 모드 내 줌 변경 시: 'd' 속성만 갱신 (DOM 재생성 없음, 효율적)
        if (proj && allRailGeoRef.current) {
          const showMultiTrack   = k >= 1.5;
          const thresholdCrossed = showMultiTrack !== prevShowMultiTrackRef.current;
          prevShowMultiTrackRef.current = showMultiTrack;

          // trackIndex+trackCount 저장 방식: 줌 변경 시 trackHalfGapPx(k) 재계산으로
          // 오프셋을 갱신할 수 있어 간격이 줌에 따라 동적으로 변한다.
          interface TrackPath {
            routeId: number; routeCode: string; lineType: string;
            hasCatenary: boolean;
            trackIndex: number;   // trackOffsetsPx 배열 내 인덱스
            trackCount: number;   // 해당 구간의 선로 수
            coords: [number, number, number][]; hidden: boolean;
          }

          if (thresholdCrossed || g.selectAll('path.route-computed').empty()) {
            // 경계 통과(단선↔복선) 또는 초기 상태 → path 수 변경 → 풀 리빌드
            const routeLayer = g.select<SVGGElement>('.routes-computed');
            const paths: TrackPath[] = [];
            const hiddenSet = hiddenLineTypesRef.current;
            for (const feat of allRailGeoRef.current.features) {
              const { rail_route_id, korail_route_code, line_type,
                      default_track_count, default_has_catenary, track_sections } = feat.properties;
              const coords = feat.geometry.coordinates;
              const hidden = hiddenSet.has(line_type as '고속선' | '일반선');
              if (!showMultiTrack) {
                // 전국 조망: 단선 1개이지만 rail_track_sections 구간별 전철화 색상은 반영
                // (zoom<1.5에서도 부분 비전철 구간이 회색으로 보이도록)
                const segs = splitByTrackSections(coords, default_track_count, default_has_catenary, track_sections);
                for (const seg of segs) {
                  paths.push({ routeId: rail_route_id, routeCode: korail_route_code,
                               lineType: line_type, hasCatenary: seg.has_catenary,
                               trackIndex: 0, trackCount: 1, coords: seg.coords, hidden });
                }
              } else {
                const segments = splitByTrackSections(coords, default_track_count, default_has_catenary, track_sections);
                for (const seg of segments) {
                  const n = [1,2,4,6].includes(seg.track_count) ? seg.track_count : 2;
                  for (let i = 0; i < n; i++) {
                    paths.push({ routeId: rail_route_id, routeCode: korail_route_code,
                                 lineType: line_type, hasCatenary: seg.has_catenary,
                                 trackIndex: i, trackCount: n, coords: seg.coords, hidden });
                  }
                }
              }
            }
            routeLayer.selectAll('*').remove();
            // SVG 단위: path는 한 번만 빌드, D3 zoom transform이 자동 스케일링
            routeLayer.selectAll<SVGPathElement, TrackPath>('path.route-computed')
              .data(paths).join('path')
              .attr('class', (d) => `route-computed route-computed-${d.routeCode}`)
              .attr('d', (d) => {
                const off = trackOffsetsSvg(d.trackCount)[d.trackIndex] ?? 0;
                return buildTrackPath(d.coords, off, proj);
              })
              .attr('fill', 'none')
              .attr('stroke', (d) => computedRouteStroke(d.lineType, d.hasCatenary, routeColorsRef.current))
              .attr('stroke-width', ROUTE_STROKE_SVG)
              // non-scaling-stroke 제거 — SVG 단위가 zoom과 함께 자연스럽게 스케일
              .attr('display', (d) => d.hidden ? 'none' : null);
          }
          // 동일 모드 유지 시: SVG 단위 오프셋은 zoom 무관 → path 재계산 불필요
        }

        // SVG 단위 전환 후: block-segment path/stroke는 zoom 변경 시 재계산 불필요
        // D3 zoom transform이 모든 SVG 요소를 균일하게 스케일링함

        // 마커·배지: 텍스트 레이블이므로 화면 고정 크기 유지 (scale(1/k))
        g.selectAll<SVGGElement, unknown>('g.block-marker')
          .attr('transform', function() {
            const el = this as SVGGElement;
            return `translate(${el.getAttribute('data-mx')},${el.getAttribute('data-my')}) scale(${1 / k})`;
          });
        g.selectAll<SVGGElement, unknown>('g.block-badge')
          .attr('transform', function() {
            const el = this as SVGGElement;
            return `translate(${el.getAttribute('data-bx')},${el.getAttribute('data-by')}) scale(${1 / k})`;
          });
        // ── Stroke soft cap (k≤capZoom: 자연 성장, k>capZoom: 화면픽셀 고정) ─
        const capK = strokeCapZoomRef.current;
        g.selectAll<SVGPathElement, unknown>('path.route-computed')
          .attr('stroke-width', capStrokeSvg(ROUTE_STROKE_SVG, k, capK));
        g.selectAll<SVGPathElement, LanedSegment>('path.block-segment')
          .attr('stroke-width', (d) => {
            const style = blockLineStyle(d.properties.block_type, d.properties.work_type);
            const base  = capStrokeSvg(BLOCK_STROKE_SVG * style.widthScale, k, capK);
            return d.properties.id === selectedBlockIdRef.current ? base * 1.6 : base;
          });
        g.selectAll<SVGPathElement, unknown>('path.catenary-cut')
          .attr('stroke-width', capStrokeSvg(CATENARY_STROKE_SVG, k, capK));
        g.selectAll<SVGPathElement, unknown>('path.org-boundary')
          .attr('stroke-width', capStrokeSvg(ORG_BOUNDARY_SVG, k, capK));
        // 위험/보호지구도 동일한 cap 적용 (누락 시 고줌에서 화면 전체를 덮음)
        g.selectAll<SVGPathElement, unknown>('path.protect-zone')
          .attr('stroke-width', capStrokeSvg(PROTECT_ZONE_SVG, k, capK));
        g.selectAll<SVGPathElement, unknown>('path.danger-zone')
          .attr('stroke-width', capStrokeSvg(DANGER_ZONE_SVG, k, capK));

        // 줌 레벨에 따른 레이어 전환
        // 전국(< 1.5): 집계 배지만 표시, 선·마커·밴드 숨김
        // 지역(≥ 1.5): 선·마커 표시, 집계 배지 숨김
        // 밴드는 1.5~4 구간에서만 표시 (레인이 좁을 때 그룹 경계 명시)
        g.select<SVGGElement>('.block-segments').attr('display', k >= 1.5 ? null : 'none');
        g.select<SVGGElement>('.block-markers').attr('display', k >= 1.5 ? null : 'none');
        g.select<SVGGElement>('.block-route-badges').attr('display', k < 1.5 ? null : 'none');
        g.select<SVGGElement>('.block-bands').attr('display', k >= 1.5 && k < 4 ? null : 'none');

        if (zoomDisplayRef.current) {
          zoomDisplayRef.current.textContent = `×${transform.k.toFixed(1)}`;
        }
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    // wheel 이벤트가 브라우저 페이지 줌/스크롤로 전파되지 않도록 차단
    svgRef.current.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

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

    // 구간 시설물 (터널·교량·과선교) hit area — 클릭 감지용 (투명, 넓게)
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

    // 터널·교량 심볼 — 줌 변경마다 buildTBSymbol()로 경로 재계산
    // (trackHalfGapPx가 줌에 따라 변하므로 심볼 크기가 선로 간격에 맞게 반응)
    g.selectAll<SVGPathElement, FacilityFeature>('path.tb-band').each(function(d) {
      const { type, station_type, route_code } = d.properties;

      if (frc != null && route_code !== frc) { d3.select(this).attr('display', 'none'); return; }

      let typeOk = false;
      if (ff != null && type === '구조물') {
        if      (station_type === '터널')   typeOk = ff.구조물터널;
        else if (station_type === '교량')   typeOk = ff.구조물교량;
        else if (station_type === '과선교') typeOk = ff.구조물과선교;
      }

      const isLinear = type === '구조물' &&
        (station_type === '터널' || station_type === '교량' || station_type === '과선교');

      if (!isLinear || !typeOk || k < ZOOM_SEGMENT || !proj) {
        d3.select(this).attr('display', 'none');
        return;
      }

      const coords = (d.geometry as { type: 'LineString'; coordinates: [number, number][] }).coordinates;
      const bt = d.properties.bore_type ?? '복선';
      const st = station_type ?? '터널';

      d3.select(this)
        .attr('display', null)
        .attr('d', buildTBSymbol(coords, bt, st, proj));
    });

    // 구간 시설물 이름 레이블 — 선과 동일 조건 + 줌 충분 시 표시
    // 터널·교량·과선교 레이블 — zoom 변경마다 위치·크기 재계산
    // (useEffect 실행 시 k가 초기값(~0.5)이라 SVG 단위가 크게 설정되어
    //  zoom 후 물리 픽셀이 과도하게 커지는 문제 방지)
    g.selectAll<SVGTextElement, FacilityFeature>('text.facility-seg-label').each(function(d) {
      const { type, station_type, route_code } = d.properties;
      if (frc != null && route_code !== frc) { d3.select(this).attr('display', 'none'); return; }
      let typeOk = false;
      if (ff != null && type === '구조물') {
        if      (station_type === '터널')   typeOk = ff.구조물터널;
        else if (station_type === '교량')   typeOk = ff.구조물교량;
        else if (station_type === '과선교') typeOk = ff.구조물과선교;
      }
      const isLinear = type === '구조물' &&
        (station_type === '터널' || station_type === '교량' || station_type === '과선교');
      const labelVisible = isLinear && k >= ZOOM_SEGMENT * 1.5 && typeOk;

      if (!labelVisible || !proj) { d3.select(this).attr('display', 'none'); return; }

      // 레이블 위치를 현재 zoom(k) 기준으로 재계산
      const coords2D = (d.geometry as { type: 'LineString'; coordinates: [number, number][] }).coordinates;
      const lpts = coords2D.map(([lon, lat]) => proj([lon, lat])).filter((p): p is [number, number] => p !== null);
      if (lpts.length < 2) { d3.select(this).attr('display', 'none'); return; }

      const lmid = svgPolylineMidpoint(lpts);
      if (!lmid) { d3.select(this).attr('display', 'none'); return; }

      const lMidIdx = Math.floor(lpts.length / 2);
      const lp1 = lpts[Math.max(0, lMidIdx - 1)];
      const lp2 = lpts[Math.min(lpts.length - 1, lMidIdx + 1)];
      const ldx = lp2[0] - lp1[0];
      const ldy = lp2[1] - lp1[1];
      const lLen = Math.sqrt(ldx*ldx + ldy*ldy);

      // 뒤집힘 방지: 각도 정규화
      let lAngle = Math.atan2(ldy, ldx) * 180 / Math.PI;
      if (lAngle > 90 || lAngle < -90) lAngle += 180;

      // 법선 방향 (트랙에 수직)
      const lnx = lLen > 0 ? -ldy / lLen : 0;
      const lny = lLen > 0 ?  ldx / lLen : -1;
      // ny > 0이면 SVG 아래쪽 → 반전하여 항상 화면 위쪽으로
      const lSign = lny < 0 ? 1 : -1;

      // 심볼 폭 + 3px 여백 (현재 zoom k 기준)
      const lbt = d.properties.bore_type ?? '복선';
      const lhw = lbt === '복선'
        ? (TRACK_HALF_GAP_SVG + ROUTE_STROKE_SVG / 2 + 0.5)
        : (ROUTE_STROKE_SVG / 2 + 0.8);
      const lOff = lhw + 0.8;  // SVG 단위 오프셋 (zoom과 함께 스케일)

      const llx = lmid[0] + lSign * lnx * lOff;
      const lly = lmid[1] + lSign * lny * lOff;

      d3.select(this)
        .attr('display', null)
        .attr('x', llx)
        .attr('y', lly)
        .attr('transform', `rotate(${lAngle},${llx},${lly})`)
        .attr('font-size', `${10 / k}px`)
        .attr('dy', '0');
    });

    // Point 시설물 이름 레이블 (변전소·건널목·분기) — ZOOM_DETAIL 이상
    // 이 텍스트는 g.facility-point-item[scale(1/k)] 안에 있어 zoom이 상쇄됨
    // → font-size는 물리 픽셀 값 그대로 사용 (k로 나누면 2중 보정으로 더 작아짐)
    g.selectAll<SVGTextElement, FacilityFeature>('text.facility-point-label').each(function(d) {
      const { type, station_type, route_code } = d.properties;
      if (frc != null && route_code !== frc) { d3.select(this).attr('display', 'none'); return; }
      let typeOk = false;
      if (ff != null) {
        if (type === '변전소') typeOk = ff.전기변전소 || ff.전기전기실 || ff.전기통신실 || ff.전기신호기계실;
        else if (type === '구조물' && station_type === '건널목') typeOk = ff.구조물건널목;
        else if (type === '구조물' && station_type === '분기')   typeOk = ff.구조물분기;
      }
      d3.select(this).attr('display', k >= ZOOM_DETAIL && typeOk ? null : 'none')
        .attr('font-size', '11px');  // scale(1/k) 그룹 내부 → 11px = 11px 물리
    });
  }

  // hiddenLineTypes 변경은 노선 렌더링 useEffect deps에 포함되어 자동 처리됨

  // ── facilityFilter / filterRouteCode 변경 → 가시성 재계산 ───────────────
  useEffect(() => {
    _updateFacilityVisibility(scaleRef.current);
  }, [facilityFilter, filterRouteCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── rail_computed_geometry 노선 렌더링 — 선로 수(track_count) 기반 복선 표현 ──
  useEffect(() => {
    if (!gRef.current || !projRef.current || !allRailGeo || allRailGeo.features.length === 0) return;
    const g     = d3.select(gRef.current);
    const layer = g.select<SVGGElement>('.routes-computed');
    if (layer.empty()) return;
    const proj = projRef.current;
    const k    = scaleRef.current;

    layer.selectAll('*').remove();

    // 각 노선을 KP 구간별로 분할 → 구간마다 선로 수에 따라 평행 path 생성
    // 전국 조망(zoom<1.5): 단일 중심선만 표시
    // 지역 이상(zoom≥1.5): 선로 수에 따라 평행선 표시
    const showMultiTrack = k >= 1.5;

    interface TrackPath {
      routeId: number;
      routeCode: string;
      lineType: string;
      hasCatenary: boolean;
      trackIndex: number;   // trackOffsetsPx 배열 내 인덱스
      trackCount: number;   // 해당 구간의 선로 수
      coords: [number, number, number][];
      hidden: boolean;
    }

    const paths: TrackPath[] = [];

    for (const feat of allRailGeo.features) {
      const { rail_route_id, korail_route_code, line_type,
              default_track_count, default_has_catenary, track_sections } = feat.properties;
      const coords = feat.geometry.coordinates;
      const hidden = hiddenLineTypes.has(line_type as '고속선' | '일반선');

      if (!showMultiTrack) {
        // 전국 조망: 단선이지만 구간별 전철화 색상은 반영
        const segs = splitByTrackSections(coords, default_track_count, default_has_catenary, track_sections);
        for (const seg of segs) {
          paths.push({ routeId: rail_route_id, routeCode: korail_route_code,
                       lineType: line_type, hasCatenary: seg.has_catenary,
                       trackIndex: 0, trackCount: 1, coords: seg.coords, hidden });
        }
      } else {
        const segments = splitByTrackSections(coords, default_track_count, default_has_catenary, track_sections);
        for (const seg of segments) {
          const n = [1,2,4,6].includes(seg.track_count) ? seg.track_count : 2;
          for (let i = 0; i < n; i++) {
            paths.push({ routeId: rail_route_id, routeCode: korail_route_code,
                         lineType: line_type, hasCatenary: seg.has_catenary,
                         trackIndex: i, trackCount: n, coords: seg.coords, hidden });
          }
        }
      }
    }

    layer
      .selectAll<SVGPathElement, TrackPath>('path.route-computed')
      .data(paths)
      .join('path')
      .attr('class', (d) => `route-computed route-computed-${d.routeCode}`)
      .attr('d', (d) => {
        const off = trackOffsetsSvg(d.trackCount)[d.trackIndex] ?? 0;
        return buildTrackPath(d.coords, off, proj);
      })
      .attr('fill', 'none')
      .attr('stroke', (d) => computedRouteStroke(d.lineType, d.hasCatenary, routeColorsRef.current))
      .attr('stroke-width', ROUTE_STROKE_SVG)
      .attr('display', (d) => d.hidden ? 'none' : null);
  }, [allRailGeo, hiddenLineTypes]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const g    = d3.select(gRef.current);
    const capK = strokeCapZoomRef.current;
    const k    = scaleRef.current;
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
      .attr('stroke-width', capStrokeSvg(ORG_BOUNDARY_SVG, k, capK))
      .attr('opacity', 0.7)
      .attr('stroke-linecap', 'butt')
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
    const k    = scaleRef.current;
    const capK = strokeCapZoomRef.current;
    const g    = d3.select(gRef.current);
    const layer = g.select<SVGGElement>('.danger-zones');
    layer.selectAll('*').remove();
    if (!showDangerZone || !blockSegments || blockSegments.features.length === 0) return;

    // 보호지구 — SVG 단위, zoom과 함께 스케일
    layer
      .selectAll<SVGPathElement, BlockSegmentFeature>('path.protect-zone')
      .data(blockSegments.features)
      .join('path')
      .attr('class', 'protect-zone')
      .attr('d', (d) =>
        buildOffsetPath(d.geometry.coordinates as [number, number][], d.properties.track, d.properties.route_track_count, proj)
      )
      .attr('fill', 'none')
      .attr('stroke', TRACK_BLOCK_COLOR_S)
      .attr('stroke-width', capStrokeSvg(PROTECT_ZONE_SVG, k, capK))
      .attr('opacity', 0.10)
      .attr('stroke-linecap', 'butt')
      .style('pointer-events', 'none');

    // 위험지구
    layer
      .selectAll<SVGPathElement, BlockSegmentFeature>('path.danger-zone')
      .data(blockSegments.features)
      .join('path')
      .attr('class', 'danger-zone')
      .attr('d', (d) =>
        buildOffsetPath(d.geometry.coordinates as [number, number][], d.properties.track, d.properties.route_track_count, proj)
      )
      .attr('fill', 'none')
      .attr('stroke', TRACK_BLOCK_COLOR_S)
      .attr('stroke-width', capStrokeSvg(DANGER_ZONE_SVG, k, capK))
      .attr('opacity', 0.25)
      .attr('stroke-linecap', 'butt')
      .style('pointer-events', 'none');
  }, [showDangerZone, blockSegments]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 차단명령 구간 레이어 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!gRef.current || !projRef.current) return;
    const proj = projRef.current;
    const g    = d3.select(gRef.current);
    const k    = scaleRef.current;
    const capK = strokeCapZoomRef.current;
    const bandLayer      = g.select<SVGGElement>('.block-bands');
    const layer          = g.select<SVGGElement>('.block-segments');
    const markerLayer    = g.select<SVGGElement>('.block-markers');
    const badgeLayer     = g.select<SVGGElement>('.block-route-badges');
    const pzLayer        = g.select<SVGGElement>('.protection-zone-works');
    bandLayer.selectAll('*').remove();
    layer.selectAll('*').remove();
    markerLayer.selectAll('*').remove();
    badgeLayer.selectAll('*').remove();
    pzLayer.selectAll('*').remove();

    blockSegmentsRef.current = blockSegments;
    if (!blockSegments || blockSegments.features.length === 0) {
      lanedSegmentsRef.current = [];
      bandDataRef.current = [];
      g.select<SVGGElement>('.catenary-cuts').selectAll('*').remove();
      return;
    }

    // ── 전차선단전 / 보호지구작업 / 선로차단 분리 ─────────────────────────
    const catenaryCutFeats  = blockSegments.features.filter(
      f => CATENARY_BLOCK_TYPES.has(f.properties.block_type)
    );
    const protectionZoneFeats = blockSegments.features.filter(
      f => f.properties.block_type === '보호지구작업'
    );
    const trackBlockFeats = blockSegments.features.filter(
      f => !CATENARY_BLOCK_TYPES.has(f.properties.block_type)
        && f.properties.block_type !== '보호지구작업'
    );

    // 전차선단전: 녹색, 노선 위(오프셋 없음)에 중간 두께로 렌더링
    const catenaryCutLayer = g.select<SVGGElement>('.catenary-cuts');
    catenaryCutLayer.selectAll('*').remove();
    if (catenaryCutFeats.length > 0) {
      // 히트 영역 (넓게 — SVG 단위)
      catenaryCutLayer
        .selectAll<SVGPathElement, BlockSegmentFeature>('path.catenary-cut-hit')
        .data(catenaryCutFeats)
        .join('path')
        .attr('class', 'catenary-cut-hit')
        .attr('d', (d) => {
          const pts = (d.geometry.coordinates as [number, number][])
            .map(([lon, lat]) => proj([lon, lat]))
            .filter((p): p is [number, number] => p !== null);
          return d3.line()(pts) ?? '';
        })
        .attr('fill', 'none').attr('stroke', 'transparent')
        .attr('stroke-width', capStrokeSvg(CATENARY_STROKE_SVG, k, capK) * 8)
        .style('cursor', 'pointer')
        .on('click', (event: MouseEvent, d: BlockSegmentFeature) => {
          event.stopPropagation();
          onBlockSegmentClick?.(d.properties.id);
        });
      // 전차선단전 선 — SVG 단위, non-scaling-stroke 제거
      catenaryCutLayer
        .selectAll<SVGPathElement, BlockSegmentFeature>('path.catenary-cut')
        .data(catenaryCutFeats)
        .join('path')
        .attr('class', 'catenary-cut')
        .attr('d', (d) => {
          const pts = (d.geometry.coordinates as [number, number][])
            .map(([lon, lat]) => proj([lon, lat]))
            .filter((p): p is [number, number] => p !== null);
          return d3.line()(pts) ?? '';
        })
        .attr('fill', 'none')
        .attr('stroke', CATENARY_CUT_COLOR_S)
        .attr('stroke-width', capStrokeSvg(CATENARY_STROKE_SVG, k, capK))
        .attr('opacity', (d) => d.properties.id === selectedBlockId ? 1.0 : 0.85)
        .attr('stroke-linecap', 'butt')
        .style('cursor', 'pointer')
        .on('click', (event: MouseEvent, d: BlockSegmentFeature) => {
          event.stopPropagation();
          onBlockSegmentClick?.(d.properties.id);
        })
        .append('title')
        .text((d) => {
          const p = d.properties;
          return `[전차선단전] ${p.route_name}  ${p.section_note ?? p.display_km}\n${p.work_date} ${p.start_time}~${p.end_time}  ${p.field}`;
        });
    }

    // 선로차단: 노란(앰버), 해당 선로(상/하선) 위에 레인 오프셋으로 렌더링
    const lanedSegs = assignLanes(trackBlockFeats);
    lanedSegmentsRef.current = lanedSegs;
    const bands = buildBandData(lanedSegs);
    bandDataRef.current = bands;

    // ① 투명 히트 영역 — SVG 단위, 클릭하기 충분한 두께
    layer
      .selectAll<SVGPathElement, LanedSegment>('path.block-segment-hit')
      .data(lanedSegs)
      .join('path')
      .attr('class', 'block-segment-hit')
      .attr('d', (d) => buildOffsetPath(d.geometry.coordinates as [number, number][], d.properties.track, d.properties.route_track_count, proj, d._lane, d.properties.block_type))
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', capStrokeSvg(BLOCK_STROKE_SVG, k, capK) * 4)
      .style('cursor', 'pointer')
      .on('click', function(event: MouseEvent, d: LanedSegment) {
        event.stopPropagation();
        onBlockSegmentClick?.(d.properties.id);
      });

    // ② 선로차단 노란(앰버)선 — SVG 단위, non-scaling-stroke 제거
    layer
      .selectAll<SVGPathElement, LanedSegment>('path.block-segment')
      .data(lanedSegs)
      .join('path')
      .attr('class', 'block-segment')
      .attr('d', (d) =>
        buildOffsetPath(d.geometry.coordinates as [number, number][], d.properties.track, d.properties.route_track_count, proj, d._lane, d.properties.block_type)
      )
      .attr('fill', 'none')
      .attr('stroke', TRACK_BLOCK_COLOR_S)
      .attr('stroke-width', (d) => {
        const style = blockLineStyle(d.properties.block_type, d.properties.work_type);
        const base  = capStrokeSvg(BLOCK_STROKE_SVG * style.widthScale, k, capK);
        return d.properties.id === selectedBlockId ? base * 1.6 : base;
      })
      .attr('stroke-dasharray', (d) => {
        const style = blockLineStyle(d.properties.block_type, d.properties.work_type);
        return style.dashArray;
      })
      .attr('opacity', (d) => {
        const style = blockLineStyle(d.properties.block_type, d.properties.work_type);
        const isSelected   = d.properties.id === selectedBlockId;
        const isHighlighted = !highlightedBlockIds || highlightedBlockIds.has(d.properties.id);
        if (isSelected) return 1.0;
        if (!isHighlighted) return style.opacity * 0.25;  // 같은 사업 건 아닌 것 흐리게
        return style.opacity;
      })
      .attr('stroke-linecap', 'butt')
      .style('cursor', 'pointer')
      .on('click', function(event: MouseEvent, d: LanedSegment) {
        event.stopPropagation();
        onBlockSegmentClick?.(d.properties.id);
      })
      .append('title')
      .text((d) => {
        const p = d.properties;
        const loc = p.section_type === 'power_cut'
          ? (p.section_note ?? p.display_km)
          : `${p.display_km}km`;
        const laneInfo = lanedSegs.filter(s => s.properties.id === p.id).length > 1 ? '' : ` [${p.field}]`;
        return `${p.route_name} ${loc} [${p.track}]${laneInfo}\n${p.work_date} ${p.start_time}~${p.end_time}\n${p.field} / ${p.block_type}`;
      });

    // ③ 구간 중심점 마커 ◆ — 레인별로 midpoint 위치가 달라 자연스럽게 분산
    const markers = markerLayer
      .selectAll<SVGGElement, LanedSegment>('g.block-marker')
      .data(lanedSegs)
      .join('g')
      .attr('class', 'block-marker')
      .style('cursor', 'pointer')
      .on('click', function(event: MouseEvent, d: LanedSegment) {
        event.stopPropagation();
        onBlockSegmentClick?.(d.properties.id);
      });

    markers.each(function(d) {
      // 마커 위치: 선로 오프셋에서 0.3×gap 추가 외방으로 이동
      const trackSvgOff   = blockSegmentOffsetSvg(d.properties.track, d.properties.route_track_count, d._lane, d.properties.block_type);
      const isUp          = isUpTrack(d.properties.track);
      const markerExtraOff = TRACK_HALF_GAP_SVG * 1.0 * (isUp ? -1 : 1); // 선로 외방 1배 이격
      const markerSvgOff  = trackSvgOff + markerExtraOff;

      const offsetCoords = (() => {
        const pts = (d.geometry.coordinates as [number, number][])
          .map(([lon, lat]) => proj([lon, lat]))
          .filter((p): p is [number, number] => p !== null);
        if (pts.length < 2) return null;
        return pts.map((p, i) => {
          let dx: number, dy: number;
          if (i === 0)                   { dx = pts[1][0] - pts[0][0]; dy = pts[1][1] - pts[0][1]; }
          else if (i === pts.length - 1) { dx = pts[i][0] - pts[i-1][0]; dy = pts[i][1] - pts[i-1][1]; }
          else                           { dx = pts[i+1][0] - pts[i-1][0]; dy = pts[i+1][1] - pts[i-1][1]; }
          const len = Math.sqrt(dx*dx + dy*dy);
          if (len < 1e-6) return p;
          return [p[0] + markerSvgOff * (-dy/len), p[1] + markerSvgOff * (dx/len)] as [number, number];
        });
      })();
      if (!offsetCoords) return;
      const mid = svgPolylineMidpoint(offsetCoords);
      if (!mid) return;

      const el = d3.select(this);
      el.attr('data-mx', mid[0]).attr('data-my', mid[1])
        .attr('transform', `translate(${mid[0]},${mid[1]}) scale(${1 / k})`);
      const isSelected     = d.properties.id === selectedBlockId;
      const isHighlighted  = !highlightedBlockIds || highlightedBlockIds.has(d.properties.id);
      // 마커 색상: 분야별 (시설=노란, 전기=녹색, 건축=보라)
      const FIELD_MARKER_COLORS: Record<string, string> = {
        '시설': '#ca8a04',   // 노란
        '전기': '#16a34a',   // 녹색
        '건축': '#7c3aed',   // 보라
      };
      const color = FIELD_MARKER_COLORS[d.properties.field] ?? DANGER_MARKER_DEFAULT_S;
      // 크기 2배 (기존 5→10, 7→14)
      const s = isSelected ? 14 : 10;
      el.attr('opacity', isHighlighted ? 1.0 : 0.2);
      el.append('circle').attr('r', s + 5).attr('fill', 'transparent');
      if (isSelected) {
        el.append('polygon')
          .attr('points', `0,${-(s + 4)} ${s + 4},0 0,${s + 4} ${-(s + 4)},0`)
          .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2.5)
          .attr('opacity', 0.55);
      }
      el.append('polygon')
        .attr('points', `0,${-s} ${s},0 0,${s} ${-s},0`)
        .attr('fill', color).attr('stroke', 'white')
        .attr('stroke-width', isSelected ? 2.5 : 1.5);
      // 분야 약자 (시/전/건)
      el.append('text')
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', `${s * 1.1}px`).attr('font-weight', 'bold').attr('fill', 'white')
        .style('pointer-events', 'none')
        .text(d.properties.field.slice(0, 1));
      el.append('title').text(() => {
        const p = d.properties;
        const loc = p.section_type === 'power_cut' ? (p.section_note ?? p.display_km) : `${p.display_km}km`;
        const danger = p.danger_level ? `[${p.danger_level}등급] ` : '';
        return `${danger}${p.route_name}  ${loc} (${p.track})\n${p.start_time}~${p.end_time}  ${p.field} / ${p.block_type}`;
      });
    });

    layer.attr('display', k >= 1.5 ? null : 'none');
    markerLayer.attr('display', k >= 1.5 ? null : 'none');

    // ④ LOD2 집합 밴드 — 병행작업(2개 이상 레인) 그룹에 반투명 배경 밴드
    // zoom 1.5~4에서 레인이 좁아 개별 구분이 어려울 때 그룹 경계를 명시
    bandLayer
      .selectAll<SVGPathElement, BandData>('path.block-band')
      .data(bands)
      .join('path')
      .attr('class', 'block-band')
      .attr('d', (d) =>
        buildOffsetPath(d.geometry.coordinates as [number, number][], d.track, d.routeTrackCount, proj, d.maxLane / 2)
      )
      .attr('fill', 'none')
      .attr('stroke', (d) => DANGER_MARKER_COLORS_S[d.worstDangerLevel ?? ''] ?? DANGER_MARKER_DEFAULT_S)
      .attr('stroke-width', (d) => (d.maxLane + 1) * (capStrokeSvg(BLOCK_STROKE_SVG, k, capK) + LANE_GAP_SVG))
      .attr('opacity', 0.12)
      .attr('stroke-linecap', 'butt')
      .style('pointer-events', 'none');
    bandLayer.attr('display', k >= 1.5 && k < 4 ? null : 'none');

    // ⑤ 보호지구작업 — 사각형 + 45도 사선 해칭
    // SVG <defs>에 해칭 패턴 등록 (이미 있으면 skip)
    const svgSel = d3.select(svgRef.current!);
    if (svgSel.select('defs #pz-hatch').empty()) {
      const defs = svgSel.select<SVGDefsElement>('defs').empty()
        ? svgSel.insert('defs', ':first-child')
        : svgSel.select<SVGDefsElement>('defs');
      const pat = defs.append('pattern')
        .attr('id', 'pz-hatch')
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('patternTransform', `scale(${1 / k})`) // zoom에 맞춰 스케일
        .attr('width', 8).attr('height', 8);
      pat.append('path')
        .attr('d', 'M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4')
        .attr('stroke', TRACK_BLOCK_COLOR_S)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.75);
    } else {
      // 줌 변경 시 패턴 스케일 갱신
      svgSel.select('#pz-hatch').attr('patternTransform', `scale(${1 / k})`);
    }

    if (protectionZoneFeats.length > 0 && k >= 1.5) {
      // 보호지구 사각형 높이 = 2 × TRACK_HALF_GAP (SVG 단위)
      const pzHeight = TRACK_HALF_GAP_SVG * 2;
      pzLayer
        .selectAll<SVGPathElement, BlockSegmentFeature>('path.pz-rect')
        .data(protectionZoneFeats)
        .join('path')
        .attr('class', 'pz-rect')
        .attr('d', (d) => {
          // 중심선 → 오프셋 경로 2개(상단/하단) → 직사각형 생성
          const track = d.properties.track;
          const rtc   = d.properties.route_track_count;
          const centerSvg = blockSegmentOffsetSvg(track, rtc, 0, '보호지구작업');
          const isUp = isUpTrack(track);
          const half = pzHeight / 2;
          const topSvg = centerSvg + (isUp ? -half : half);  // 외방
          const botSvg = centerSvg + (isUp ?  half : -half); // 내방(선로 쪽)

          const makePts = (off: number) => {
            const coords = d.geometry.coordinates as [number, number][];
            return coords.map(([lon, lat]) => {
              const p = proj([lon, lat]);
              if (!p) return null;
              const pts = coords.map(c => proj(c as [number,number])).filter(Boolean) as [number,number][];
              const idx = coords.indexOf([lon,lat]);
              return p;
            }).filter(Boolean) as [number,number][];
          };

          // 좌표 배열 → 오프셋 적용
          const applyOffset = (svgOff: number): [number,number][] => {
            const coords = d.geometry.coordinates as [number, number][];
            const pts = coords.map(c => proj(c as [number,number])).filter((p): p is [number,number] => p !== null);
            return pts.map((p, i) => {
              let dx: number, dy: number;
              if (i===0){ dx=pts[1][0]-pts[0][0]; dy=pts[1][1]-pts[0][1]; }
              else if (i===pts.length-1){ dx=pts[i][0]-pts[i-1][0]; dy=pts[i][1]-pts[i-1][1]; }
              else{ dx=pts[i+1][0]-pts[i-1][0]; dy=pts[i+1][1]-pts[i-1][1]; }
              const len=Math.sqrt(dx*dx+dy*dy);
              if (len<1e-6) return p;
              const nx=-dy/len, ny=dx/len;
              return [p[0]+svgOff*nx, p[1]+svgOff*ny] as [number,number];
            });
          };

          const topPts = applyOffset(topSvg);
          const botPts = applyOffset(botSvg);
          if (topPts.length < 2 || botPts.length < 2) return '';

          // 직사각형: topPts 순방향 + botPts 역방향
          const fwd = topPts.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L ');
          const rev = [...botPts].reverse().map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L ');
          return `M ${fwd} L ${rev} Z`;
        })
        .attr('fill', 'url(#pz-hatch)')
        .attr('stroke', TRACK_BLOCK_COLOR_S)
        .attr('stroke-width', capStrokeSvg(ROUTE_STROKE_SVG, k, capK))
        .attr('stroke-linecap', 'butt')
        .attr('opacity', (d) => d.properties.id === selectedBlockId ? 1.0 : 0.8)
        .style('cursor', 'pointer')
        .on('click', (event: MouseEvent, d: BlockSegmentFeature) => {
          event.stopPropagation();
          onBlockSegmentClick?.(d.properties.id);
        })
        .append('title')
        .text((d) => {
          const p = d.properties;
          return `[보호지구작업] ${p.route_name}  ${p.display_km}\n${p.work_date} ${p.start_time}~${p.end_time}  ${p.field}`;
        });
    }
    pzLayer.attr('display', k >= 1.5 ? null : 'none');

    // ⑥ 노선별 집계 배지 (zoom < 1.5)
    type BadgeData = { routeName: string; count: number; worstLevel: string | null; cx: number; cy: number };
    const DANGER_PRIORITY: Record<string, number> = { A: 3, B: 2, C: 1 };

    const routeGroups = new Map<string, { features: BlockSegmentFeature[]; midpoints: [number, number][] }>();
    for (const feat of blockSegments.features) {
      const rn = feat.properties.route_name ?? '(미상)';
      if (!routeGroups.has(rn)) routeGroups.set(rn, { features: [], midpoints: [] });
      const grp = routeGroups.get(rn)!;
      grp.features.push(feat);
      const mid = segmentMidpoint(feat.geometry.coordinates as [number, number][], proj);
      if (mid) grp.midpoints.push(mid);
    }

    const badgeData: BadgeData[] = [];
    for (const [routeName, { features, midpoints }] of routeGroups) {
      if (midpoints.length === 0) continue;
      const cx = midpoints.reduce((s, p) => s + p[0], 0) / midpoints.length;
      const cy = midpoints.reduce((s, p) => s + p[1], 0) / midpoints.length;
      let worstLevel: string | null = null;
      let worstPriority = 0;
      for (const f of features) {
        const pri = DANGER_PRIORITY[f.properties.danger_level ?? ''] ?? 0;
        if (pri > worstPriority) { worstPriority = pri; worstLevel = f.properties.danger_level; }
      }
      const count = new Set(features.map((f) => f.properties.id)).size;
      badgeData.push({ routeName, count, worstLevel, cx, cy });
    }

    const badges = badgeLayer
      .selectAll<SVGGElement, BadgeData>('g.block-badge')
      .data(badgeData)
      .join('g')
      .attr('class', 'block-badge');

    badges.each(function(d) {
      const el = d3.select(this);
      el.attr('data-bx', d.cx).attr('data-by', d.cy)
        .attr('transform', `translate(${d.cx},${d.cy}) scale(${1 / k})`)
        .style('cursor', 'pointer')
        .on('click', function(event: MouseEvent) {
          event.stopPropagation();
          if (!svgRef.current || !zoomRef.current) return;
          const W = svgRef.current.clientWidth  || 900;
          const H = svgRef.current.clientHeight || 700;
          const targetK = 2.5;  // 배지가 사라지고 개별 선분이 표시되는 줌 수준
          d3.select(svgRef.current)
            .transition()
            .duration(700)
            .ease(d3.easeCubicInOut)
            .call(
              zoomRef.current.transform,
              d3.zoomIdentity
                .translate(W / 2 - targetK * d.cx, H / 2 - targetK * d.cy)
                .scale(targetK),
            );
        });
      const color = DANGER_MARKER_COLORS_S[d.worstLevel ?? ''] ?? DANGER_MARKER_DEFAULT_S;
      const r = 9 + Math.min(d.count - 1, 4) * 1.5;
      el.append('circle').attr('r', r).attr('fill', color)
        .attr('stroke', 'white').attr('stroke-width', 2)
        .attr('vector-effect', 'non-scaling-stroke').attr('opacity', 0.92);
      el.append('text')
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', '10px').attr('font-weight', 'bold').attr('fill', 'white')
        .style('pointer-events', 'none').text(d.count);
      const shortName = d.routeName.length > 5 ? d.routeName.slice(0, 5) + '…' : d.routeName;
      el.append('text')
        .attr('text-anchor', 'middle').attr('y', r + 8)
        .attr('font-size', '8px').attr('fill', '#334155').attr('font-weight', '500')
        .style('pointer-events', 'none').text(shortName);
    });

    badgeLayer.attr('display', k < 1.5 ? null : 'none');

  // allRailGeo가 바뀌면(D3 init 재실행 시) 레이어가 재생성되므로 block-segments도 재렌더
  }, [blockSegments, selectedBlockId, allRailGeo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 시설물 레이어 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gRef.current || !projRef.current) return;
    const g = d3.select(gRef.current);

    const tbLayer    = g.select<SVGGElement>('.tunnel-bridge');   // 터널·교량 검은 밴드
    const segLayer   = g.select<SVGGElement>('.facility-segments');
    const pointLayer = g.select<SVGGElement>('.facility-points');
    tbLayer.selectAll('*').remove();
    segLayer.selectAll('*').remove();
    pointLayer.selectAll('*').remove();

    if (mergedFacilityFeatures.length === 0) return;

    const pathGen = d3.geoPath().projection(projRef.current);
    const k    = scaleRef.current;
    const capK = strokeCapZoomRef.current;

    // 노선코드 → 선로수 맵 갱신 (각 선로에 개별 터널·교량 렌더링에 사용)
    if (allRailGeo) {
      const map = new Map<string, number>();
      for (const feat of allRailGeo.features) {
        map.set(feat.properties.korail_route_code, feat.properties.default_track_count);
      }
      routeTrackCountMapRef.current = map;
    }

    const isTB = (d: FacilityFeature) =>
      d.properties.type === '구조물' &&
      (d.properties.station_type === '터널' || d.properties.station_type === '교량' || d.properties.station_type === '과선교');

    // ── 터널·교량·과선교: 각 선로(상선/하선) 위에 개별적으로 검은 밴드 표시 ──────
    // tunnel-bridge 레이어 = routes-computed 위에 위치 → 선로 색상 위에 검은색 덮임
    // 각 선로에 독립적으로 표시: 복선이면 상·하선 각각, 단선이면 중심선
    //
    // 폭 설계:
    //   복선: ROUTE_STROKE_PX + 4px (선로 1.5px + 양쪽 2px 여유)
    //   단선: 6px (중심선 기준 양쪽 3px — 사용자 지정)

    // ── 터널·교량 심볼 렌더링 ─────────────────────────────────────────────
    // bore_type (복선|단선_상선|단선_하선) + station_type(터널|교량|과선교) 에 따라
    // buildTBSymbol()이 적절한 SVG 경로(사각윤곽선 or 브래킷)를 생성한다.
    // 1 feature → 1 path (복선은 양쪽 선로를 감싸는 하나의 심볼)
    const tbFeatures = mergedFacilityFeatures.filter(
      (f) => f.geometry.type === 'LineString' && isTB(f)
    );

    tbLayer
      .selectAll<SVGPathElement, FacilityFeature>('path.tb-band')
      .data(tbFeatures)
      .join('path')
      .attr('class', 'tb-band')
      .attr('d', (d) => {
        const coords = (d.geometry as { type: 'LineString'; coordinates: [number, number][] }).coordinates;
        const bt = d.properties.bore_type ?? '복선';
        const st = d.properties.station_type ?? '터널';
        return buildTBSymbol(coords, bt, st, projRef.current!);
      })
      .attr('fill', 'none')              // 반드시 채움 없음
      .attr('stroke', '#111111')         // 검은 윤곽선만
      .attr('stroke-width', 1.5)         // 물리 픽셀 고정 (non-scaling-stroke로 보장)
      .attr('vector-effect', 'non-scaling-stroke')  // zoom 배율에 무관하게 1.5px 유지
      .attr('stroke-linecap', 'butt')    // 끝 수직 절단
      .attr('opacity', 0.90)
      .attr('display', 'none')
      .style('pointer-events', 'none');

    // ① 구간 시설물 (LineString) — 터널·교량은 투명 히트 영역만, 나머지는 기존 색상선
    const segFeatures = mergedFacilityFeatures.filter((f) => f.geometry.type === 'LineString');
    const segPaths = segLayer
      .selectAll<SVGPathElement, FacilityFeature>('path.facility-segment')
      .data(segFeatures)
      .join('path')
      .attr('class', 'facility-segment')
      .attr('d', (d) => pathGen(d as any) ?? '')
      .attr('fill', 'none')
      .attr('stroke', (d) => isTB(d) ? 'transparent' : facilityColor(d.properties.type, d.properties.station_type, facilityColorsRef.current))
      .attr('stroke-width', (d) => isTB(d) ? capStrokeSvg(PROTECT_ZONE_SVG, k, capK) : capStrokeSvg(DANGER_ZONE_SVG / 2, k, capK))
      .attr('opacity', (d) => isTB(d) ? 0 : 0.8)
      .attr('stroke-linecap', 'butt')
      .attr('display', 'none')
      .style('cursor', 'pointer')
      .on('click', function(event: MouseEvent, d: FacilityFeature) {
        event.stopPropagation();
        const svgEl = svgRef.current;
        if (!svgEl) return;
        const rect = svgEl.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const label = d.properties.station_type ?? d.properties.type;
        const kmEnd = d.properties.km_end != null ? `~${d.properties.km_end}km` : '';
        const info = `${d.properties.route_name}  ${d.properties.km}km${kmEnd}`;
        setPopupRef.current({ x: px, y: py, name: d.properties.name, type: label, info });
      });
    segPaths
      .append('title')
      .text((d) => `[${d.properties.station_type ?? d.properties.type}] ${d.properties.name}\n${d.properties.km}~${d.properties.km_end}km`);

    // ① 구간 시설물 중간점 레이블 (터널·교량·과선교) — zoom ≥ ZOOM_SEGMENT에서 표시
    segLayer
      .selectAll<SVGTextElement, FacilityFeature>('text.facility-seg-label')
      .data(segFeatures)
      .join('text')
      .attr('class', 'facility-seg-label')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'text-after-edge')
      .style('pointer-events', 'none')
      .style('user-select', 'none')
      .attr('display', 'none')   // _updateFacilityVisibility에서 제어
      .each(function(d) {
        const proj = projRef.current;
        if (!proj) return;
        const coords = (d.geometry as { type: 'LineString'; coordinates: [number, number][] }).coordinates;
        const pts = coords.map(([lon, lat]) => proj([lon, lat])).filter((p): p is [number, number] => p !== null);
        if (pts.length < 2) return;

        // 기하 중심점 (2점 LineString 끝점 오류 수정)
        const mid = svgPolylineMidpoint(pts);
        if (!mid) return;

        // 방향각 계산
        const midIdx = Math.floor(pts.length / 2);
        const p1 = pts[Math.max(0, midIdx - 1)];
        const p2 = pts[Math.min(pts.length - 1, midIdx + 1)];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];

        // ■ 뒤집힘 방지: 각도가 90°~270° 범위이면 +180° 보정 → 항상 읽기 가능
        let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;

        const k = scaleRef.current;

        // ■ 레이블 위치: 심볼(사각형/브래킷) 위쪽으로 오프셋
        // 법선 벡터 방향으로 halfWidthPx + 여백만큼 이동 후 렌더
        const lenDir = Math.sqrt(dx*dx + dy*dy);
        const nx = lenDir > 0 ? -dy / lenDir : 0;
        const ny = lenDir > 0 ?  dx / lenDir : -1;
        // ny > 0이면 SVG 아래쪽 → 반전하여 항상 위쪽(화면 상단) 방향으로
        const sign = ny < 0 ? 1 : -1;

        const bt = d.properties.bore_type ?? '복선';
        const hw = bt === '복선'
          ? (TRACK_HALF_GAP_SVG + ROUTE_STROKE_SVG / 2 + 0.5)
          : (ROUTE_STROKE_SVG / 2 + 0.8);
        const labelOffsetSvg = hw + 0.8;  // SVG 단위 오프셋

        const lx = mid[0] + sign * nx * labelOffsetSvg;
        const ly = mid[1] + sign * ny * labelOffsetSvg;

        d3.select(this)
          .attr('x', lx)
          .attr('y', ly)
          .attr('transform', `rotate(${angleDeg},${lx},${ly})`)
          .attr('font-size', `${10 / k}px`)
          .attr('fill', '#222222')   // 터널·교량 레이블: 진한 회색 (검은 심볼과 구분)
          .attr('dy', '0')
          .text(d.properties.name);
      });

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
    // 글자 크기 기준 (scale(1/k) 그룹 내부 → px 값 = 물리 픽셀):
    //   관리역: 12px bold  (가장 중요한 거점역)
    //   보통역·무인역: 10px  (일반역)
    //   신호장·신호소: 9px  (보조 설비)
    //   변전소·건널목·분기: 11px  (시설물)
    //   터널·교량·과선교: 10px 물리 (gRef 직계 → 10/k SVG px)

    pointGroups.filter((d) => d.properties.type === '역' && d.properties.station_type === '관리역')
      .call((sel) => {
        sel.append('circle').attr('r', 4).attr('fill', LEGEND_COLORS.관리역)
          .attr('stroke', 'white').attr('stroke-width', 1.5).attr('vector-effect', 'non-scaling-stroke');
        sel.append('text').attr('x', 6).attr('y', 3).attr('font-size', '12px')
          .attr('fill', LEGEND_COLORS.관리역).attr('font-weight', '700')
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
        .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type, facilityColorsRef.current))
        .attr('stroke', 'white').attr('stroke-width', 1).attr('vector-effect', 'non-scaling-stroke');
      sel.append('text').attr('x', 5).attr('y', 3).attr('font-size', '10px')
        .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type, facilityColorsRef.current))
        .style('pointer-events', 'none').text((d) => d.properties.name);
      sel.append('title').text((d) => `[${d.properties.station_type}] ${d.properties.name}  클릭하여 상세 보기`);
    });

    // 신호장·신호소: 작은 다이아몬드 + 9px 역명
    pointGroups.filter((d) =>
      d.properties.type === '역' &&
      (d.properties.station_type === '신호장' || d.properties.station_type === '신호소')
    ).call((sel) => {
      sel.append('polygon').attr('points', '0,-3 3,0 0,3 -3,0')
        .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type, facilityColorsRef.current))
        .attr('stroke', 'white').attr('stroke-width', 1).attr('vector-effect', 'non-scaling-stroke');
      sel.append('text').attr('x', 5).attr('y', 3).attr('font-size', '9px')
        .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type, facilityColorsRef.current))
        .style('pointer-events', 'none').text((d) => d.properties.name);
      sel.append('title').text((d) => `[${d.properties.station_type}] ${d.properties.name}  KP ${d.properties.km}km`);
    });

    // 변전소/전기설비: 사각형 (station_type에 따라 색상 구분)
    pointGroups.filter((d) => d.properties.type === '변전소')
      .call((sel) => {
        sel.append('rect').attr('x', -4).attr('y', -4).attr('width', 8).attr('height', 8)
          .attr('fill', (d) => facilityColor(d.properties.type, d.properties.station_type, facilityColorsRef.current))
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

    // ② Point 시설물 이름 레이블 (변전소·건널목·분기) — zoom ≥ ZOOM_DETAIL에서 표시
    // 클래스 facility-point-label로 _updateFacilityVisibility에서 가시성 제어
    pointGroups.filter((d) =>
      d.properties.type === '변전소' ||
      (d.properties.type === '구조물' &&
        (d.properties.station_type === '건널목' || d.properties.station_type === '분기'))
    ).each(function(d) {
      d3.select(this).append('text')
        .attr('class', 'facility-point-label')
        .attr('x', 8).attr('y', 5)
        .attr('font-size', '11px')  // scale(1/k) 그룹 내부 → 11px = 11px 물리
        .attr('fill', facilityColor(d.properties.type, d.properties.station_type, facilityColorsRef.current))
        .style('pointer-events', 'none')
        .style('user-select', 'none')
        .attr('display', 'none')
        .text(d.properties.name);
    });

    _updateFacilityVisibility(scaleRef.current);

  }, [mergedFacilityFeatures, allRailGeo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 선택된 차단구간으로 지도 이동 (fly-to) ──────────────────────────────
  // selectedBlockId 변경 시: 이전 fly-to 기록 초기화
  useEffect(() => {
    lastFlownToRef.current = null;
  }, [selectedBlockId]);

  // blockSegments 로드 후(또는 selectedBlockId 변경 후) fly-to 실행
  useEffect(() => {
    if (!selectedBlockId || !blockSegments) return;
    if (lastFlownToRef.current === selectedBlockId) return;  // 이미 이동 완료
    if (!projRef.current || !zoomRef.current || !svgRef.current) return;

    // 선택된 block_order 의 첫 번째 feature (UP 방향 우선)
    const feat = blockSegments.features.find(f => f.properties.id === selectedBlockId);
    if (!feat) return;

    const mid = segmentMidpoint(
      feat.geometry.coordinates as [number, number][],
      projRef.current,
    );
    if (!mid) return;

    lastFlownToRef.current = selectedBlockId;

    // 현재 줌이 3 미만이면 3으로 확대, 이상이면 유지
    const currentK = scaleRef.current;
    const targetK  = Math.max(currentK, 3);
    const W = svgRef.current.clientWidth  || 900;
    const H = svgRef.current.clientHeight || 700;

    d3.select(svgRef.current)
      .transition()
      .duration(700)
      .ease(d3.easeCubicInOut)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity
          .translate(W / 2 - targetK * mid[0], H / 2 - targetK * mid[1])
          .scale(targetK),
      );
  }, [selectedBlockId, blockSegments]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ overflow: 'hidden', touchAction: 'none', userSelect: 'none' }}
      >
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

      {/* 좌하단 범례: 차단구간·관할구간 */}
      {((blockSegments && blockSegments.features.length > 0) || showOrgBoundary) && (
        <div className="absolute bottom-4 left-4 bg-white/90 rounded-lg shadow px-3 py-2 text-xs space-y-1 border">
          {blockSegments && blockSegments.features.length > 0 && (
            <>
              {/* 선로차단 */}
              <div className="font-medium text-gray-600">선로차단 (노란)</div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-6 h-2 rounded" style={{ backgroundColor: TRACK_BLOCK_COLOR_S }} />
                <span className="text-gray-600">선로차단 (상선=좌, 하선=우)</span>
              </div>
              {/* 전차선단전 */}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-block w-6 h-1.5 rounded" style={{ backgroundColor: CATENARY_CUT_COLOR_S }} />
                <span className="text-gray-600">전차선단전 (녹색)</span>
              </div>
              {/* 위험등급 */}
              <div className="border-t pt-1 mt-0.5 font-medium text-gray-600">◆ 위험등급</div>
              {(['A','B','C'] as const).map((lvl) => (
                <div key={lvl} className="flex items-center gap-1.5">
                  <svg width="10" height="10" viewBox="-5 -5 10 10">
                    <polygon points="0,-4 4,0 0,4 -4,0" fill={DANGER_MARKER_COLORS_S[lvl]} stroke="white" strokeWidth="1" />
                  </svg>
                  <span className="text-gray-600">{lvl === 'A' ? 'A 위험' : lvl === 'B' ? 'B 주의' : 'C 일반'}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <svg width="10" height="10" viewBox="-5 -5 10 10">
                  <polygon points="0,-4 4,0 0,4 -4,0" fill={DANGER_MARKER_DEFAULT_S} stroke="white" strokeWidth="1" />
                </svg>
                <span className="text-gray-600">미지정</span>
              </div>
              {showDangerZone && (
                <>
                  <div className="border-t pt-1 mt-1 font-medium text-gray-600">안전구간</div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-6 h-2 rounded" style={{ backgroundColor: `${TRACK_BLOCK_COLOR_S}44` }} />
                    <span className="text-gray-600">위험지구 2m</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-6 h-2 rounded" style={{ backgroundColor: `${TRACK_BLOCK_COLOR_S}1a` }} />
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
            <span className="inline-block w-6 h-px" style={{ backgroundColor: '#dc2626' }} />
            <span className="text-gray-600">고속선 (전철화)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-6 h-px" style={{ backgroundColor: '#f97316' }} />
            <span className="text-gray-600">일반선 (전철화)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-6 h-px" style={{ backgroundColor: '#9ca3af' }} />
            <span className="text-gray-600">일반선 (비전철)</span>
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
