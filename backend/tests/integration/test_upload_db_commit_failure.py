"""Tests for orphaned file cleanup when db.commit() fails during upload.

Covers all 3 upload paths:
1. Motion Photo (extracted video) upload
2. Normal image upload
3. Regular video upload
"""

import io
import subprocess
from unittest.mock import patch

import pytest
from PIL import Image


def _make_jpeg(width: int = 100, height: int = 100, color: str = "blue") -> bytes:
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


def _make_tiny_mp4(tmp_path) -> bytes:
    video_path = tmp_path / "tiny.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=green:s=64x64:d=0.1",
            "-c:v", "libx264", "-t", "0.1",
            str(video_path),
        ],
        capture_output=True,
        check=True,
    )
    return video_path.read_bytes()


def _build_samsung_motion_photo(jpeg_bytes: bytes, video_bytes: bytes) -> bytes:
    return jpeg_bytes + b"MotionPhoto_Data" + video_bytes


# ─── Motion Photo: DB commit failure cleans up video files ───


def test_motion_photo_db_commit_failure_cleans_up_video_files(client, tmp_path):
    """When db.commit() fails after saving Motion Photo video, the extracted video
    files are cleaned up. The outer except catches the re-raise and falls back to
    saving as image (this is problem #2 — broad except — but the orphan cleanup works)."""
    import app.config as config

    jpeg_bytes = _make_jpeg()
    mp4_bytes = _make_tiny_mp4(tmp_path)
    motion_photo = _build_samsung_motion_photo(jpeg_bytes, mp4_bytes)

    from sqlalchemy.orm import Session
    original_commit = Session.commit

    call_count = 0

    def failing_commit(self):
        nonlocal call_count
        call_count += 1
        # Fail on the first commit (the Motion Photo video save).
        # The second commit (image fallback) succeeds.
        if call_count == 1:
            raise Exception("Simulated DB commit failure")
        return original_commit(self)

    with patch.object(Session, "commit", failing_commit):
        r = client.post(
            "/api/media",
            files=[("files", ("motion.jpg", io.BytesIO(motion_photo), "image/jpeg"))],
        )

    # Falls back to image due to broad except (problem #2)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "photo"

    # The important part: no orphaned VIDEO files on disk.
    # Only the fallback image files should exist.
    originals = list(config.ORIGINALS_DIR.iterdir())
    thumbnails = list(config.THUMBNAILS_DIR.iterdir())
    # Exactly 1 original (the fallback image) and 1 thumbnail (the fallback image thumb)
    assert len(originals) == 1, f"Expected 1 original (image fallback), got {len(originals)}: {originals}"
    assert len(thumbnails) == 1, f"Expected 1 thumbnail (image fallback), got {len(thumbnails)}: {thumbnails}"
    # The original should be a JPEG (image), not an MP4 (video)
    assert originals[0].suffix in (".jpg", ".jpeg"), f"Expected JPEG fallback, got {originals[0]}"


# ─── Normal image: DB commit failure cleans up files ─────────


def test_image_db_commit_failure_cleans_up_files(client, tmp_path):
    """When db.commit() fails after processing an image, orphaned files are deleted."""
    import app.config as config

    jpeg_bytes = _make_jpeg(width=200, height=150, color="red")

    originals_before = set(config.ORIGINALS_DIR.iterdir())
    thumbnails_before = set(config.THUMBNAILS_DIR.iterdir())

    from sqlalchemy.orm import Session
    original_commit = Session.commit

    def always_failing_commit(self):
        raise Exception("Simulated DB commit failure")

    with patch.object(Session, "commit", always_failing_commit):
        with pytest.raises(Exception, match="Simulated DB commit failure"):
            client.post(
                "/api/media",
                files=[("files", ("photo.jpg", io.BytesIO(jpeg_bytes), "image/jpeg"))],
            )

    # No orphaned files on disk
    originals_after = set(config.ORIGINALS_DIR.iterdir())
    thumbnails_after = set(config.THUMBNAILS_DIR.iterdir())
    assert originals_after == originals_before, f"Orphaned originals: {originals_after - originals_before}"
    assert thumbnails_after == thumbnails_before, f"Orphaned thumbnails: {thumbnails_after - thumbnails_before}"


