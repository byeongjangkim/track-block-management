#!/usr/bin/env python3
"""
build_user_geometry.py — facilities 앵커로 route_geometry km값 자동 보간·저장

사용법:
  python3 scripts/build_user_geometry.py <route_code>
  python3 scripts/build_user_geometry.py --dry-run donghae
  python3 scripts/build_user_geometry.py --verbose donghae

알고리즘:
  1. facilities에서 GPS+km이 있는 역을 km순 앵커로 로드
  2. 백본(기존 GPS 포인트)을 segment별로 로드
  3. 시점 앵커(km=최소)에서 출발하여 segment를 지리적 최근접 순으로 체인
     - 각 segment는 정방향 또는 역방향으로 이어 붙임
     - 연결된 segment → 단일 연속 좌표열
  4. 연속 좌표열 전체에 km 보간
     - 각 앵커를 고정점(fix point)으로 삼아
     - 앵커 사이 구간을 누적 Haversine 거리 비율로 선형 보간
  5. source='user', lod='high' 저장 (segment=0 단일 선형)
  6. mid / low LOD를 Douglas-Peucker로 자동 생성

백본 소스 우선순위:
  ① source='user', lod='high' (dense GPS, km=NULL)
  ② source='shp',  lod='high'
  ③ 없으면 앵커 직선 연결
"""
from __future__ import annotations

import argparse
import math
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "backend" / "db.sqlite3"

LOD_TOLERANCE = {
    "high": None,
    "mid":  0.0001,
    "low":  0.0005,
}


# ── 거리 ───────────────────────────────────────────────────────────────────

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(max(0.0, a)))


# ── segment 체인 ────────────────────────────────────────────────────────────

def chain_segments(
    segments: list[list[tuple[float, float]]],
    start_lat: float,
    start_lon: float,
) -> list[tuple[float, float]]:
    """
    segment 목록을 greedy nearest-neighbor로 이어 단일 좌표열 반환.
    start_lat/lon에 가장 가까운 segment 끝점부터 시작.
    각 segment는 필요 시 reverse해서 붙임.
    """
    remaining = [list(s) for s in segments]
    chain: list[tuple[float, float]] = []
    cur_lat, cur_lon = start_lat, start_lon

    while remaining:
        best_i = 0
        best_d = float("inf")
        best_rev = False

        for i, seg in enumerate(remaining):
            d_head = haversine(cur_lat, cur_lon, seg[0][0],  seg[0][1])
            d_tail = haversine(cur_lat, cur_lon, seg[-1][0], seg[-1][1])
            d = min(d_head, d_tail)
            rev = d_tail < d_head
            if d < best_d:
                best_d, best_i, best_rev = d, i, rev

        seg = remaining.pop(best_i)
        if best_rev:
            seg = list(reversed(seg))

        # 첫 segment는 전체 추가, 이후는 중복 첫 점 제거
        if chain:
            chain.extend(seg[1:])
        else:
            chain.extend(seg)

        cur_lat, cur_lon = chain[-1]

    return chain


# ── km 보간 ─────────────────────────────────────────────────────────────────

