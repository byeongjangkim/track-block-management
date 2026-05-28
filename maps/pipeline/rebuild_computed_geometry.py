#!/usr/bin/env python3
"""
rebuild_computed_geometry.py

rail_baseline_points (KP+GPS anchor) → rail_computed_geometry (보간 생성)

보간 방법:
  - 같은 노선·segment_no 내 KP 순 정렬
  - 인접 anchor 두 점 간 선형 보간
  - LOD별 간격: high=0.5km, mid=2.0km, low=10.0km
  - anchor 자체는 항상 포함 (간격과 무관)

사용법:
  cd <repo-root>
  source backend/.venv/bin/activate

  python3 maps/pipeline/rebuild_computed_geometry.py --all
  python3 maps/pipeline/rebuild_computed_geometry.py --route-id 1
  python3 maps/pipeline/rebuild_computed_geometry.py --route-code 01
  python3 maps/pipeline/rebuild_computed_geometry.py --all --dry-run
"""

import argparse
import sys
from itertools import groupby
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "backend" / "db.sqlite3"

import os
os.environ.setdefault("DATABASE_URL", f"sqlite:///{DB_PATH}")

sys.path.insert(0, str(REPO_ROOT / "backend"))

from sqlalchemy import text

from app.core.database import SessionLocal

LOD_INTERVALS: dict[str, float] = {
    "high": 0.5,
    "mid": 2.0,
    "low": 10.0,
}


def _interpolated_points(anchors: list, interval: float) -> list[tuple[float, float, float]]:
    """anchor 목록에서 interval km 간격 보간점 생성 (anchor 자체 포함).

    Returns list of (kp, lat, lon).
    """
    points: list[tuple[float, float, float]] = []

    for i in range(len(anchors) - 1):
        kp1, lat1, lon1 = anchors[i].kp, anchors[i].lat, anchors[i].lon
        kp2, lat2, lon2 = anchors[i + 1].kp, anchors[i + 1].lat, anchors[i + 1].lon

        if kp2 <= kp1 + 1e-6:
            continue

        points.append((kp1, lat1, lon1))

        kp = kp1 + interval
        while kp < kp2 - 1e-6:
            t = (kp - kp1) / (kp2 - kp1)
            points.append((kp, lat1 + t * (lat2 - lat1), lon1 + t * (lon2 - lon1)))
            kp += interval

    if anchors:
        last = anchors[-1]
        points.append((last.kp, last.lat, last.lon))

    return points


def rebuild_route(db, route_id: int, route_name: str, line_type: str, dry_run: bool = False) -> int:
    """단일 노선 재계산. 삽입된 행 수 반환."""

    anchors_all = db.execute(
        text("""
            SELECT segment_no, kp, lat, lon
            FROM rail_baseline_points
            WHERE rail_route_id = :route_id
              AND is_interpolation_anchor = 1
            ORDER BY segment_no, kp
        """),
        {"route_id": route_id},
    ).fetchall()

    if not anchors_all:
        print(f"  [{route_name}] baseline 없음 — 건너뜀")
        return 0

    # segment_no별 그룹화
    segments: dict[int, list] = {}
    for seg_no, pts in groupby(anchors_all, key=lambda r: r.segment_no):
        pts_list = list(pts)
        if len(pts_list) >= 2:
            segments[seg_no] = pts_list

    if not segments:
        print(f"  [{route_name}] 각 segment에 anchor 2점 미만 — 건너뜀")
        return 0

    total = 0

    for lod, interval in LOD_INTERVALS.items():
        if not dry_run:
            db.execute(
                text("DELETE FROM rail_computed_geometry WHERE rail_route_id = :rid AND lod = :lod"),
                {"rid": route_id, "lod": lod},
            )

        seq = 0
        for seg_no in sorted(segments):
            pts = _interpolated_points(segments[seg_no], interval)
            for kp, lat, lon in pts:
                if not dry_run:
                    db.execute(
                        text("""
                            INSERT INTO rail_computed_geometry
                                (rail_route_id, line_type, kp, lat, lon, source, lod, seq)
                            VALUES
                                (:rid, :lt, :kp, :lat, :lon, 'interpolated', :lod, :seq)
                        """),
                        {
                            "rid": route_id,
                            "lt": line_type,
                            "kp": round(kp, 3),
                            "lat": round(lat, 6),
                            "lon": round(lon, 6),
                            "lod": lod,
                            "seq": seq,
                        },
                    )
                seq += 1
            total += len(pts)

        print(f"  [{lod}] {seq}점{'(dry-run)' if dry_run else ''}")

    if not dry_run:
        db.commit()

    return total


def main() -> None:
    parser = argparse.ArgumentParser(description="rail_computed_geometry 재계산")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="전체 노선 재계산")
    group.add_argument("--route-id", type=int, metavar="ID", help="rail_routes.id 지정")
    group.add_argument("--route-code", metavar="CODE", help="korail_route_code 지정 (예: 01, H1)")
    parser.add_argument("--dry-run", action="store_true", help="DB 저장 없이 점 수만 출력")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.all:
            routes = db.execute(
                text("SELECT id, name, line_type FROM rail_routes ORDER BY line_type DESC, name")
            ).fetchall()
        elif args.route_id:
            routes = db.execute(
                text("SELECT id, name, line_type FROM rail_routes WHERE id = :id"),
                {"id": args.route_id},
            ).fetchall()
        else:
            routes = db.execute(
                text("SELECT id, name, line_type FROM rail_routes WHERE korail_route_code = :code"),
                {"code": args.route_code},
            ).fetchall()

        if not routes:
            print("해당 노선을 찾을 수 없습니다.")
            sys.exit(1)

        grand_total = 0
        for route in routes:
            print(f"\n▶ {route.name} (id={route.id}, {route.line_type})")
            n = rebuild_route(db, route.id, route.name, route.line_type, dry_run=args.dry_run)
            grand_total += n

        print(f"\n완료: {len(routes)}개 노선, 총 {grand_total}점 {'(dry-run)' if args.dry_run else '삽입'}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