def test_large_image_db_commit_failure_cleans_up_display_file(client, sample_jpeg_large):
    """When db.commit() fails for a large image, display file is also cleaned up."""
    import app.config as config

    originals_before = set(config.ORIGINALS_DIR.iterdir())
    thumbnails_before = set(config.THUMBNAILS_DIR.iterdir())
    display_before = set(config.DISPLAY_DIR.iterdir())

    from sqlalchemy.orm import Session

    def always_failing_commit(self):
        raise Exception("Simulated DB commit failure")

    with patch.object(Session, "commit", always_failing_commit):
        with pytest.raises(Exception, match="Simulated DB commit failure"):
            client.post(
                "/api/media",
                files=[("files", ("big_photo.jpg", io.BytesIO(sample_jpeg_large), "image/jpeg"))],
            )

    originals_after = set(config.ORIGINALS_DIR.iterdir())
    thumbnails_after = set(config.THUMBNAILS_DIR.iterdir())
    display_after = set(config.DISPLAY_DIR.iterdir())
    assert originals_after == originals_before, f"Orphaned originals: {originals_after - originals_before}"
    assert thumbnails_after == thumbnails_before, f"Orphaned thumbnails: {thumbnails_after - thumbnails_before}"
    assert display_after == display_before, f"Orphaned display: {display_after - display_before}"


# ─── Regular video: DB commit failure cleans up files ────────


def test_video_db_commit_failure_cleans_up_files(client, sample_video):
    """When db.commit() fails after saving a video, orphaned files are deleted."""
    import app.config as config

    originals_before = set(config.ORIGINALS_DIR.iterdir())
    thumbnails_before = set(config.THUMBNAILS_DIR.iterdir())

    from sqlalchemy.orm import Session

    def always_failing_commit(self):
        raise Exception("Simulated DB commit failure")

    with patch.object(Session, "commit", always_failing_commit):
        with pytest.raises(Exception, match="Simulated DB commit failure"):
            client.post(
                "/api/media",
                files=[("files", ("video.mp4", io.BytesIO(sample_video), "video/mp4"))],
            )

    originals_after = set(config.ORIGINALS_DIR.iterdir())
    thumbnails_after = set(config.THUMBNAILS_DIR.iterdir())
    assert originals_after == originals_before, f"Orphaned originals: {originals_after - originals_before}"
    assert thumbnails_after == thumbnails_before, f"Orphaned thumbnails: {thumbnails_after - thumbnails_before}"


# ─── Verify normal uploads still work ────────────────────────


def test_image_upload_still_works_after_fix(client):
    """Regression: normal image upload is unaffected by the commit-failure handling."""
    jpeg_bytes = _make_jpeg(width=200, height=150, color="green")
    r = client.post(
        "/api/media",
        files=[("files", ("normal.jpg", io.BytesIO(jpeg_bytes), "image/jpeg"))],
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "photo"


def test_video_upload_still_works_after_fix(client, sample_video):
    """Regression: normal video upload is unaffected by the commit-failure handling."""
    r = client.post(
        "/api/media",
        files=[("files", ("video.mp4", io.BytesIO(sample_video), "video/mp4"))],
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "video"


def test_motion_photo_upload_still_works_after_fix(client, tmp_path):
    """Regression: Motion Photo upload is unaffected by the commit-failure handling."""
    jpeg_bytes = _make_jpeg()
    mp4_bytes = _make_tiny_mp4(tmp_path)
    motion_photo = _build_samsung_motion_photo(jpeg_bytes, mp4_bytes)

    r = client.post(
        "/api/media",
        files=[("files", ("motion.jpg", io.BytesIO(motion_photo), "image/jpeg"))],
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "video"
