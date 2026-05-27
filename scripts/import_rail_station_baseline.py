#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import re

from rebuild_rail_baseline_points import rebuild_station_baseline


NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

NAME_RENAMES = {
    "디지털시티": "DMC",
    "남동인더스": "남동인더스파크",
}


def col_to_idx(cell_ref: str | None) -> int | None:
    match = re.match(r"([A-Z]+)", cell_ref or "")
    if not match:
        return None
    n = 0
    for ch in match.group(1):
        n = n * 26 + ord(ch) - 64
    return n - 1


def clean(value: object) -> str:
    return str(value or "").strip()


def station_name(value: object) -> str:
    name = clean(value)
    return NAME_RENAMES.get(name, name)


def number(value: object) -> float | None:
    text = clean(value).replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def integer(value: object) -> int | None:
    n = number(value)
    if n is None:
        return None
    return int(n)


def read_shared_strings(zf: ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    strings: list[str] = []
    for si in root.findall("a:si", NS):
        strings.append("".join(t.text or "" for t in si.findall(".//a:t", NS)))
    return strings


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.get("t")
    if cell_type == "s":
        value = cell.find("a:v", NS)
        if value is None or value.text is None:
            return ""
        return shared_strings[int(value.text)]
    if cell_type == "inlineStr":
        return "".join(t.text or "" for t in cell.findall(".//a:t", NS))
    value = cell.find("a:v", NS)
    return value.text if value is not None and value.text is not None else ""


def row_values(row: ET.Element, shared_strings: list[str]) -> list[str]:
    values: list[str] = []
    for cell in row.findall("a:c", NS):
        idx = col_to_idx(cell.get("r"))
        if idx is None:
            continue
        while len(values) <= idx:
            values.append("")
        values[idx] = cell_value(cell, shared_strings)
    return values


def first_sheet_path(zf: ZipFile) -> str:
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.get("Id"): rel.get("Target") for rel in rels.findall("rel:Relationship", REL_NS)}
    sheet = workbook.find("a:sheets/a:sheet", NS)
    if sheet is None:
        raise RuntimeError("XLSX contains no worksheet")
    rid = sheet.get(f"{{{R_NS}}}id")
    target = rel_map.get(rid)
    if not target:
        raise RuntimeError("Could not resolve first worksheet path")
    return "xl/" + target.lstrip("/") if not target.startswith("xl/") else target


def load_station_rows(xlsx_path: Path) -> tuple[list[dict], Counter]:
    with ZipFile(xlsx_path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_root = ET.fromstring(zf.read(first_sheet_path(zf)))
        rows = sheet_root.findall("a:sheetData/a:row", NS)

        header_idx = None
        header: list[str] = []
        for idx, row in enumerate(rows):
            values = row_values(row, shared_strings)
            if "노선코드" in values and "역코드" in values:
                header_idx = idx
                header = values
                break
        if header_idx is None:
            raise RuntimeError("Could not find header row containing 노선코드/역코드")

        included: list[dict] = []
        stats: Counter = Counter()
        for row in rows[header_idx + 1 :]:
            values = row_values(row, shared_strings)
            record = {
                header[i]: values[i] if i < len(values) else ""
                for i in range(len(header))
                if clean(header[i])
            }
            if not clean(record.get("노선코드")):
                continue

            lat = number(record.get("위도(역중심)"))
            lon = number(record.get("경도(역중심)"))
            center_kp = number(record.get("역중심 KP"))
            has_coordinate = lat is not None and lon is not None
            if not has_coordinate and center_kp is None:
                stats["skipped_no_coordinate_and_no_center_kp"] += 1
                continue

            stats["included"] += 1
            if has_coordinate and center_kp is not None:
                stats["included_coordinate_with_center_kp"] += 1
            elif has_coordinate:
                stats["included_coordinate_without_center_kp"] += 1
            else:
                stats["included_center_kp_without_coordinate"] += 1

            record["_source_row"] = integer(row.get("r"))
            record["_lat"] = lat
            record["_lon"] = lon
            record["_center_kp"] = center_kp
            record["_yard_start_kp"] = number(record.get("역구내선 시작KP"))
            record["_yard_end_kp"] = number(record.get("역구내선 종료KP"))
            included.append(record)

        return included, stats


def ensure_tables(conn: sqlite3.Connection) -> None:
    required = {"rail_routes", "rail_stations", "rail_route_station_points"}
    existing = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ({})".format(
                ",".join("?" for _ in required)
            ),
            tuple(required),
        )
    }
    missing = required - existing
    if missing:
        raise RuntimeError(f"Missing tables: {', '.join(sorted(missing))}. Run Alembic upgrade first.")


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
            (table_name,),
        ).fetchone()
        is not None
    )


