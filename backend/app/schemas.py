from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator


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
    display_filename: str | None = None
    blur_filename: str | None = None
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
    ids: list[Annotated[int, Field(ge=1, le=2**63 - 1)]] = Field(max_length=100)


class BulkDeleteResponse(BaseModel):
    deleted: list[int]
    not_found: list[int]


class SlideshowJumpRequest(BaseModel):
    media_id: Annotated[int, Field(ge=1, le=2**63 - 1)]


class SettingsOut(BaseModel):
    slideshow_interval: int
    transition_type: str

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    slideshow_interval: int | None = Field(default=None, ge=3, le=3600)
    transition_type: Literal["crossfade", "slide", "none"] | None = None

    @model_validator(mode="after")
    def reject_explicit_nulls(self):
        """Reject explicit null values — None is only valid as 'field not sent'."""
        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self
