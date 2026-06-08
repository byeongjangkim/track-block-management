from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    username: str
    full_name: str
    role: str                        # 'system_superuser' | 'org_admin' | 'user'
    field: str | None                # None/'all': 모든 분야, '시설'/'전기'/… : 해당 분야만
    organization_id: int | None
    organization_name: str | None    # organizations.name (조인 후 채움)
    can_register: bool = False       # 차단명령 등록 권한 (org_admin=항상True, user=관리자 부여)

    model_config = {"from_attributes": True}
