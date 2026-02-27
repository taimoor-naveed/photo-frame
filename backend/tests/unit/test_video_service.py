import subprocess
from pathlib import Path

import pytest

from app.services.video import (
    generate_video_thumbnail,
    get_video_metadata,
    needs_transcode,
    save_video_original,
)


@pytest.fixture()
def video_file(tmp_path) -> Path:
    """Create a minimal H.264 video file."""
    path = tmp_path / "test.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=red:s=320x240:d=2",
            "-c:v", "libx264", "-t", "2",
            str(path),
        ],
        capture_output=True,
        check=True,
    )
    return path


def test_get_video_metadata(video_file):
    meta = get_video_metadata(video_file)

    assert meta["width"] == 320
    assert meta["height"] == 240
    assert meta["codec"] == "h264"
    assert 1.5 <= meta["duration"] <= 2.5  # ~2s, allow some tolerance


def test_get_video_metadata_invalid(tmp_path):
    bad_file = tmp_path / "bad.mp4"
    bad_file.write_text("not a video")

    with pytest.raises(Exception):
        get_video_metadata(bad_file)


def test_generate_video_thumbnail(video_file, tmp_dirs):
    thumb_path = generate_video_thumbnail(
        video_file, "thumb_test.jpg",
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    assert thumb_path.exists()
    assert thumb_path.stat().st_size > 0


def test_needs_transcode():
    # Non-browser-compatible codecs need transcode
    assert needs_transcode("hevc") is True
    assert needs_transcode("h265") is True
    assert needs_transcode("prores") is True
    # Browser-compatible codecs don't need transcode
    assert needs_transcode("h264") is False
    assert needs_transcode("vp8") is False
    assert needs_transcode("vp9") is False
    assert needs_transcode("av1") is False


def test_save_video_original(tmp_dirs):
    """Phase 1: save original, extract metadata, generate thumbnail (no transcode)."""
    # Create a small video
    video_path = tmp_dirs["originals"] / "src.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=green:s=160x120:d=1",
            "-c:v", "libx264", "-t", "1",
            str(video_path),
        ],
        capture_output=True,
        check=True,
    )
    video_bytes = video_path.read_bytes()
    video_path.unlink()  # remove source, save_video_original will save its own copy

    result = save_video_original(
        video_bytes, "clip.mp4",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    assert result["width"] == 160
    assert result["height"] == 120
    assert result["codec"] == "h264"
    assert result["duration"] > 0
    assert result["file_size"] > 0
    assert (tmp_dirs["originals"] / result["filename"]).exists()
    assert (tmp_dirs["thumbnails"] / result["thumb_filename"]).exists()
