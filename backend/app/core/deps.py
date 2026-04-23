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
    """org_admin 이상 접근 허용. 세부 분야·구간 검증은 서비스 레이어에서 수행."""
    if current_user.role not in ("org_admin", "system_superuser"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다")
    return current_user


def require_superuser(current_user: User = Depends(get_current_user)) -> User:
    """system_superuser 전용."""
    if current_user.role != "system_superuser":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="최상위 관리자 권한이 필요합니다")
    return current_user
