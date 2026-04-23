"""
geometry_service.py — 노선도 geometry CSV 파싱 및 source='user' DB 저장

CSV 컬럼:
  필수: lat, lon
  선택: segment (없으면 0), km (없으면 NULL)

모든 데이터는 lod='high' 단일 레이어로 저장한다.
"""

from __future__ import annotations

import csv
import io

from sqlalchemy import text
from sqlalchemy.orm import Session


def parse_geometry_csv(text_data: str) -> tuple[list[dict], list[str]]:
    """
    CSV 텍스트 파싱 → rows 목록 반환.

    필수 컬럼: lat, lon
    선택 컬럼:
      - segment   : 없으면 0
      - seq       : 없으면 segment별 행 순서 자동 부여
      - km        : 없으면 NULL
      - km_interval: 무시 (이전 버전 호환)

    rows: [{segment, seq, lat, lon, km}, ...]
    """
    rows: list[dict] = []
    errors: list[str] = []
    reader = csv.DictReader(io.StringIO(text_data))
    seg_counter: dict[int, int] = {}

    for i, raw in enumerate(reader, start=2):
        first_val = next(iter(raw.values()), "").strip()
        if first_val.startswith("#"):
            continue

        try:
            lat = float(raw["lat"])
            lon = float(raw["lon"])
        except (KeyError, ValueError, TypeError) as e:
            errors.append(f"행 {i}: {e}")
            continue

        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            errors.append(f"행 {i}: 좌표 범위 초과 (lat={lat}, lon={lon})")
            continue

        try:
            segment = int(raw.get("segment") or 0)
        except (ValueError, TypeError):
            segment = 0

        seg_raw = raw.get("seq", "").strip()
        if seg_raw:
            try:
                seq = int(seg_raw)
            except (ValueError, TypeError):
                seq = seg_counter.get(segment, 0)
                seg_counter[segment] = seq + 1
        else:
            seq = seg_counter.get(segment, 0)
            seg_counter[segment] = seq + 1

        km: float | None = None
        km_raw = raw.get("km", "").strip()
        if km_raw:
            try:
                v = float(km_raw)
                if v >= 0:
                    km = v
            except (ValueError, TypeError):
                pass

        rows.append({"segment": segment, "seq": seq, "lat": lat, "lon": lon, "km": km})

    return rows, errors


def save_geometry(db: Session, route_code: str, rows: list[dict]) -> int:
    """
    rows를 source='user', lod='high' 로 저장.
    기존 user 데이터 전체 삭제 후 재저장.
    반환: 저장된 행 수
    """
    db.execute(
        text("DELETE FROM route_geometry WHERE route_code=:code AND source='user'"),
        {"code": route_code},
    )

    if not rows:
        db.commit()
        return 0

    db.execute(
        text("""
            INSERT INTO route_geometry (route_code, source, lod, segment, seq, lat, lon, km)
            VALUES (:code, 'user', 'high', :segment, :seq, :lat, :lon, :km)
        """),
        [{"code": route_code, **r} for r in rows],
    )
    db.commit()
    return len(rows)
