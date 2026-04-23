import type { Anchor } from '../types';

/**
 * 거리정(km) → SVG 좌표 변환 (앵커 포인트 선형 보간)
 * 앵커가 없으면 null 반환
 */
export function kmToSvg(km: number, anchors: Anchor[]): { x: number; y: number } | null {
  if (anchors.length === 0) return null;

  const sorted = [...anchors].sort((a, b) => a.km - b.km);

  // 범위 밖
  if (km <= sorted[0].km) return { x: sorted[0].x, y: sorted[0].y };
  if (km >= sorted[sorted.length - 1].km) {
    const last = sorted[sorted.length - 1];
    return { x: last.x, y: last.y };
  }

  // 보간 구간 탐색
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (km >= a.km && km <= b.km) {
      const t = (km - a.km) / (b.km - a.km);
      return {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
      };
    }
  }

  return null;
}

/**
 * 차단구간의 SVG 좌표 범위를 반환
 * 상선(UP): y - upOffsetPx, 하선(DOWN): y + downOffsetPx
 */
export function blockSegmentToSvg(
  startKm: number,
  endKm: number,
  direction: 'UP' | 'DOWN',
  anchors: Anchor[],
  upOffsetPx: number,
  downOffsetPx: number
): { x1: number; y1: number; x2: number; y2: number } | null {
  const p1 = kmToSvg(startKm, anchors);
  const p2 = kmToSvg(endKm, anchors);
  if (!p1 || !p2) return null;

  const offset = direction === 'UP' ? upOffsetPx : downOffsetPx;
  return { x1: p1.x, y1: p1.y + offset, x2: p2.x, y2: p2.y + offset };
}
