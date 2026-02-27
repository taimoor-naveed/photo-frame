from datetime import datetime

from pydantic import BaseModel


class MediaOut(BaseModel):
    id: int
    filename: str
    original_name: str
    media_type: str
    width: int
    height: int
    file_size: int
    duration: float | None = None
    codec: str | None = None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class MediaListOut(BaseModel):
    items: list[MediaOut]
    total: int
    page: int
    per_page: int


class SettingsOut(BaseModel):
    slideshow_interval: int
    transition_type: str
    photo_order: str

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    slideshow_interval: int | None = None
    transition_type: str | None = None
    photo_order: str | None = None
