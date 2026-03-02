from datetime import datetime, timezone

from app.schemas import MediaOut, SettingsOut, SettingsUpdate


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
    assert d["transcoded_filename"] is None


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
        transcoded_filename="tc_clip.mp4",
        uploaded_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    d = data.model_dump()
    assert d["duration"] == 3.5
    assert d["transcoded_filename"] == "tc_clip.mp4"


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
