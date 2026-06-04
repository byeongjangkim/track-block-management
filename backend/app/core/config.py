from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).parent.parent.parent  # backend/


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg2://localhost/track_block"
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    UPLOAD_DIR: Path = BASE_DIR / "uploads"

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def model_post_init(self, __context) -> None:
        # UPLOAD_DIR이 문자열로 들어올 경우 Path로 변환
        if isinstance(self.UPLOAD_DIR, str):
            object.__setattr__(self, "UPLOAD_DIR", Path(self.UPLOAD_DIR))
        self.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


settings = Settings()
