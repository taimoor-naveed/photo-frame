import json
import subprocess
from pathlib import Path

import pytest

from app.services.video import (
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
    """2560x1440 video should be scaled to fit within 1024x600."""
    scale_video_for_display(
        large_video_file, "display_capped.mp4",
        display_dir=tmp_dirs["display"],
    )

    meta = get_video_metadata(tmp_dirs["display"] / "display_capped.mp4")
    assert meta["width"] <= 1024
    assert meta["height"] <= 600


def test_scale_video_for_display_preserves_aspect_ratio(tmp_dirs, large_video_file):
    """Aspect ratio should be maintained (2560x1440 → 1024x576)."""
    scale_video_for_display(
        large_video_file, "display_ar.mp4",
        display_dir=tmp_dirs["display"],
    )

    meta = get_video_metadata(tmp_dirs["display"] / "display_ar.mp4")
    # 2560:1440 = 16:9 → fits in 1024x600 → 1024x576
    assert meta["width"] == 1024
    assert meta["height"] == 576


def test_scale_video_for_display_small_stays_small(tmp_dirs, small_video_file):
    """Video within 1024x600 should keep its original dimensions (min filter preserves)."""
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


# ─── -map Flag Tests ───────────────────────────────────────


def test_generate_video_thumbnail_uses_map_flag(video_file, tmp_dirs):
    """generate_video_thumbnail should use -map 0:v:0 to select only the first video stream."""
    from unittest.mock import patch

    original_run = subprocess.run

    captured_cmds = []

    def spy_run(*args, **kwargs):
        cmd = args[0] if args else kwargs.get("args", [])
        if cmd and cmd[0] == "ffmpeg":
            captured_cmds.append(cmd)
        return original_run(*args, **kwargs)

    with patch("app.services.video.subprocess.run", side_effect=spy_run):
        generate_video_thumbnail(
            video_file, "thumb_map_test.jpg",
            thumbnails_dir=tmp_dirs["thumbnails"],
        )

    assert len(captured_cmds) == 1, "Expected exactly one ffmpeg call for thumbnail"
    cmd = captured_cmds[0]
    assert "-map" in cmd, "ffmpeg command should include -map flag"
    map_idx = cmd.index("-map")
    assert cmd[map_idx + 1] == "0:v:0", "Should map first video stream"


# ─── H.264 Profile Tests ────────────────────────────────────


def test_transcode_uses_main_profile(tmp_dirs, tmp_path):
    """Transcoded video should use H.264 Main profile for hardware decode compatibility."""
    src = tmp_path / "src_mpeg4.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1",
            "-c:v", "mpeg4", "-t", "1",
            str(src),
        ],
        capture_output=True,
        check=True,
    )

    from app.services.video import transcode_to_h264
    output = transcode_to_h264(
        src, "display_test.mp4",
        display_dir=tmp_dirs["display"],
    )

    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", str(output),
        ],
        capture_output=True, text=True, check=True,
    )
    streams = json.loads(result.stdout)
    video = next(s for s in streams["streams"] if s["codec_type"] == "video")
    assert video["profile"] == "Main"


def test_scale_video_uses_main_profile(tmp_dirs, large_video_file):
    """Scaled video should use H.264 Main profile."""
    scale_video_for_display(
        large_video_file, "display_profile.mp4",
        display_dir=tmp_dirs["display"],
    )

    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", str(tmp_dirs["display"] / "display_profile.mp4"),
        ],
        capture_output=True, text=True, check=True,
    )
    streams = json.loads(result.stdout)
    video = next(s for s in streams["streams"] if s["codec_type"] == "video")
    assert video["profile"] == "Main"
