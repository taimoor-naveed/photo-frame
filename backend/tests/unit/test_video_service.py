import subprocess
from pathlib import Path

import pytest

from app.services.video import (
    generate_blur_from_thumbnail,
    generate_video_thumbnail,
    get_video_metadata,
    needs_transcode,
    save_video_original,
    scale_video_for_display,
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


# ─── Display-Optimized Video Scaling ─────────────────────────


@pytest.fixture()
def large_video_file(tmp_path) -> Path:
    """Create a 2560x1440 H.264 video (larger than DISPLAY_MAX_SIZE)."""
    path = tmp_path / "large.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=blue:s=2560x1440:d=1",
            "-c:v", "libx264", "-t", "1",
            str(path),
        ],
        capture_output=True,
        check=True,
    )
    return path


@pytest.fixture()
def small_video_file(tmp_path) -> Path:
    """Create a 640x480 H.264 video (smaller than DISPLAY_MAX_SIZE)."""
    path = tmp_path / "small.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=green:s=640x480:d=1",
            "-c:v", "libx264", "-t", "1",
            str(path),
        ],
        capture_output=True,
        check=True,
    )
    return path


def test_scale_video_for_display_output_exists(tmp_dirs, large_video_file):
    """scale_video_for_display should create the output file."""
    output = scale_video_for_display(
        large_video_file, "display_test.mp4",
        display_dir=tmp_dirs["display"],
    )
    assert output.exists()
    assert output.stat().st_size > 0


def test_scale_video_for_display_caps_dimensions(tmp_dirs, large_video_file):
    """2560x1440 video should be scaled so longest edge ≤ 1920."""
    scale_video_for_display(
        large_video_file, "display_capped.mp4",
        display_dir=tmp_dirs["display"],
    )

    meta = get_video_metadata(tmp_dirs["display"] / "display_capped.mp4")
    assert max(meta["width"], meta["height"]) <= 1920


def test_scale_video_for_display_preserves_aspect_ratio(tmp_dirs, large_video_file):
    """Aspect ratio should be maintained (2560x1440 → 1920x1080)."""
    scale_video_for_display(
        large_video_file, "display_ar.mp4",
        display_dir=tmp_dirs["display"],
    )

    meta = get_video_metadata(tmp_dirs["display"] / "display_ar.mp4")
    # 2560:1440 = 16:9 → 1920:1080
    assert meta["width"] == 1920
    assert meta["height"] == 1080


def test_scale_video_for_display_small_stays_small(tmp_dirs, small_video_file):
    """Video ≤ 1920px should keep its original dimensions (min filter preserves)."""
    scale_video_for_display(
        small_video_file, "display_small.mp4",
        display_dir=tmp_dirs["display"],
    )

    meta = get_video_metadata(tmp_dirs["display"] / "display_small.mp4")
    assert meta["width"] == 640
    assert meta["height"] == 480


def test_scale_video_for_display_with_progress(tmp_dirs, large_video_file):
    """Progress callback should be called with increasing percentages up to 100."""
    progress_values = []
    scale_video_for_display(
        large_video_file, "display_prog.mp4",
        display_dir=tmp_dirs["display"],
        duration=1.0,
        on_progress=lambda pct: progress_values.append(pct),
    )

    assert len(progress_values) > 0
    assert progress_values[-1] == 100
    # Values should be non-decreasing
    assert progress_values == sorted(progress_values)


def test_scale_video_for_display_invalid_input(tmp_dirs, tmp_path):
    """Corrupt input should raise CalledProcessError."""
    bad_file = tmp_path / "corrupt.mp4"
    bad_file.write_text("not a video")

    with pytest.raises(subprocess.CalledProcessError):
        scale_video_for_display(
            bad_file, "display_fail.mp4",
            display_dir=tmp_dirs["display"],
        )


# ─── Blur Background from Thumbnail ─────────────────────────


def test_generate_blur_from_thumbnail(video_file, tmp_dirs):
    """Generate blur background from video thumbnail."""
    thumb_path = generate_video_thumbnail(
        video_file, "thumb_test.jpg",
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    blur_path = generate_blur_from_thumbnail(
        thumb_path, "blur_test.jpg",
        blur_dir=tmp_dirs["blur"],
    )

    assert blur_path.exists()
    assert blur_path.stat().st_size > 0
    assert blur_path.stat().st_size < 5000


def test_generate_blur_from_thumbnail_dimensions(video_file, tmp_dirs):
    """Blur image max dimension should be <= 64."""
    thumb_path = generate_video_thumbnail(
        video_file, "thumb_dim.jpg",
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    blur_path = generate_blur_from_thumbnail(
        thumb_path, "blur_dim.jpg",
        blur_dir=tmp_dirs["blur"],
    )

    from PIL import Image
    blur_img = Image.open(blur_path)
    assert max(blur_img.size) <= 64
