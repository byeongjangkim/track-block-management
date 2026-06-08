from typing import Generator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import decode_access_token
from app.models.user import User

bearer_scheme = HTTPBearer()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    username = decode_access_token(token)
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="토큰이 유효하지 않습니다")

    user = db.query(User).filter(User.username == username, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다")
    return user


def require_org_admin(current_user: User = Depends(get_current_user)) -> User:
    """기준정보 관리 등: org_admin / block_manager / system_superuser 허용."""
    if current_user.role not in ("org_admin", "block_manager", "system_superuser"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다")
    return current_user


def require_superuser(current_user: User = Depends(get_current_user)) -> User:
    """시스템 설정 전용: system_superuser만 허용."""
    if current_user.role != "system_superuser":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="시스템 관리자 권한이 필요합니다")
    return current_user


def require_user_admin(current_user: User = Depends(get_current_user)) -> User:
    """사용자 관리: system_superuser(전체) 또는 org_admin(소속 조직 한정)."""
    if current_user.role not in ("system_superuser", "org_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="사용자 관리 권한이 없습니다")
    return current_user
