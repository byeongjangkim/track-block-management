#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sqlite3
import zlib
from collections import Counter
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET


NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

NAME_RENAMES = {
    "디지털시티": "DMC",
    "남동인더스": "남동인더스파크",
}


def clean(value: object) -> str:
    return str(value or "").strip()


def station_name(value: object) -> str:
    name = clean(value)
    return NAME_RENAMES.get(name, name)


def col_to_idx(cell_ref: str | None) -> int | None:
    match = re.match(r"([A-Z]+)", cell_ref or "")
    if not match:
        return None
    n = 0
    for ch in match.group(1):
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_shared_strings(zf: ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(t.text or "" for t in si.findall(".//a:t", NS)) for si in root.findall("a:si", NS)]


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    if cell.get("t") == "s":
        value = cell.find("a:v", NS)
        return shared_strings[int(value.text)] if value is not None and value.text else ""
    if cell.get("t") == "inlineStr":
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
        values[idx] = clean(cell_value(cell, shared_strings))
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


def load_management_rows(xlsx_path: Path) -> list[dict]:
    with ZipFile(xlsx_path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_root = ET.fromstring(zf.read(first_sheet_path(zf)))
        rows = sheet_root.findall("a:sheetData/a:row", NS)
        if not rows:
            return []

        header = row_values(rows[0], shared_strings)
        required = {"지역본부", "관리역", "소속역"}
        if not required.issubset(set(header)):
            raise RuntimeError("Header must contain 지역본부, 관리역, 소속역")

        records: list[dict] = []
        for row in rows[1:]:
            values = row_values(row, shared_strings)
            record = {
                header[i]: values[i] if i < len(values) else ""
                for i in range(len(header))
                if clean(header[i])
            }
            if clean(record.get("지역본부")) and clean(record.get("관리역")):
                record["_source_row"] = int(row.get("r") or 0)
                record["관리역"] = station_name(record["관리역"])
                record["소속역목록"] = [
                    station_name(item)
                    for item in re.split(r"[,，]", clean(record.get("소속역")))
                    if station_name(item)
                ]
                records.append(record)
        return records


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
            (table_name,),
        ).fetchone()
        is not None
    )


def ensure_tables(conn: sqlite3.Connection) -> None:
    required = {"rail_stations", "rail_station_management_groups", "rail_station_management_members"}
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


def generated_station_code(name: str) -> str:
    digest = zlib.crc32(name.encode("utf-8")) & 0xFFFFFFFF
    return f"MGMT_{digest:08X}"


def organization_id(conn: sqlite3.Connection, region_name: str) -> int | None:
    candidates = [region_name]
    if not region_name.endswith("본부"):
        candidates.append(f"{region_name}본부")
    row = conn.execute(
        "SELECT id FROM organizations WHERE name IN ({}) ORDER BY id LIMIT 1".format(
            ",".join("?" for _ in candidates)
        ),
        tuple(candidates),
    ).fetchone()
    return int(row[0]) if row else None


def station_id_by_name(conn: sqlite3.Connection, name: str) -> int | None:
    row = conn.execute("SELECT id FROM rail_stations WHERE name = ? ORDER BY id LIMIT 1", (name,)).fetchone()
    return int(row[0]) if row else None


def ensure_station(
    conn: sqlite3.Connection,
    name: str,
    station_role: str,
    station_type: str,
    source_file: str,
) -> tuple[int, str]:
    existing_id = station_id_by_name(conn, name)
    if existing_id is not None:
        if station_role == "관리역":
            conn.execute(
                """
                UPDATE rail_stations
                   SET station_role='관리역',
                       station_type='관리역',
                       source_file=COALESCE(source_file, ?),
                       imported_at=CURRENT_TIMESTAMP
                 WHERE id=?
                """,
                (source_file, existing_id),
            )
        else:
            conn.execute(
                """
                UPDATE rail_stations
                   SET station_role=COALESCE(station_role, '소속역'),
                       station_type=COALESCE(station_type, '보통역'),
                       source_file=COALESCE(source_file, ?),
                       imported_at=CURRENT_TIMESTAMP
                 WHERE id=?
                   AND COALESCE(station_role, '') <> '관리역'
                """,
                (source_file, existing_id),
            )
        return existing_id, "matched_existing"

    code = generated_station_code(name)
    suffix = 1
    while conn.execute(
        "SELECT 1 FROM rail_stations WHERE station_code = ? AND name <> ?",
        (code, name),
    ).fetchone():
        code = f"{generated_station_code(name)}_{suffix}"
        suffix += 1

    conn.execute(
        """
        INSERT INTO rail_stations (
            station_code, name, lat, lon, station_role, station_type, match_note, source_file
        )
        VALUES (?, ?, NULL, NULL, ?, ?, '소속별 역 현황에서 생성', ?)
        ON CONFLICT(station_code) DO UPDATE SET
            name=excluded.name,
            station_role=excluded.station_role,
            station_type=excluded.station_type,
            source_file=excluded.source_file,
            imported_at=CURRENT_TIMESTAMP
        """,
        (code, name, station_role, station_type, source_file),
    )
    new_id = station_id_by_name(conn, name)
    if new_id is None:
        raise RuntimeError(f"Could not create station: {name}")
    return new_id, "created_from_management_file"


