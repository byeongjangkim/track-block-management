from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db_session():
    """스크립트에서 직접 DB 세션을 사용할 때 활용."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
