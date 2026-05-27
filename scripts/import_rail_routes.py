#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sqlite3
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET


NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


REQUIRED_COLUMNS = {
    "route_category",
    "start_lat",
    "start_lon",
    "end_lat",
    "end_lon",
    "length_kp",
    "calculation_basis",
    "is_active",
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


def normalize_route_code(value: object) -> str:
    text = clean(value)
    if re.fullmatch(r"\d+(\.0+)?", text):
        return f"{int(float(text)):02d}"
    return text


def active_flag(value: object) -> int:
    text = clean(value).lower()
    if text in {"0", "n", "no", "false", "미사용", "폐지", "사용안함"}:
        return 0
    return 1


def read_shared_strings(zf: ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(t.text or "" for t in si.findall(".//a:t", NS)) for si in root.findall("a:si", NS)]


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


def load_route_rows(xlsx_path: Path) -> list[dict]:
    with ZipFile(xlsx_path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_root = ET.fromstring(zf.read(first_sheet_path(zf)))
        rows = sheet_root.findall("a:sheetData/a:row", NS)

        header_idx = None
        header: list[str] = []
        for idx, row in enumerate(rows):
            values = row_values(row, shared_strings)
            if "노선코드" in values and "노선명" in values and "노선길이(KP)" in values:
                header_idx = idx
                header = values
                break
        if header_idx is None:
            raise RuntimeError("Could not find header row containing 노선코드/노선명/노선길이(KP)")

        result: list[dict] = []
        for row in rows[header_idx + 1 :]:
            values = row_values(row, shared_strings)
            record = {
                header[i]: values[i] if i < len(values) else ""
                for i in range(len(header))
                if clean(header[i])
            }
            route_code = normalize_route_code(record.get("노선코드"))
            if not route_code:
                continue
            record["_route_code"] = route_code
            result.append(record)
        return result


def ensure_tables(conn: sqlite3.Connection) -> None:
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = 'rail_routes'"
        ).fetchone()
        is None
    ):
        raise RuntimeError("Missing table: rail_routes. Run Alembic upgrade first.")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(rail_routes)")}
    missing = REQUIRED_COLUMNS - columns
    if missing:
        raise RuntimeError(f"rail_routes is missing columns: {', '.join(sorted(missing))}. Run Alembic upgrade first.")


def import_rows(
    conn: sqlite3.Connection,
    rows: list[dict],
    source_file: str,
    mark_missing_inactive: bool,
) -> dict:
    ensure_tables(conn)
    seen_codes = set()
    inserted_or_updated = 0
    inactive_from_file = 0

    for row in rows:
        route_code = row["_route_code"]
        is_active = active_flag(row.get("사용유무"))
        seen_codes.add(route_code)
        if not is_active:
            inactive_from_file += 1

        conn.execute(
            """
            INSERT INTO rail_routes (
                korail_route_code,
                route_category,
                name,
                start_station_code,
                start_station_name,
                start_kp,
                start_lat,
                start_lon,
                end_station_code,
                end_station_name,
                end_kp,
                end_lat,
                end_lon,
                station_point_count,
                length_kp,
                calculation_basis,
                is_active,
                source_file
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(korail_route_code) DO UPDATE SET
                route_category=excluded.route_category,
                name=excluded.name,
                start_station_code=excluded.start_station_code,
                start_station_name=excluded.start_station_name,
                start_kp=excluded.start_kp,
                start_lat=excluded.start_lat,
                start_lon=excluded.start_lon,
                end_station_code=excluded.end_station_code,
                end_station_name=excluded.end_station_name,
                end_kp=excluded.end_kp,
                end_lat=excluded.end_lat,
                end_lon=excluded.end_lon,
                station_point_count=excluded.station_point_count,
                length_kp=excluded.length_kp,
                calculation_basis=excluded.calculation_basis,
                is_active=excluded.is_active,
                source_file=excluded.source_file,
                imported_at=CURRENT_TIMESTAMP
            """,
            (
                route_code,
                clean(row.get("노선구분")) or None,
                clean(row.get("노선명")),
                clean(row.get("시작역코드")) or None,
                clean(row.get("시작역명")) or None,
                number(row.get("시작역KP")),
                number(row.get("시작위도")),
                number(row.get("시작경도")),
                clean(row.get("종료역코드")) or None,
                clean(row.get("종료역명")) or None,
                number(row.get("종료역KP")),
                number(row.get("종료위도")),
                number(row.get("종료경도")),
                integer(row.get("역수")) or 0,
                number(row.get("노선길이(KP)")),
                clean(row.get("산정기준")) or None,
                is_active,
                source_file,
            ),
        )
        inserted_or_updated += 1

    missing_marked_inactive = 0
    if mark_missing_inactive:
        placeholders = ",".join("?" for _ in seen_codes)
        if placeholders:
            missing_marked_inactive = conn.execute(
                f"""
                UPDATE rail_routes
                SET is_active = 0,
                    imported_at = CURRENT_TIMESTAMP
                WHERE korail_route_code NOT IN ({placeholders})
                  AND is_active = 1
                """,
                tuple(sorted(seen_codes)),
            ).rowcount

    conn.commit()
    return {
        "routes_in_file": len(rows),
        "routes_upserted": inserted_or_updated,
        "inactive_from_file": inactive_from_file,
        "missing_marked_inactive": missing_marked_inactive,
        "rail_routes_total": conn.execute("SELECT COUNT(*) FROM rail_routes").fetchone()[0],
        "rail_routes_active": conn.execute("SELECT COUNT(*) FROM rail_routes WHERE is_active = 1").fetchone()[0],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Import final KORAIL route KP list into rail_routes.")
    parser.add_argument("xlsx", type=Path)
    parser.add_argument("--db", type=Path, default=Path("backend/db.sqlite3"))
    parser.add_argument(
        "--mark-missing-inactive",
        action="store_true",
        help="Mark existing rail_routes not present in the XLSX as inactive.",
    )
    args = parser.parse_args()

    rows = load_route_rows(args.xlsx)
    with sqlite3.connect(args.db) as conn:
        result = import_rows(conn, rows, args.xlsx.name, args.mark_missing_inactive)

    print(f"source_file={args.xlsx.name}")
    for key, value in result.items():
        print(f"{key}={value}")


if __name__ == "__main__":
    main()