def assign_km(
    chain: list[tuple[float, float]],
    anchors: list[tuple[float, float, float, str]],  # (km, lat, lon, name)
) -> list[tuple[float, float, float]]:
    """
    연속 좌표열(chain)의 각 포인트에 km 값을 보간 할당.

    방법:
      1. 각 앵커를 chain 내에서 가장 가까운 인덱스에 매핑
      2. 앵커 인덱스가 단조증가하도록 정제
      3. 앵커 쌍 사이 구간: 누적 Haversine 거리 비율 보간
      4. 앵커 이전/이후: 거리 외삽
    """
    n = len(chain)
    km_arr: list[float | None] = [None] * n

    # ── 각 앵커를 chain 내 최근접 인덱스에 매핑 ──────────────────────────
    anchor_map: list[tuple[int, float]] = []  # (chain_idx, km)
    search_start = 0  # 단조 탐색으로 속도 향상

    for anc_km, anc_lat, anc_lon, anc_name in anchors:
        best_i, best_d = search_start, float("inf")
        # 탐색 범위: search_start ~ 끝 (이미 지난 구간은 재탐색하지 않음)
        # 단, 첫 앵커는 전체 탐색
        lo = max(0, search_start - 50) if anchor_map else 0
        for i in range(lo, n):
            d = haversine(anc_lat, anc_lon, chain[i][0], chain[i][1])
            if d < best_d:
                best_d, best_i = d, i

        anchor_map.append((best_i, anc_km))
        search_start = best_i  # 다음 앵커는 여기서부터 탐색

    # ── 단조 증가 보정 ────────────────────────────────────────────────────
    for i in range(1, len(anchor_map)):
        if anchor_map[i][0] <= anchor_map[i - 1][0]:
            anchor_map[i] = (anchor_map[i - 1][0] + 1, anchor_map[i][1])

    # ── 앵커 위치 고정 ────────────────────────────────────────────────────
    for idx, km in anchor_map:
        if idx < n:
            km_arr[idx] = km

    # ── 앵커 쌍 사이 보간 ────────────────────────────────────────────────
    for i in range(len(anchor_map) - 1):
        ia, km_a = anchor_map[i]
        ib, km_b = anchor_map[i + 1]
        ib = min(ib, n - 1)
        if ib <= ia:
            continue

        seg = chain[ia: ib + 1]
        cum = [0.0]
        for j in range(1, len(seg)):
            cum.append(cum[-1] + haversine(
                seg[j-1][0], seg[j-1][1], seg[j][0], seg[j][1]
            ))
        total = cum[-1]

        for j, ci in enumerate(range(ia, ib + 1)):
            frac = cum[j] / total if total > 0 else j / max(1, len(seg) - 1)
            km_arr[ci] = km_a + frac * (km_b - km_a)

    # ── 첫 앵커 이전: 역방향 거리 외삽 ──────────────────────────────────
    i0, km0 = anchor_map[0]
    if i0 > 0:
        ref_km = km0
        for j in range(i0 - 1, -1, -1):
            d = haversine(chain[j][0], chain[j][1], chain[j+1][0], chain[j+1][1])
            ref_km -= d
            km_arr[j] = ref_km

    # ── 마지막 앵커 이후: 순방향 거리 외삽 ──────────────────────────────
    i_last, km_last = anchor_map[-1]
    if i_last < n - 1:
        ref_km = km_last
        for j in range(i_last + 1, n):
            d = haversine(chain[j][0], chain[j][1], chain[j-1][0], chain[j-1][1])
            ref_km += d
            km_arr[j] = ref_km

    return [(lat, lon, km) for (lat, lon), km in zip(chain, km_arr) if km is not None]


# ── Douglas-Peucker ─────────────────────────────────────────────────────────

