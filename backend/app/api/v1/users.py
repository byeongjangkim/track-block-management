"""
users.py — 사용자 관리 API

역할별 접근 권한:
  system_superuser : 모든 사용자 CRUD (전체 역할·조직 가능)
  org_admin        : 소속 조직의 org_admin·user만 관리 (다른 역할 생성 불가)
  block_manager/user: 접근 불가

  GET  /users           — 사용자 목록
  GET  /users/{id}      — 사용자 단건
  POST /users           — 사용자 생성
  PUT  /users/{id}      — 사용자 수정
  DELETE /users/{id}    — 사용자 비활성화
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_user_admin
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User

router = APIRouter(prefix="/users", tags=["사용자 관리"])

# system_superuser가 생성/수정할 수 있는 전체 역할
ALL_ROLES = {"system_superuser", "block_manager", "org_admin", "user"}
# org_admin이 자기 조직 내에서 생성/수정할 수 있는 역할
ORG_MANAGEABLE_ROLES = {"org_admin", "user"}

VALID_FIELDS = {"all", "시설", "전기", "건축", None}


# ── 스키마 ────────────────────────────────────────────────────────────────────

class UserResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    field: str | None
    organization_id: int | None
    organization_name: str | None
    is_active: bool
    can_register: bool = False
    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str
    role: str = "user"
    field: str | None = None
    organization_id: int | None = None
    can_register: bool = False

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ALL_ROLES:
            raise ValueError(f"role은 {ALL_ROLES} 중 하나여야 합니다")
        return v

    @field_validator("field")
    @classmethod
    def validate_field(cls, v: str | None) -> str | None:
        if v not in VALID_FIELDS:
            raise ValueError(f"field는 {VALID_FIELDS} 중 하나여야 합니다")
        return v


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    field: str | None = None
    organization_id: int | None = None
    password: str | None = None
    is_active: bool | None = None
    can_register: bool | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str | None) -> str | None:
        if v is not None and v not in ALL_ROLES:
            raise ValueError(f"role은 {ALL_ROLES} 중 하나여야 합니다")
        return v


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _to_response(user: User, db: Session) -> UserResponse:
    org_name = None
    if user.organization_id:
        org = db.query(Organization).filter(Organization.id == user.organization_id).first()
        org_name = org.name if org else None
    return UserResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        field=user.field,
        organization_id=user.organization_id,
        organization_name=org_name,
        is_active=user.is_active,
        can_register=user.can_register,
    )


def _effective_can_register(role: str, can_register: bool) -> bool:
    """역할별 can_register 확정값: org_admin·block_manager는 항상 True, superuser는 False."""
    if role in ("org_admin", "block_manager"):
        return True
    if role == "system_superuser":
        return False
    return can_register  # user 역할만 파라미터 그대로


def _check_org_admin_scope(current_user: User, target_org_id: int | None, target_role: str | None, db: Session) -> None:
    """org_admin이 허용 범위 밖의 작업을 시도할 때 예외를 발생시킨다."""
    if current_user.role != "org_admin":
        return
    # org_admin은 자기 조직 사용자만 관리 가능
    if target_org_id is not None and target_org_id != current_user.organization_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="소속 조직 외의 사용자는 관리할 수 없습니다")
    # org_admin은 system_superuser/block_manager 역할 생성/변경 불가
    if target_role and target_role not in ORG_MANAGEABLE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="시스템 관리자·차단명령 관리자 역할은 부여할 수 없습니다")


# ── 목록 ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user_admin),
):
    if current_user.role == "system_superuser":
        users = db.query(User).order_by(User.id).all()
    else:
        # org_admin: 자기 조직 사용자만
        users = db.query(User).filter(
            User.organization_id == current_user.organization_id
        ).order_by(User.id).all()
    return [_to_response(u, db) for u in users]


# ── 단건 조회 ─────────────────────────────────────────────────────────────────

@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")
    if current_user.role == "org_admin" and user.organization_id != current_user.organization_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="소속 조직 외의 사용자는 조회할 수 없습니다")
    return _to_response(user, db)


# ── 생성 ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user_admin),
):
    # org_admin 권한 범위 검증
    effective_org_id = body.organization_id
    if current_user.role == "org_admin":
        # org_admin은 자기 조직에만, org_admin/user 역할만 생성 가능
        effective_org_id = current_user.organization_id  # 강제 설정
        _check_org_admin_scope(current_user, effective_org_id, body.role, db)

    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"아이디 '{body.username}' 이미 사용 중")

    # org_admin/user는 organization_id 필수
    if body.role in ("org_admin", "user") and effective_org_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="소속 관리자/소속 사용자는 소속 조직이 필요합니다")

    if effective_org_id is not None:
        if not db.query(Organization).filter(Organization.id == effective_org_id).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="존재하지 않는 조직입니다")

    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=body.role,
        field=body.field if body.field != "all" else None,
        organization_id=effective_org_id,
        is_active=True,
        can_register=_effective_can_register(body.role, body.can_register),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_response(user, db)


# ── 수정 ─────────────────────────────────────────────────────────────────────

@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    body: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")

    # org_admin 권한 범위 검증
    if current_user.role == "org_admin":
        if user.organization_id != current_user.organization_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="소속 조직 외의 사용자는 수정할 수 없습니다")
        # org_admin은 system_superuser/block_manager 계정 수정 불가
        if user.role not in ORG_MANAGEABLE_ROLES:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="해당 역할의 사용자는 수정할 수 없습니다")
        _check_org_admin_scope(current_user, None, body.role, db)

    # 자기 자신 보호
    if user.id == current_user.id:
        if body.role is not None and body.role != user.role:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="자신의 역할은 변경할 수 없습니다")
        if body.is_active is not None and not body.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="자신을 비활성화할 수 없습니다")

    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
        user.can_register = _effective_can_register(body.role, user.can_register)
    if "field" in body.model_fields_set:
        user.field = body.field if (body.field and body.field != "all") else None
    if "organization_id" in body.model_fields_set and current_user.role == "system_superuser":
        if body.organization_id is not None:
            if not db.query(Organization).filter(Organization.id == body.organization_id).first():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="존재하지 않는 조직입니다")
        user.organization_id = body.organization_id
    if body.password is not None and body.password.strip():
        user.hashed_password = hash_password(body.password)
    if body.is_active is not None:
        user.is_active = body.is_active
    # can_register: user 역할에서만 명시적으로 변경 가능
    if body.can_register is not None and user.role == "user":
        user.can_register = body.can_register

    db.commit()
    db.refresh(user)
    return _to_response(user, db)


# ── 비활성화 ─────────────────────────────────────────────────────────────────

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_user_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="자신을 비활성화할 수 없습니다")
    if current_user.role == "org_admin":
        if user.organization_id != current_user.organization_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="소속 조직 외의 사용자는 비활성화할 수 없습니다")
        if user.role not in ORG_MANAGEABLE_ROLES:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="해당 역할의 사용자는 비활성화할 수 없습니다")
    user.is_active = False
    db.commit()
