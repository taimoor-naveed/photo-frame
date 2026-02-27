import json
import subprocess
import uuid
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
    """Check if video codec needs transcoding to H.264."""
    return codec.lower() in ("hevc", "h265", "h.265")


def transcode_to_h264(
    video_path: Path,
    output_filename: str,
    transcoded_dir: Path | None = None,
) -> Path:
    """Transcode video to H.264 MP4."""
    if transcoded_dir is None:
        transcoded_dir = config.TRANSCODED_DIR

    output_path = transcoded_dir / output_filename
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i", str(video_path),
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "23",
            "-c:a", "aac",
            "-movflags", "+faststart",
            str(output_path),
        ],
        capture_output=True,
        check=True,
    )
    return output_path


def process_video(
    file_bytes: bytes,
    original_name: str,
    originals_dir: Path | None = None,
    thumbnails_dir: Path | None = None,
    transcoded_dir: Path | None = None,
) -> dict:
    """Process an uploaded video: save, extract metadata, thumbnail, transcode if needed.

    Returns dict with: filename, width, height, file_size, duration, codec, thumb_filename, transcoded_filename
    """
    if originals_dir is None:
        originals_dir = config.ORIGINALS_DIR
    if thumbnails_dir is None:
        thumbnails_dir = config.THUMBNAILS_DIR
    if transcoded_dir is None:
        transcoded_dir = config.TRANSCODED_DIR

    ext = Path(original_name).suffix.lower()
    filename = f"{uuid.uuid4()}{ext}"
    thumb_filename = f"thumb_{uuid.uuid4()}.jpg"

    # Save original
    original_path = originals_dir / filename
    original_path.write_bytes(file_bytes)
    file_size = original_path.stat().st_size

    # Extract metadata
    meta = get_video_metadata(original_path)

    # Generate thumbnail
    generate_video_thumbnail(original_path, thumb_filename, thumbnails_dir)

    # Transcode if needed
    transcoded_filename = None
    if needs_transcode(meta["codec"]):
        transcoded_filename = f"{uuid.uuid4()}.mp4"
        transcode_to_h264(original_path, transcoded_filename, transcoded_dir)

    return {
        "filename": filename,
        "thumb_filename": thumb_filename,
        "width": meta["width"],
        "height": meta["height"],
        "file_size": file_size,
        "duration": meta["duration"],
        "codec": meta["codec"],
        "transcoded_filename": transcoded_filename,
    }
