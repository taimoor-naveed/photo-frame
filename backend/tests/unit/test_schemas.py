from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.schemas import CropRequest, MediaOut, SettingsOut, SettingsUpdate


def test_media_out_serialization():
    data = MediaOut(
        id=1,
        filename="abc.jpg",
        original_name="photo.jpg",
        media_type="photo",
        width=800,
        height=600,
        file_size=12345,
        thumb_filename="thumb_abc.jpg",
        uploaded_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    d = data.model_dump()
    assert d["id"] == 1
    assert d["duration"] is None


def test_media_out_video():
    data = MediaOut(
        id=2,
        filename="clip.mp4",
        original_name="video.mp4",
        media_type="video",
        width=1920,
        height=1080,
        file_size=5000000,
        duration=3.5,
        codec="h264",
        thumb_filename="thumb_clip.jpg",
        display_filename="display_clip.mp4",
        uploaded_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    d = data.model_dump()
    assert d["duration"] == 3.5
    assert d["display_filename"] == "display_clip.mp4"


def test_settings_out():
    data = SettingsOut(
        slideshow_interval=15,
        transition_type="crossfade",
    )
    assert data.slideshow_interval == 15


def test_settings_update_partial():
    update = SettingsUpdate(slideshow_interval=20)
    d = update.model_dump(exclude_unset=True)
    assert d == {"slideshow_interval": 20}
    assert "transition_type" not in d


def test_settings_update_empty():
    update = SettingsUpdate()
    d = update.model_dump(exclude_unset=True)
    assert d == {}


class TestCropRequest:
    def test_valid_crop(self):
        req = CropRequest(crop_x=0.5, crop_y=0.3, crop_scale=1.5)
        assert req.crop_x == 0.5
        assert req.crop_y == 0.3
        assert req.crop_scale == 1.5

    def test_boundary_values(self):
        CropRequest(crop_x=0.0, crop_y=0.0, crop_scale=1.0)
        CropRequest(crop_x=1.0, crop_y=1.0, crop_scale=1.0)

    def test_crop_x_out_of_range(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=-0.1, crop_y=0.5, crop_scale=1.0)
        with pytest.raises(ValidationError):
            CropRequest(crop_x=1.1, crop_y=0.5, crop_scale=1.0)

    def test_crop_y_out_of_range(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=-0.1, crop_scale=1.0)
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=1.1, crop_scale=1.0)

    def test_crop_scale_below_minimum(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=0.5, crop_scale=0.9)

    def test_crop_scale_at_minimum(self):
        req = CropRequest(crop_x=0.5, crop_y=0.5, crop_scale=1.0)
        assert req.crop_scale == 1.0

    def test_explicit_null_crop_x_rejected(self):
        """Lesson from QA Round 2: explicit null must be rejected, not silently accepted."""
        with pytest.raises(ValidationError):
            CropRequest(crop_x=None, crop_y=0.5, crop_scale=1.0)

    def test_explicit_null_crop_y_rejected(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=None, crop_scale=1.0)

    def test_explicit_null_crop_scale_rejected(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=0.5, crop_scale=None)

    def test_missing_all_fields_rejected(self):
        with pytest.raises(ValidationError):
            CropRequest()

    def test_missing_partial_fields_rejected(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5)
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=0.5)

    def test_crop_scale_above_maximum_rejected(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=0.5, crop_scale=10.1)

    def test_crop_scale_at_maximum(self):
        req = CropRequest(crop_x=0.5, crop_y=0.5, crop_scale=10.0)
        assert req.crop_scale == 10.0

    def test_nan_rejected(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=float("nan"), crop_y=0.5, crop_scale=1.0)

    def test_infinity_rejected(self):
        with pytest.raises(ValidationError):
            CropRequest(crop_x=float("inf"), crop_y=0.5, crop_scale=1.0)
        with pytest.raises(ValidationError):
            CropRequest(crop_x=0.5, crop_y=float("-inf"), crop_scale=1.0)


class TestMediaOutWithCrop:
    def test_media_out_serializes_crop_fields(self):
        data = MediaOut(
            id=1,
            filename="abc.jpg",
            original_name="photo.jpg",
            media_type="photo",
            width=800,
            height=600,
            file_size=12345,
            thumb_filename="thumb_abc.jpg",
            uploaded_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            crop_x=0.3,
            crop_y=0.4,
            crop_scale=2.0,
        )
        d = data.model_dump()
        assert d["crop_x"] == 0.3
        assert d["crop_y"] == 0.4
        assert d["crop_scale"] == 2.0

    def test_media_out_null_crop_fields(self):
        data = MediaOut(
            id=1,
            filename="abc.jpg",
            original_name="photo.jpg",
            media_type="photo",
            width=800,
            height=600,
            file_size=12345,
            thumb_filename="thumb_abc.jpg",
            uploaded_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        d = data.model_dump()
        assert d["crop_x"] is None
        assert d["crop_y"] is None
        assert d["crop_scale"] is None