def import_management(conn: sqlite3.Connection, rows: list[dict], source_file: str, replace: bool) -> dict:
    ensure_tables(conn)
    conn.execute("PRAGMA foreign_keys = ON")
    if replace:
        conn.execute("DELETE FROM rail_station_management_members")
        conn.execute("DELETE FROM rail_station_management_groups")

    stats: Counter = Counter()
    manager_names = {station_name(row["관리역"]) for row in rows}

    for row in rows:
        region_name = clean(row["지역본부"])
        manager_name = station_name(row["관리역"])
        source_row = int(row.get("_source_row") or 0)
        org_id = organization_id(conn, region_name)
        manager_id, manager_status = ensure_station(conn, manager_name, "관리역", "관리역", source_file)
        stats[manager_status] += 1

        conn.execute(
            """
            INSERT INTO rail_station_management_groups (
                organization_id, region_name, manager_station_id, manager_station_name,
                source_file, source_row
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(region_name, manager_station_name) DO UPDATE SET
                organization_id=excluded.organization_id,
                manager_station_id=excluded.manager_station_id,
                source_file=excluded.source_file,
                source_row=excluded.source_row,
                imported_at=CURRENT_TIMESTAMP
            """,
            (org_id, region_name, manager_id, manager_name, source_file, source_row),
        )
        group_id = conn.execute(
            """
            SELECT id
              FROM rail_station_management_groups
             WHERE region_name = ?
               AND manager_station_name = ?
            """,
            (region_name, manager_name),
        ).fetchone()[0]

        members = [(manager_name, "관리역", "관리역")]
        members.extend((member, "소속역", "보통역") for member in row["소속역목록"])

        for order, (name, role_in_group, type_in_group) in enumerate(members):
            station_role = "관리역" if name in manager_names else role_in_group
            station_type = "관리역" if name in manager_names else type_in_group
            station_id, match_status = ensure_station(conn, name, station_role, station_type, source_file)
            stats[match_status] += 1
            conn.execute(
                """
                INSERT INTO rail_station_management_members (
                    management_group_id, station_id, station_name, station_role, station_type,
                    match_status, source_order, source_file, source_row
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(management_group_id, station_id) DO UPDATE SET
                    station_name=excluded.station_name,
                    station_role=excluded.station_role,
                    station_type=excluded.station_type,
                    match_status=excluded.match_status,
                    source_order=excluded.source_order,
                    source_file=excluded.source_file,
                    source_row=excluded.source_row,
                    imported_at=CURRENT_TIMESTAMP
                """,
                (
                    group_id,
                    station_id,
                    name,
                    role_in_group,
                    type_in_group,
                    match_status,
                    order,
                    source_file,
                    source_row,
                ),
            )
            stats["management_members"] += 1

    conn.commit()
    stats["management_groups"] = len(rows)
    stats["rail_stations"] = conn.execute("SELECT COUNT(*) FROM rail_stations").fetchone()[0]
    stats["manager_stations"] = conn.execute(
        "SELECT COUNT(*) FROM rail_stations WHERE station_role='관리역'"
    ).fetchone()[0]
    stats["member_stations"] = conn.execute(
        "SELECT COUNT(*) FROM rail_stations WHERE station_role='소속역'"
    ).fetchone()[0]
    return dict(stats)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import station management groups from XLSX into SQLite.")
    parser.add_argument("xlsx", type=Path)
    parser.add_argument("--db", type=Path, default=Path("backend/db.sqlite3"))
    parser.add_argument("--replace", action="store_true", help="Replace existing management groups/members.")
    args = parser.parse_args()

    rows = load_management_rows(args.xlsx)
    with sqlite3.connect(args.db) as conn:
        stats = import_management(conn, rows, args.xlsx.name, args.replace)

    print(f"source_file={args.xlsx.name}")
    print(f"source_rows={len(rows)}")
    for key in sorted(stats):
        print(f"{key}={stats[key]}")


if __name__ == "__main__":
    main()
