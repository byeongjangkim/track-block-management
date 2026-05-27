#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


SOURCE_TYPE = "rail_route_station_point"
STATION_POINT_TYPES = ("station_center", "station_yard_start", "station_yard_end")


def ensure_table(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='rail_baseline_points'"
    ).fetchone()
    if row is None:
        raise RuntimeError("rail_baseline_points table not found. Run Alembic upgrade first.")


def interpolate(points: list[dict], kp: float) -> tuple[float, float] | None:
    """Return lat/lon for kp using the route's station-center anchors."""
    if len(points) < 2:
        return None

    ordered = sorted(points, key=lambda p: (p["kp"], p["id"]))
    if kp <= ordered[0]["kp"]:
        a, b = ordered[0], ordered[1]
    elif kp >= ordered[-1]["kp"]:
        a, b = ordered[-2], ordered[-1]
    else:
        a = b = None
        for idx in range(len(ordered) - 1):
            left, right = ordered[idx], ordered[idx + 1]
            if left["kp"] <= kp <= right["kp"]:
                a, b = left, right
                break
        if a is None or b is None:
            return None

    span = b["kp"] - a["kp"]
    if span == 0:
        return a["lat"], a["lon"]
    t = (kp - a["kp"]) / span
    return a["lat"] + t * (b["lat"] - a["lat"]), a["lon"] + t * (b["lon"] - a["lon"])


def load_station_rows(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
            p.id AS source_id,
            p.rail_route_id,
            p.station_id,
            p.route_sequence_no,
            p.center_kp,
            p.yard_start_kp,
            p.yard_end_kp,
            s.lat,
            s.lon
        FROM rail_route_station_points p
        JOIN rail_stations s ON s.id = p.station_id
        WHERE s.lat IS NOT NULL
          AND s.lon IS NOT NULL
        """
    ).fetchall()
    return [
        {
            "source_id": row[0],
            "rail_route_id": row[1],
            "station_id": row[2],
            "route_sequence_no": row[3],
            "center_kp": row[4],
            "yard_start_kp": row[5],
            "yard_end_kp": row[6],
            "lat": row[7],
            "lon": row[8],
        }
        for row in rows
    ]


def build_station_points(rows: list[dict]) -> list[dict]:
    centers_by_route: dict[int, list[dict]] = {}
    for row in rows:
        if row["center_kp"] is None:
            continue
        centers_by_route.setdefault(row["rail_route_id"], []).append(
            {
                "id": row["source_id"],
                "kp": row["center_kp"],
                "lat": row["lat"],
                "lon": row["lon"],
            }
        )

    points: list[dict] = []
    for row in rows:
        route_centers = centers_by_route.get(row["rail_route_id"], [])

        if row["center_kp"] is not None:
            points.append(make_point(row, "station_center", row["center_kp"], row["lat"], row["lon"], 1, None))

        for point_type, kp_key, type_order in (
            ("station_yard_start", "yard_start_kp", 0),
            ("station_yard_end", "yard_end_kp", 2),
        ):
            kp = row[kp_key]
            if kp is None:
                continue
            coord = interpolate(route_centers, kp)
            if coord is None:
                continue
            lat, lon = coord
            points.append(
                make_point(
                    row,
                    point_type,
                    kp,
                    lat,
                    lon,
                    type_order,
                    "station center anchors에서 KP 기준 보간 생성",
                )
            )

    points.sort(
        key=lambda p: (
            p["rail_route_id"],
            p["segment_no"],
            p["kp"],
            p["type_order"],
            p["route_sequence_no"] is None,
            p["route_sequence_no"] or 0,
            p["source_id"],
        )
    )

    seq_by_route_segment: dict[tuple[int, int], int] = {}
    for point in points:
        key = (point["rail_route_id"], point["segment_no"])
        seq_by_route_segment[key] = seq_by_route_segment.get(key, 0) + 1
        point["seq"] = seq_by_route_segment[key]

    return points


def make_point(
    row: dict,
    point_type: str,
    kp: float,
    lat: float,
    lon: float,
    type_order: int,
    note: str | None,
) -> dict:
    return {
        "rail_route_id": row["rail_route_id"],
        "segment_no": 0,
        "seq": 0,
        "kp": kp,
        "lat": lat,
        "lon": lon,
        "point_type": point_type,
        "source_type": SOURCE_TYPE,
        "source_id": row["source_id"],
        "station_id": row["station_id"],
        "is_interpolation_anchor": 1,
        "is_render_anchor": 1,
        "note": note,
        "route_sequence_no": row["route_sequence_no"],
        "type_order": type_order,
    }


def rebuild_station_baseline(conn: sqlite3.Connection) -> dict[str, int]:
    ensure_table(conn)
    conn.execute("PRAGMA foreign_keys = ON")
    placeholders = ",".join("?" for _ in STATION_POINT_TYPES)
    conn.execute(
        f"""
        DELETE FROM rail_baseline_points
        WHERE source_type = ?
          AND point_type IN ({placeholders})
        """,
        (SOURCE_TYPE, *STATION_POINT_TYPES),
    )

    points = build_station_points(load_station_rows(conn))
    if points:
        conn.executemany(
            """
            INSERT INTO rail_baseline_points (
                rail_route_id,
                segment_no,
                seq,
                kp,
                lat,
                lon,
                point_type,
                source_type,
                source_id,
                station_id,
                is_interpolation_anchor,
                is_render_anchor,
                note
            )
            VALUES (
                :rail_route_id,
                :segment_no,
                :seq,
                :kp,
                :lat,
                :lon,
                :point_type,
                :source_type,
                :source_id,
                :station_id,
                :is_interpolation_anchor,
                :is_render_anchor,
                :note
            )
            """,
            points,
        )
    conn.commit()

    counts = {
        row[0]: int(row[1])
        for row in conn.execute(
            f"""
            SELECT point_type, COUNT(*)
            FROM rail_baseline_points
            WHERE source_type = ?
              AND point_type IN ({placeholders})
            GROUP BY point_type
            """,
            (SOURCE_TYPE, *STATION_POINT_TYPES),
        )
    }
    counts["total"] = sum(counts.values())
    return counts


def rebuild_station_centers(conn: sqlite3.Connection) -> int:
    return rebuild_station_baseline(conn).get("station_center", 0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild rail baseline station anchors.")
    parser.add_argument("--db", type=Path, default=Path("backend/db.sqlite3"))
    args = parser.parse_args()

    with sqlite3.connect(args.db) as conn:
        counts = rebuild_station_baseline(conn)

    print(f"station_center_baseline_points={counts.get('station_center', 0)}")
    print(f"station_yard_start_baseline_points={counts.get('station_yard_start', 0)}")
    print(f"station_yard_end_baseline_points={counts.get('station_yard_end', 0)}")
    print(f"station_baseline_points_total={counts.get('total', 0)}")


if __name__ == "__main__":
    main()
