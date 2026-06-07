"""
auth_service.py — 차단명령 등록 권한 검증

검증 조건 (모두 만족해야 등록 가능):
  1. 역할(role): org_admin 이상
  2. 분야(field): 사용자 담당 분야와 요청 분야 일치 (또는 사용자가 all/None)
  3. 구간(km):   사용자 조직의 관할 구간 내에 완전히 포함

역할별 규칙:
  - system_superuser : 조건 없이 허용
  - org_admin + field=None/'all' : 분야 무관, 관할 km 범위 내 허용
  - org_admin + field='시설' 등  : 해당 분야만, 관할 km 범위 내 허용
  - user : 등록 불가
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
    # ── system_superuser: 무제한 ───────────────────────────────────────────
    if user.role == "system_superuser":
        return True, ""

    # ── user: 등록 불가 ────────────────────────────────────────────────────
    if user.role != "org_admin":
        return False, "차단명령 등록 권한이 없습니다 (조회 전용)"

    # ── org_admin: 분야 + 구간 검증 ───────────────────────────────────────
    user_field = user.field  # None 또는 'all' → 모든 분야 허용

    # 1) 분야 검증
    if user_field and user_field != "all":
        if request_field != user_field:
            return False, f"담당 분야({user_field}) 외 등록 불가 (요청: {request_field})"

    # 2) km이 없는 경우 (전차선 단전 등) — 분야 검증만 통과하면 허용
    if start_km is None or end_km is None:
        return True, ""

    # 3) 구간 검증 — 사용자 분야에 맞는 관할 구간 조회 (rail_route_id 기준)
    #    우선순위: 분야별 구간 → 없으면 'all' 구간 fallback
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

    # 요청 구간이 관할 구간 내에 완전히 포함되는지 확인
    for r in ranges:
        if r.start_km <= start_km and end_km <= r.end_km:
            return True, ""

    # 어떤 구간에도 포함되지 않음
    allowed = ", ".join(f"{r.start_km}~{r.end_km}km" for r in ranges)
    return False, f"관할 구간({allowed}) 밖의 차단명령은 등록할 수 없습니다"


def is_owner_or_superuser(user: User, organization_id: int) -> bool:
    """수정·삭제 권한: 등록한 조직의 org_admin 또는 system_superuser"""
    if user.role == "system_superuser":
        return True
    if user.role == "org_admin" and user.organization_id == organization_id:
        return True
    return False