def _perp_sq(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    len_sq = dx * dx + dy * dy
    if len_sq < 1e-18:
        return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2
    t = max(0.0, min(1.0, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / len_sq))
    return (p[0]-a[0]-t*dx)**2 + (p[1]-a[1]-t*dy)**2


def _dp(pts, s, e, tol_sq, keep):
    if e <= s + 1:
        return
    md, mi = 0.0, s
    for i in range(s + 1, e):
        d = _perp_sq(pts[i], pts[s], pts[e])
        if d > md:
            md, mi = d, i
    if md > tol_sq:
        keep[mi] = True
        _dp(pts, s, mi, tol_sq, keep)
        _dp(pts, mi, e, tol_sq, keep)


def simplify(pts: list, tol: float | None) -> list:
    if tol is None or len(pts) < 3:
        return pts
    n = len(pts)
    keep = [False] * n
    keep[0] = keep[-1] = True
    _dp(pts, 0, n - 1, tol ** 2, keep)
    return [p for p, k in zip(pts, keep) if k]


# ── 메인 ───────────────────────────────────────────────────────────────────

def build_user_geometry(
    route_code: str,
    dry_run: bool = False,
    verbose: bool = False,
) -> dict:

    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    warnings: list[str] = []

    try:
        # ── 노선 확인 ──────────────────────────────────────────────────────
        cur.execute(
            "SELECT id, name, start_km, end_km FROM routes WHERE code=?",
            (route_code,)
        )
        row = cur.fetchone()
        if not row:
            raise SystemExit(f"ERROR: 노선 코드 '{route_code}' 없음")
        route_id, route_name, start_km, end_km = row
        print(f"노선: {route_name} ({route_code})  km={start_km}~{end_km}")

        # ── 앵커 로드 ─────────────────────────────────────────────────────
        cur.execute("""
            SELECT km, lat, lon, name
            FROM facilities
            WHERE route_id=? AND lat IS NOT NULL AND lon IS NOT NULL AND km IS NOT NULL
            ORDER BY km
        """, (route_id,))
        anchors = cur.fetchall()   # [(km, lat, lon, name), ...]

        if len(anchors) < 2:
            raise SystemExit(
                f"ERROR: GPS+km 시설물 {len(anchors)}개 — 최소 2개 필요"
            )
        print(f"앵커: {len(anchors)}개  "
              f"({anchors[0][3]} {anchors[0][0]}km ~ "
              f"{anchors[-1][3]} {anchors[-1][0]}km)")

        # ── 백본 로드 (segment별) ────────────────────────────────────────
        segments: list[list[tuple[float, float]]] = []
        backbone_source = None

        for src in ("user", "shp"):
            cur.execute("""
                SELECT segment, lat, lon
                FROM route_geometry
                WHERE route_code=? AND source=? AND lod='high'
                ORDER BY segment, seq
            """, (route_code, src))
            rows = cur.fetchall()
            if rows:
                seg_dict: dict[int, list] = {}
                for seg_num, lat, lon in rows:
                    seg_dict.setdefault(seg_num, []).append((lat, lon))
                # 최소 2포인트 이상인 segment만 사용
                segments = [v for v in seg_dict.values() if len(v) >= 2]
                backbone_source = src
                break

        total_pts = sum(len(s) for s in segments)
        if total_pts:
            print(f"백본: {total_pts}개 포인트, "
                  f"{len(segments)}개 segment (source='{backbone_source}')")
        else:
            warnings.append("기존 geometry 없음 — 앵커 직선 연결")
            print("백본: 없음 (앵커 직선 연결)")

        # ── 단일 연속 좌표열 구성 ────────────────────────────────────────
        start_lat, start_lon = anchors[0][1], anchors[0][2]

        if not segments:
            chain = [(lat, lon) for _, lat, lon, _ in anchors]
        else:
            if verbose:
                print(f"  체인 시작점: {anchors[0][3]} ({start_lat:.4f}, {start_lon:.4f})")
            chain = chain_segments(segments, start_lat, start_lon)
            print(f"체인 완성: {len(chain)}개 포인트 (단일 연속 좌표열)")

        # ── km 보간 ───────────────────────────────────────────────────────
        result = assign_km(chain, anchors)

        # 앵커 이전(km<0) 또는 범위 초과 포인트 경고만, 제거하지 않음
        km_vals = [km for _, _, km in result]
        n_neg = sum(1 for k in km_vals if k < -0.1)
        n_over = sum(1 for k in km_vals if k > end_km + 0.5)
        if n_neg:
            warnings.append(f"km<0 포인트 {n_neg}개 (앵커 이전 외삽 구간)")
        if n_over:
            warnings.append(f"km>{end_km} 포인트 {n_over}개 (앵커 이후 외삽 구간)")

        km_min = result[0][2]
        km_max = result[-1][2]
        print(f"생성 포인트 (high): {len(result)}개  km={km_min:.1f}~{km_max:.1f}")

        # ── LOD 생성 ─────────────────────────────────────────────────────
        lod_data: dict[str, list] = {"high": result}
        for lod, tol in LOD_TOLERANCE.items():
            if lod == "high":
                continue
            s = simplify(result, tol)
            lod_data[lod] = s
            print(f"생성 포인트 ({lod}):  {len(s)}개")

        # ── dry-run ───────────────────────────────────────────────────────
        if dry_run:
            print("\n[dry-run] 처음 10개 포인트 (high LOD):")
            for lat, lon, km in result[:10]:
                print(f"  {lat:.6f}, {lon:.6f}  km={km:.3f}")
            if warnings:
                print("\n경고:")
                for w in warnings:
                    print(f"  ⚠  {w}")
            print("[dry-run] DB 저장 없이 종료합니다.")
            return {
                "route_code": route_code, "route_name": route_name,
                "anchors": len(anchors), "backbone": total_pts,
                "saved": {k: len(v) for k, v in lod_data.items()},
                "warnings": warnings, "dry_run": True,
            }

        # ── DB 저장 ──────────────────────────────────────────────────────
        cur.execute(
            "DELETE FROM route_geometry WHERE route_code=? AND source='user'",
            (route_code,)
        )
        saved: dict[str, int] = {}
        for lod, pts in lod_data.items():
            rows = [
                (route_code, lod, seq, lat, lon, km)
                for seq, (lat, lon, km) in enumerate(pts)
            ]
            cur.executemany(
                "INSERT INTO route_geometry "
                "(route_code, source, lod, segment, seq, lat, lon, km) "
                "VALUES (?, 'user', ?, 0, ?, ?, ?, ?)",
                rows
            )
            saved[lod] = len(rows)

        conn.commit()
        print(f"\n저장 완료: high={saved['high']}, mid={saved['mid']}, low={saved['low']}")
        if warnings:
            print("\n경고:")
            for w in warnings:
                print(f"  ⚠  {w}")

        return {
            "route_code": route_code, "route_name": route_name,
            "anchors": len(anchors), "backbone": total_pts,
            "saved": saved, "warnings": warnings,
        }

    finally:
        conn.close()


# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="facilities 앵커 기반 route_geometry km 자동 보간"
    )
    parser.add_argument("route_code", help="노선 코드 (예: donghae, gyeongbu)")
    parser.add_argument("--dry-run", action="store_true",
                        help="DB 저장 없이 결과만 출력")
    parser.add_argument("--verbose", action="store_true",
                        help="상세 로그 출력")
    args = parser.parse_args()

    if not DB_PATH.exists():
        sys.exit(f"ERROR: DB 파일 없음: {DB_PATH}")

    build_user_geometry(
        route_code=args.route_code,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
