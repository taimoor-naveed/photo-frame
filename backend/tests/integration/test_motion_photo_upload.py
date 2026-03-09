"""Integration tests for Motion Photo upload — extracts embedded video, skips image."""

import io
import subprocess

from PIL import Image


def _make_jpeg(width: int = 100, height: int = 100, color: str = "blue") -> bytes:
    """Generate a small JPEG image."""
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


def _make_tiny_mp4(tmp_path) -> bytes:
    """Generate a 1-frame H.264 MP4 via ffmpeg — valid enough for ffprobe."""
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
    """Construct a Samsung-style Motion Photo: JPEG + marker + MP4."""
    return jpeg_bytes + b"MotionPhoto_Data" + video_bytes


def _build_pixel_motion_photo(jpeg_bytes: bytes, video_bytes: bytes) -> bytes:
    """Construct a Pixel-style Motion Photo: JPEG with XMP MicroVideoOffset + appended MP4."""
    # Inject XMP metadata into the JPEG bytes indicating MicroVideo
    xmp = (
        b'GCamera:MicroVideo="1" '
        b'GCamera:MicroVideoOffset="' + str(len(video_bytes)).encode() + b'"'
    )
    # Place XMP before the JPEG image data (after SOI marker FF D8)
    # We'll just prepend it after the JPEG SOI
    soi = jpeg_bytes[:2]  # FF D8
    rest = jpeg_bytes[2:]
    # Wrap in APP1 XMP marker
    xmp_payload = b"http://ns.adobe.com/xap/1.0/\x00" + xmp
    xmp_length = len(xmp_payload) + 2  # +2 for length bytes
    app1 = b"\xff\xe1" + xmp_length.to_bytes(2, "big") + xmp_payload
    jpeg_with_xmp = soi + app1 + rest
    return jpeg_with_xmp + video_bytes


# ─── Samsung Motion Photo ────────────────────────────────────


def test_samsung_motion_photo_returns_video(client, tmp_path):
    """Samsung Motion Photo upload: returns 1 video item, no photo."""
    jpeg_bytes = _make_jpeg()
    mp4_bytes = _make_tiny_mp4(tmp_path)
    motion_photo = _build_samsung_motion_photo(jpeg_bytes, mp4_bytes)

    r = client.post(
        "/api/media",
        files=[("files", ("IMG_20250101.jpg", io.BytesIO(motion_photo), "image/jpeg"))],
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "video"
    assert data[0]["original_name"] == "IMG_20250101_live.mp4"
    assert data[0]["duration"] > 0
    assert data[0]["processing_status"] in ("ready", "processing")


# ─── Pixel Motion Photo ──────────────────────────────────────


def test_pixel_motion_photo_returns_video(client, tmp_path):
    """Pixel Motion Photo upload: returns 1 video item, no photo."""
    jpeg_bytes = _make_jpeg()
    mp4_bytes = _make_tiny_mp4(tmp_path)
    motion_photo = _build_pixel_motion_photo(jpeg_bytes, mp4_bytes)

    r = client.post(
        "/api/media",
        files=[("files", ("PXL_20250101.jpg", io.BytesIO(motion_photo), "image/jpeg"))],
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "video"
    assert data[0]["original_name"] == "PXL_20250101_live.mp4"
    assert data[0]["duration"] > 0


# ─── Corrupt embedded video → fallback to image ──────────────


def test_corrupt_embedded_video_falls_back_to_image(client):
    """If the embedded video is garbage, fall back to processing as image."""
    jpeg_bytes = _make_jpeg()
    garbage_video = b"\x00\x01\x02\x03garbage_not_a_video" * 100
    motion_photo = _build_samsung_motion_photo(jpeg_bytes, garbage_video)

    r = client.post(
        "/api/media",
        files=[("files", ("motion.jpg", io.BytesIO(motion_photo), "image/jpeg"))],
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "photo"
    assert data[0]["original_name"] == "motion.jpg"


# ─── Regular JPEG (regression) ───────────────────────────────


def test_regular_jpeg_unchanged(client):
    """Regular JPEG without Motion Photo data: returns photo as before."""
    jpeg_bytes = _make_jpeg(width=200, height=150, color="red")

    r = client.post(
        "/api/media",
        files=[("files", ("normal.jpg", io.BytesIO(jpeg_bytes), "image/jpeg"))],
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["media_type"] == "photo"
    assert data[0]["original_name"] == "normal.jpg"


# ─── Duplicate Motion Photo ──────────────────────────────────


def test_duplicate_motion_photo_dedup(client, tmp_path):
    """Uploading the same Motion Photo twice returns the same video record."""
    jpeg_bytes = _make_jpeg()
    mp4_bytes = _make_tiny_mp4(tmp_path)
    motion_photo = _build_samsung_motion_photo(jpeg_bytes, mp4_bytes)

    r1 = client.post(
        "/api/media",
        files=[("files", ("motion1.jpg", io.BytesIO(motion_photo), "image/jpeg"))],
    )
    r2 = client.post(
        "/api/media",
        files=[("files", ("motion2.jpg", io.BytesIO(motion_photo), "image/jpeg"))],
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Same record returned both times
    assert r1.json()[0]["id"] == r2.json()[0]["id"]
    # Only 1 item total in DB
    assert client.get("/api/media").json()["total"] == 1
