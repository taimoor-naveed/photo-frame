from datetime import datetime

from typing import Literal

from pydantic import BaseModel, Field


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
    thumb_filename: str
    transcoded_filename: str | None = None
    processing_status: str = "ready"
    content_hash: str | None = None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class MediaListOut(BaseModel):
    items: list[MediaOut]
    total: int
    page: int
    per_page: int


class BulkDeleteRequest(BaseModel):
    ids: list[int]


class BulkDeleteResponse(BaseModel):
    deleted: list[int]
    not_found: list[int]


class SettingsOut(BaseModel):
    slideshow_interval: int
    transition_type: str

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    slideshow_interval: int | None = Field(default=None, ge=3, le=3600)
    transition_type: Literal["crossfade", "slide", "none"] | None = None
