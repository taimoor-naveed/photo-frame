from datetime import datetime, timezone

from app.models import Media, Settings


def test_media_creation(db_session):
    media = Media(
        filename="test.jpg",
        original_name="photo.jpg",
        media_type="photo",
        width=800,
        height=600,
        file_size=12345,
        thumb_filename="thumb_test.jpg",
    )
    db_session.add(media)
    db_session.commit()
    db_session.refresh(media)

    assert media.id is not None
    assert media.filename == "test.jpg"
    assert media.media_type == "photo"
    assert media.duration is None
    assert media.codec is None
    assert media.transcoded_filename is None
    assert isinstance(media.uploaded_at, datetime)


def test_media_video_fields(db_session):
    media = Media(
        filename="clip.mp4",
        original_name="video.mp4",
        media_type="video",
        width=1920,
        height=1080,
        file_size=5000000,
        duration=3.5,
        codec="h264",
        thumb_filename="thumb_clip.jpg",
        transcoded_filename="transcoded_clip.mp4",
    )
    db_session.add(media)
    db_session.commit()
    db_session.refresh(media)

    assert media.duration == 3.5
    assert media.codec == "h264"
    assert media.transcoded_filename == "transcoded_clip.mp4"


def test_settings_defaults(db_session):
    settings = Settings(id=1)
    db_session.add(settings)
    db_session.commit()
    db_session.refresh(settings)

    assert settings.slideshow_interval == 10
    assert settings.transition_type == "crossfade"
    assert settings.photo_order == "random"