def same_coord(a: dict, b: dict) -> bool:
    if a["_lat"] is None or a["_lon"] is None or b["_lat"] is None or b["_lon"] is None:
        return True
    return round(a["_lat"], 7) == round(b["_lat"], 7) and round(a["_lon"], 7) == round(b["_lon"], 7)


def rebuild_station_center_baseline(conn: sqlite3.Connection) -> int | None:
    if not table_exists(conn, "rail_baseline_points"):
        return None
    conn.execute("DELETE FROM rail_baseline_points")
    conn.execute(
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
        SELECT
            rail_route_id,
            0 AS segment_no,
            ROW_NUMBER() OVER (
                PARTITION BY rail_route_id
                ORDER BY route_sequence_no IS NULL, route_sequence_no, center_kp, point_id
            ) AS seq,
            center_kp AS kp,
            lat,
            lon,
            'station_center' AS point_type,
            'rail_route_station_point' AS source_type,
            point_id AS source_id,
            station_id,
            1 AS is_interpolation_anchor,
            1 AS is_render_anchor,
            NULL AS note
        FROM (
            SELECT
                p.id AS point_id,
                p.rail_route_id,
                p.station_id,
                p.route_sequence_no,
                p.center_kp,
                s.lat,
                s.lon
            FROM rail_route_station_points p
            JOIN rail_stations s ON s.id = p.station_id
            WHERE p.center_kp IS NOT NULL
              AND p.is_baseline_anchor = 1
              AND s.lat IS NOT NULL
              AND s.lon IS NOT NULL
        ) station_centers
        """
    )
    return int(conn.execute("SELECT COUNT(*) FROM rail_baseline_points").fetchone()[0])


def route_sort_key(row: dict) -> tuple[int, int]:
    seq = integer(row.get("노선역 구성순번"))
    source_row = int(row.get("_source_row") or 0)
    return (seq if seq is not None else 10**12, source_row)


def import_rows(conn: sqlite3.Connection, rows: list[dict], source_file: str, replace: bool) -> dict:
    ensure_tables(conn)
    conn.execute("PRAGMA foreign_keys = ON")
    if replace:
        if table_exists(conn, "rail_station_management_members"):
            conn.execute("DELETE FROM rail_station_management_members")
        if table_exists(conn, "rail_station_management_groups"):
            conn.execute("DELETE FROM rail_station_management_groups")
        if table_exists(conn, "rail_baseline_points"):
            conn.execute("DELETE FROM rail_baseline_points")
        conn.execute("DELETE FROM rail_route_station_points")
        conn.execute("DELETE FROM rail_routes")
        conn.execute("DELETE FROM rail_stations")

    routes_by_code: dict[str, list[dict]] = defaultdict(list)
    stations_by_code: dict[str, dict] = {}
    coord_conflicts = 0

    for row in rows:
        routes_by_code[clean(row["노선코드"])].append(row)
        station_code = clean(row["역코드"])
        previous = stations_by_code.get(station_code)
        if previous:
            if not same_coord(previous, row):
                coord_conflicts += 1
            if previous["_lat"] is None and row["_lat"] is not None:
                stations_by_code[station_code] = row
            continue
        stations_by_code[station_code] = row

    route_ids: dict[str, int] = {}
    station_ids: dict[str, int] = {}

    for route_code, route_rows in sorted(routes_by_code.items()):
        ordered = sorted(route_rows, key=route_sort_key)
        center_kps = [r["_center_kp"] for r in ordered if r["_center_kp"] is not None]
        start = ordered[0]
        end = ordered[-1]
        conn.execute(
            """
            INSERT INTO rail_routes (
                korail_route_code, name, start_station_code, start_station_name,
                end_station_code, end_station_name, start_kp, end_kp,
                station_point_count, source_file
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(korail_route_code) DO UPDATE SET
                name=excluded.name,
                start_station_code=excluded.start_station_code,
                start_station_name=excluded.start_station_name,
                end_station_code=excluded.end_station_code,
                end_station_name=excluded.end_station_name,
                start_kp=excluded.start_kp,
                end_kp=excluded.end_kp,
                station_point_count=excluded.station_point_count,
                source_file=excluded.source_file,
                imported_at=CURRENT_TIMESTAMP
            """,
            (
                route_code,
                clean(start["노선명"]),
                clean(start["역코드"]),
                station_name(start["역명"]),
                clean(end["역코드"]),
                station_name(end["역명"]),
                min(center_kps) if center_kps else None,
                max(center_kps) if center_kps else None,
                len(ordered),
                source_file,
            ),
        )
        route_ids[route_code] = conn.execute(
            "SELECT id FROM rail_routes WHERE korail_route_code = ?", (route_code,)
        ).fetchone()[0]

    for station_code, row in sorted(stations_by_code.items()):
        conn.execute(
            """
            INSERT INTO rail_stations (
                station_code, name, lat, lon, station_role, station_type, match_note, source_file
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(station_code) DO UPDATE SET
                name=excluded.name,
                lat=excluded.lat,
                lon=excluded.lon,
                station_role=COALESCE(rail_stations.station_role, excluded.station_role),
                station_type=COALESCE(rail_stations.station_type, excluded.station_type),
                match_note=excluded.match_note,
                source_file=excluded.source_file,
                imported_at=CURRENT_TIMESTAMP
            """,
            (
                station_code,
                station_name(row["역명"]),
                row["_lat"],
                row["_lon"],
                None,
                None,
                clean(row.get("매칭비고")) or None,
                source_file,
            ),
        )
        station_ids[station_code] = conn.execute(
            "SELECT id FROM rail_stations WHERE station_code = ?", (station_code,)
        ).fetchone()[0]

    for row in rows:
        route_id = route_ids[clean(row["노선코드"])]
        station_id = station_ids[clean(row["역코드"])]
        center_kp = row["_center_kp"]
        conn.execute(
            """
            INSERT INTO rail_route_station_points (
                rail_route_id, station_id, route_sequence_no, center_kp,
                yard_start_kp, yard_end_kp, main_track_speed, side_track_speed,
                functional_location_no, plant_code, regional_org,
                distance_from_prev, direction_distance, is_baseline_anchor,
                match_note, source_row, source_file
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(rail_route_id, station_id) DO UPDATE SET
                route_sequence_no=excluded.route_sequence_no,
                center_kp=excluded.center_kp,
                yard_start_kp=excluded.yard_start_kp,
                yard_end_kp=excluded.yard_end_kp,
                main_track_speed=excluded.main_track_speed,
                side_track_speed=excluded.side_track_speed,
                functional_location_no=excluded.functional_location_no,
                plant_code=excluded.plant_code,
                regional_org=excluded.regional_org,
                distance_from_prev=excluded.distance_from_prev,
                direction_distance=excluded.direction_distance,
                is_baseline_anchor=excluded.is_baseline_anchor,
                match_note=excluded.match_note,
                source_row=excluded.source_row,
                source_file=excluded.source_file,
                imported_at=CURRENT_TIMESTAMP
            """,
            (
                route_id,
                station_id,
                integer(row.get("노선역 구성순번")),
                center_kp,
                row["_yard_start_kp"],
                row["_yard_end_kp"],
                number(row.get("본선 최고속도")),
                number(row.get("측선 최고속도")),
                clean(row.get("기능위치번호")) or None,
                clean(row.get("플랜트코드")) or None,
                clean(row.get("지역본부")) or None,
                number(row.get("노선전역간 거리")),
                number(row.get("방향기준역간 거리")),
                1 if center_kp is not None and row["_lat"] is not None and row["_lon"] is not None else 0,
                clean(row.get("매칭비고")) or None,
                row.get("_source_row"),
                source_file,
            ),
        )

    baseline_counts = rebuild_station_baseline(conn) if table_exists(conn, "rail_baseline_points") else None
    conn.commit()
    return {
        "routes": len(routes_by_code),
        "stations": len(stations_by_code),
        "points": len(rows),
        "coord_conflicts": coord_conflicts,
        "baseline_points": baseline_counts["total"] if baseline_counts else None,
        "baseline_counts": baseline_counts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Import KORAIL station/KP baseline from XLSX into SQLite.")
    parser.add_argument("xlsx", type=Path)
    parser.add_argument("--db", type=Path, default=Path("backend/db.sqlite3"))
    parser.add_argument("--replace", action="store_true", help="Replace existing rail baseline tables before import.")
    args = parser.parse_args()

    rows, stats = load_station_rows(args.xlsx)
    with sqlite3.connect(args.db) as conn:
        result = import_rows(conn, rows, args.xlsx.name, args.replace)

    print(f"source_file={args.xlsx.name}")
    print(f"included_rows={stats['included']}")
    print(f"included_with_center_kp={stats['included_coordinate_with_center_kp']}")
    print(f"included_coordinate_without_center_kp={stats['included_coordinate_without_center_kp']}")
    print(f"included_center_kp_without_coordinate={stats['included_center_kp_without_coordinate']}")
    print(f"skipped_no_coordinate_and_no_center_kp={stats['skipped_no_coordinate_and_no_center_kp']}")
    print(f"rail_routes={result['routes']}")
    print(f"rail_stations={result['stations']}")
    print(f"rail_route_station_points={result['points']}")
    if result["baseline_points"] is not None:
        print(f"rail_baseline_points={result['baseline_points']}")
        for point_type in ("station_center", "station_yard_start", "station_yard_end"):
            print(f"rail_baseline_points_{point_type}={result['baseline_counts'].get(point_type, 0)}")
    print(f"station_coordinate_conflicts={result['coord_conflicts']}")


if __name__ == "__main__":
    main()
