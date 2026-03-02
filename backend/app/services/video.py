import json
import re
import subprocess
import uuid
from collections.abc import Callable
from pathlib import Path

from app import config


def get_video_metadata(video_path: Path) -> dict:
    """Extract video metadata using ffprobe.

    Returns dict with: duration, width, height, codec
    """
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(video_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    probe = json.loads(result.stdout)

    video_stream = next(
        (s for s in probe.get("streams", []) if s["codec_type"] == "video"),
        None,
    )
    if not video_stream:
        raise ValueError("No video stream found")

    duration = float(probe.get("format", {}).get("duration", 0))
    width = int(video_stream["width"])
    height = int(video_stream["height"])
    codec = video_stream.get("codec_name", "unknown")

    return {
        "duration": duration,
        "width": width,
        "height": height,
        "codec": codec,
    }


def generate_video_thumbnail(
    video_path: Path,
    thumb_filename: str,
    thumbnails_dir: Path | None = None,
) -> Path:
    """Generate a JPEG thumbnail at 25% of video duration."""
    if thumbnails_dir is None:
        thumbnails_dir = config.THUMBNAILS_DIR

    meta = get_video_metadata(video_path)
    seek_time = meta["duration"] * 0.25

    thumb_path = thumbnails_dir / thumb_filename
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss", str(seek_time),
            "-i", str(video_path),
            "-vframes", "1",
            "-q:v", "5",
            str(thumb_path),
        ],
        capture_output=True,
        check=True,
    )
    return thumb_path


def needs_transcode(codec: str) -> bool:
    """Transcode non-browser-compatible codecs to H.264 MP4.

    H.264, VP8, VP9, and AV1 are widely supported by browsers.
    HEVC, ProRes, and other codecs need transcoding.
    """
    browser_compatible = {"h264", "vp8", "vp9", "av1"}
    return codec.lower() not in browser_compatible


def transcode_to_h264(
    video_path: Path,
    output_filename: str,
    transcoded_dir: Path | None = None,
    duration: float | None = None,
    on_progress: Callable[[int], None] | None = None,
) -> Path:
    """Transcode video to H.264 MP4.

    If *duration* and *on_progress* are provided, progress (0-100) is reported
    via the callback by parsing ffmpeg ``-progress`` output.
    """
    if transcoded_dir is None:
        transcoded_dir = config.TRANSCODED_DIR

    output_path = transcoded_dir / output_filename

    if on_progress and duration and duration > 0:
        return _transcode_with_progress(
            video_path, output_path, duration, on_progress,
        )

    # Simple path — no progress tracking
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-c:v", "libx264", "-preset", "medium", "-crf", "23",
            "-c:a", "aac", "-movflags", "+faststart",
            str(output_path),
        ],
        capture_output=True,
        check=True,
    )
    return output_path


_TIME_RE = re.compile(r"out_time_ms=(\d+)")


def _transcode_with_progress(
    video_path: Path,
    output_path: Path,
    duration: float,
    on_progress: Callable[[int], None],
) -> Path:
    """Run ffmpeg with ``-progress pipe:1`` and report percentage via callback."""
    proc = subprocess.Popen(
        [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-c:v", "libx264", "-preset", "medium", "-crf", "23",
            "-c:a", "aac", "-movflags", "+faststart",
            "-progress", "pipe:1",
            "-nostats",
            str(output_path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    duration_us = duration * 1_000_000
    last_pct = -1

    for line in proc.stdout:  # type: ignore[union-attr]
        m = _TIME_RE.match(line.strip())
        if m:
            current_us = int(m.group(1))
            pct = min(int(current_us / duration_us * 100), 99)
            if pct > last_pct:
                last_pct = pct
                on_progress(pct)

    proc.wait()
    if proc.returncode != 0:
        stderr = proc.stderr.read() if proc.stderr else ""  # type: ignore[union-attr]
        raise subprocess.CalledProcessError(proc.returncode, "ffmpeg", stderr=stderr)

    on_progress(100)
    return output_path


def save_video_original(
    file_bytes: bytes,
    original_name: str,
    originals_dir: Path | None = None,
    thumbnails_dir: Path | None = None,
) -> dict:
    """Phase 1: Save original file, extract metadata, generate thumbnail. Fast (no transcode).

    Returns dict with: filename, width, height, file_size, duration, codec, thumb_filename
    Raises ValueError for corrupt or empty files.
    """
    if not file_bytes:
        raise ValueError("Empty file")

    if originals_dir is None:
        originals_dir = config.ORIGINALS_DIR
    if thumbnails_dir is None:
        thumbnails_dir = config.THUMBNAILS_DIR

    ext = Path(original_name).suffix.lower()
    filename = f"{uuid.uuid4()}{ext}"
    thumb_filename = f"thumb_{uuid.uuid4()}.jpg"

    created_files: list[Path] = []
    try:
        # Save original
        original_path = originals_dir / filename
        original_path.write_bytes(file_bytes)
        created_files.append(original_path)
        file_size = original_path.stat().st_size

        # Extract metadata
        meta = get_video_metadata(original_path)

        # Generate thumbnail
        generate_video_thumbnail(original_path, thumb_filename, thumbnails_dir)
        created_files.append(thumbnails_dir / thumb_filename)
    except (subprocess.CalledProcessError, ValueError, OSError, KeyError) as exc:
        # Clean up any partially written files
        for f in created_files:
            f.unlink(missing_ok=True)
        raise ValueError(f"Invalid video file: {exc}") from exc

    return {
        "filename": filename,
        "thumb_filename": thumb_filename,
        "width": meta["width"],
        "height": meta["height"],
        "file_size": file_size,
        "duration": meta["duration"],
        "codec": meta["codec"],
    }
