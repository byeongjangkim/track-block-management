"""
auth_service.py — 차단명령 등록/수정 권한 검증

역할 체계:
  system_superuser → 시스템 관리자: 시스템 설정·사용자 관리 전용. 차단명령 등록/수정 불가.
  block_manager    → 차단명령 관리자: 조직·관할 제한 없이 전국 어디든 차단명령 CRUD 가능.
  org_admin        → 소속 관리자: 소속 조직 관할 구간 내 + 소속 사용자 관리.
  user             → 소속 사용자: can_register=True이면 소속 조직 관할 구간 내 등록/수정 가능.

차단명령 등록 조건:
  block_manager    : 조건 없이 허용 (관할 구간·분야 검증 생략)
  org_admin        : 분야 + 관할 구간 검증
  user(can_register=True): 분야 + 관할 구간 검증
"""

from sqlalchemy.orm import Session

from app.models.organization import OrganizationRouteRange
from app.models.user import User


def can_register_block_order(
    user: User,
    route_id: int,
    start_km: float | None,
    end_km: float | None,
    request_field: str,
    db: Session,
    rail_route_id: int | None = None,
) -> tuple[bool, str]:
    """
    Returns:
        (True, "") — 허용
        (False, reason) — 거부 사유
    """
    # ── system_superuser: 차단명령 등록 불가 ─────────────────────────────
    if user.role == "system_superuser":
        return False, "시스템 관리자는 차단명령을 등록할 수 없습니다"

    # ── block_manager: 전국 무제한 ──────────────────────────────────────
    if user.role == "block_manager":
        return True, ""

    # ── user(can_register=False): 조회 전용 ──────────────────────────────
    if user.role == "user" and not user.can_register:
        return False, "차단명령 등록 권한이 없습니다 (조회 전용)"

    # ── org_admin 또는 user(can_register=True): 분야 + 관할 구간 검증 ────
    user_field = user.field  # None/'all' → 모든 분야 허용

    # 1) 분야 검증
    if user_field and user_field != "all":
        if request_field != user_field:
            return False, f"담당 분야({user_field}) 외 등록 불가 (요청: {request_field})"

    # 2) km이 없는 경우 (전차선 단전 등) — 분야 검증만 통과하면 허용
    if start_km is None or end_km is None:
        return True, ""

    # 3) 구간 검증 — rail_route_id 기준으로 관할 구간 조회
    if rail_route_id is None:
        return False, "관할구간 검증용 노선 정보가 없습니다 (rail_route_id 미설정)"

    target_field = user_field if (user_field and user_field != "all") else "all"

    ranges = db.query(OrganizationRouteRange).filter_by(
        organization_id=user.organization_id,
        rail_route_id=rail_route_id,
        field=target_field,
    ).all()

    # fallback: 분야별 구간이 없으면 'all' 구간 사용
    if not ranges and target_field != "all":
        ranges = db.query(OrganizationRouteRange).filter_by(
            organization_id=user.organization_id,
            rail_route_id=rail_route_id,
            field="all",
        ).all()

    if not ranges:
        return False, "해당 노선에 대한 관할 구간이 없습니다"

    for r in ranges:
        if r.start_km <= start_km and end_km <= r.end_km:
            return True, ""

    allowed = ", ".join(f"{r.start_km}~{r.end_km}km" for r in ranges)
    return False, f"관할 구간({allowed}) 밖의 차단명령은 등록할 수 없습니다"


def can_edit_block_order(user: User, organization_id: int) -> bool:
    """차단명령 수정·삭제 권한:
      - block_manager : 조직 제한 없이 가능
      - org_admin     : 같은 조직 소속이면 가능
      - user(can_register=True): 같은 조직 소속이면 가능
      - system_superuser: 불가
    """
    if user.role == "block_manager":
        return True
    if user.role == "org_admin" and user.organization_id == organization_id:
        return True
    if user.role == "user" and user.can_register and user.organization_id == organization_id:
        return True
    return False


# 하위 호환 alias
def is_owner_or_superuser(user: User, organization_id: int) -> bool:
    return can_edit_block_order(user, organization_id)
