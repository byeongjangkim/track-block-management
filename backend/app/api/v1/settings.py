"""
settings.py — 시스템 설정 API

  GET  /settings                       ← 전체 설정 조회 (로그인 사용자)
  GET  /settings/{category}            ← 카테고리별 조회
  PATCH /settings/{category}/{key}     ← 값 변경 (superuser 전용)
  POST  /settings/{category}/{key}/reset ← 기본값 복원 (superuser 전용)
  POST  /settings/reset-all            ← 전체 기본값 복원 (superuser 전용)
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_superuser
from app.models.user import User

router = APIRouter(prefix="/settings", tags=["시스템 설정"])

VALID_CATEGORIES = {'route_colors', 'block_colors', 'danger_colors', 'facility_colors', 'map_settings'}

# 카테고리별 값 검증 함수
def _is_valid_color(value: str) -> bool:
    """#RRGGBB 형식 색상 코드 검증"""
    import re
    return bool(re.match(r'^#[0-9a-fA-F]{6}$', value))

COLOR_CATEGORIES = {'route_colors', 'block_colors', 'danger_colors', 'facility_colors'}

def _is_valid_value(category: str, key: str, value: str) -> tuple[bool, str]:
    """설정 값 유효성 검증. (ok, error_msg) 반환."""
    if category in COLOR_CATEGORIES:
        if not _is_valid_color(value):
            return False, f"색상 코드 형식이 올바르지 않습니다: {value} (#RRGGBB 필요)"
    elif category == 'map_settings':
        if key == 'station_points_mode' and value not in ('center_only', 'all_points'):
            return False, "station_points_mode는 'center_only' 또는 'all_points'여야 합니다"
        if key == 'stroke_cap_zoom':
            try:
                v = float(value)
                if not (2 <= v <= 20):
                    return False, "stroke_cap_zoom은 2~20 범위의 숫자여야 합니다"
            except ValueError:
                return False, "stroke_cap_zoom은 숫자여야 합니다"
    return True, ""


def _rows_to_dict(rows) -> dict:
    """DB 행 목록을 {category: [{key, value, ...}]} 구조로 변환"""
    result: dict = {}
    for row in rows:
        cat = row['category']
        if cat not in result:
            result[cat] = []
        result[cat].append({
            'key':           row['key'],
            'value':         row['value'],
            'default_value': row['default_value'],
            'label':         row['label'],
            'description':   row['description'],
            'sort_order':    row['sort_order'],
            'updated_at':    row['updated_at'],
        })
    return result


@router.get("")
def get_all_settings(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """전체 시스템 설정 조회 (로그인 사용자)"""
    rows = db.execute(
        text("""
            SELECT category, key, value, default_value, label, description, sort_order, updated_at
            FROM system_settings
            ORDER BY category, sort_order, key
        """)
    ).mappings().all()
    return _rows_to_dict(rows)


@router.get("/{category}")
def get_category_settings(
    category: str,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """카테고리별 설정 조회"""
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="존재하지 않는 카테고리입니다")
    rows = db.execute(
        text("""
            SELECT category, key, value, default_value, label, description, sort_order, updated_at
            FROM system_settings
            WHERE category = :category
            ORDER BY sort_order, key
        """),
        {"category": category},
    ).mappings().all()
    return _rows_to_dict(rows).get(category, [])


class SettingUpdate(BaseModel):
    value: str


@router.patch("/{category}/{key}")
def update_setting(
    category: str,
    key: str,
    body: SettingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """설정 값 변경 — system_superuser 전용"""
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="존재하지 않는 카테고리입니다")

    # 값 검증
    ok, err = _is_valid_value(category, key, body.value)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)

    existing = db.execute(
        text("SELECT id FROM system_settings WHERE category = :c AND key = :k"),
        {"c": category, "k": key},
    ).first()
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="해당 설정 항목이 없습니다")

    db.execute(
        text("""
            UPDATE system_settings
            SET value = :value, updated_by = :user_id, updated_at = CURRENT_TIMESTAMP
            WHERE category = :c AND key = :k
        """),
        {"value": body.value, "user_id": current_user.id, "c": category, "k": key},
    )
    db.commit()

    row = db.execute(
        text("SELECT * FROM system_settings WHERE category = :c AND key = :k"),
        {"c": category, "k": key},
    ).mappings().first()
    return dict(row)


@router.post("/{category}/{key}/reset")
def reset_setting(
    category: str,
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """단일 항목 기본값 복원"""
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="존재하지 않는 카테고리입니다")

    existing = db.execute(
        text("SELECT id, default_value FROM system_settings WHERE category = :c AND key = :k"),
        {"c": category, "k": key},
    ).first()
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="해당 설정 항목이 없습니다")

    db.execute(
        text("""
            UPDATE system_settings
            SET value = default_value, updated_by = :user_id, updated_at = CURRENT_TIMESTAMP
            WHERE category = :c AND key = :k
        """),
        {"user_id": current_user.id, "c": category, "k": key},
    )
    db.commit()
    return {"ok": True, "message": f"{category}.{key} 기본값으로 복원되었습니다"}


@router.post("/reset-all")
def reset_all_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """전체 설정 기본값 복원"""
    db.execute(
        text("""
            UPDATE system_settings
            SET value = default_value, updated_by = :user_id, updated_at = CURRENT_TIMESTAMP
        """),
        {"user_id": current_user.id},
    )
    db.commit()
    return {"ok": True, "message": "모든 설정이 기본값으로 복원되었습니다"}
