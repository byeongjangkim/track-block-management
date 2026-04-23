"""
users.py — 사용자 관리 API (system_superuser 전용)

  GET  /users           — 사용자 목록
  GET  /users/{id}      — 사용자 단건
  POST /users           — 사용자 생성
  PUT  /users/{id}      — 사용자 수정 (역할·분야·조직·비밀번호)
  DELETE /users/{id}    — 사용자 비활성화 (물리 삭제 아님)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_superuser
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User

router = APIRouter(prefix="/users", tags=["사용자 관리"])

VALID_ROLES = {"system_superuser", "org_admin", "user"}
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
    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str
    role: str = "user"
    field: str | None = None          # None/'all': 모든 분야
    organization_id: int | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"role은 {VALID_ROLES} 중 하나여야 합니다")
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
    field: str | None = None          # 빈 문자열로 보내면 None 처리
    organization_id: int | None = None
    password: str | None = None       # 설정 시 비밀번호 변경
    is_active: bool | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_ROLES:
            raise ValueError(f"role은 {VALID_ROLES} 중 하나여야 합니다")
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
    )


# ── 목록 ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    users = db.query(User).order_by(User.id).all()
    return [_to_response(u, db) for u in users]


# ── 단건 조회 ─────────────────────────────────────────────────────────────────

@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")
    return _to_response(user, db)


# ── 생성 ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_superuser),
):
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"아이디 '{body.username}' 이미 사용 중")

    # org_admin/user는 organization_id 필수
    if body.role in ("org_admin", "user") and body.organization_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="org_admin/user는 소속 조직이 필요합니다")

    # organization_id 유효성 확인
    if body.organization_id is not None:
        if not db.query(Organization).filter(Organization.id == body.organization_id).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="존재하지 않는 조직입니다")

    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=body.role,
        field=body.field if body.field != "all" else None,
        organization_id=body.organization_id,
        is_active=True,
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
    current_superuser: User = Depends(require_superuser),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")

    # 자기 자신의 role/is_active 변경 방지
    if user.id == current_superuser.id:
        if body.role is not None and body.role != user.role:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="자신의 역할은 변경할 수 없습니다")
        if body.is_active is not None and not body.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="자신을 비활성화할 수 없습니다")

    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if "field" in body.model_fields_set:
        user.field = body.field if (body.field and body.field != "all") else None
    if "organization_id" in body.model_fields_set:
        if body.organization_id is not None:
            if not db.query(Organization).filter(Organization.id == body.organization_id).first():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="존재하지 않는 조직입니다")
        user.organization_id = body.organization_id
    if body.password is not None and body.password.strip():
        user.hashed_password = hash_password(body.password)
    if body.is_active is not None:
        user.is_active = body.is_active

    db.commit()
    db.refresh(user)
    return _to_response(user, db)


# ── 비활성화 ─────────────────────────────────────────────────────────────────

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_superuser: User = Depends(require_superuser),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")
    if user.id == current_superuser.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="자신을 비활성화할 수 없습니다")
    user.is_active = False
    db.commit()
