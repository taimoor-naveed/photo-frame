from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Media(Base):
    __tablename__ = "media"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    original_name: Mapped[str] = mapped_column(String, nullable=False)
    media_type: Mapped[str] = mapped_column(String, nullable=False)  # 'photo' or 'video'
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)  # seconds, video only
    codec: Mapped[str | None] = mapped_column(String, nullable=True)  # video codec
    thumb_filename: Mapped[str] = mapped_column(String, nullable=False)
    transcoded_filename: Mapped[str | None] = mapped_column(String, nullable=True)
    processing_status: Mapped[str] = mapped_column(
        String, nullable=False, default="ready"
    )  # "processing" | "ready" | "error"
    content_hash: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)
    )


class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    slideshow_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    transition_type: Mapped[str] = mapped_column(String, nullable=False, default="crossfade")
    photo_order: Mapped[str] = mapped_column(String, nullable=False, default="random")
