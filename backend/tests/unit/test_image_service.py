import io

import piexif
from PIL import Image

from app.services.image import process_image


def test_process_image_basic(tmp_dirs, sample_jpeg):
    result = process_image(
        sample_jpeg, "photo.jpg",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    assert result["width"] == 800
    assert result["height"] == 600
    assert result["file_size"] > 0
    assert result["filename"].endswith(".jpg")
    assert result["thumb_filename"].endswith(".jpg")

    # Verify files exist
    assert (tmp_dirs["originals"] / result["filename"]).exists()
    assert (tmp_dirs["thumbnails"] / result["thumb_filename"]).exists()


def test_process_image_thumbnail_size(tmp_dirs, sample_jpeg):
    result = process_image(
        sample_jpeg, "photo.jpg",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    thumb = Image.open(tmp_dirs["thumbnails"] / result["thumb_filename"])
    assert max(thumb.size) <= 300


def test_process_image_exif_rotation(tmp_dirs):
    """Image with EXIF orientation 6 (90° CW) should be auto-rotated."""
    # Create 800x600 image with orientation=6 → after rotation should be 600x800
    img = Image.new("RGB", (800, 600), color="blue")
    buf = io.BytesIO()
    exif_dict = {"0th": {piexif.ImageIFD.Orientation: 6}}
    exif_bytes = piexif.dump(exif_dict)
    img.save(buf, "JPEG", exif=exif_bytes)
    rotated_jpeg = buf.getvalue()

    result = process_image(
        rotated_jpeg, "rotated.jpg",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    # After EXIF transpose, 800x600 with orientation 6 becomes 600x800
    assert result["width"] == 600
    assert result["height"] == 800


def test_process_image_png(tmp_dirs, sample_png):
    result = process_image(
        sample_png, "photo.png",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    assert result["width"] == 640
    assert result["height"] == 480
    assert result["filename"].endswith(".png")
    # Thumbnail is always JPEG
    assert result["thumb_filename"].endswith(".jpg")


# ─── HEIC Failure Paths ──────────────────────────────────────


def test_process_image_corrupt_heic(tmp_dirs):
    """Corrupt HEIC (random garbage bytes) raises ValueError."""
    corrupt_bytes = b"\x00\x01\x02\x03garbage_heic_data" * 100
    try:
        process_image(
            corrupt_bytes, "corrupt.heic",
            originals_dir=tmp_dirs["originals"],
            thumbnails_dir=tmp_dirs["thumbnails"],
        )
        assert False, "Should have raised ValueError"
    except ValueError as exc:
        assert "Invalid image file" in str(exc)

    # No orphaned files on disk
    assert list(tmp_dirs["originals"].iterdir()) == []
    assert list(tmp_dirs["thumbnails"].iterdir()) == []


def test_process_image_empty_heic(tmp_dirs):
    """Empty HEIC file raises ValueError('Empty file')."""
    try:
        process_image(
            b"", "empty.heic",
            originals_dir=tmp_dirs["originals"],
            thumbnails_dir=tmp_dirs["thumbnails"],
        )
        assert False, "Should have raised ValueError"
    except ValueError as exc:
        assert "Empty file" in str(exc)


def test_process_image_truncated_heic(tmp_dirs, sample_heic):
    """Truncated HEIC (first 100 bytes of real HEIC) raises ValueError."""
    truncated = sample_heic[:100]
    try:
        process_image(
            truncated, "truncated.heic",
            originals_dir=tmp_dirs["originals"],
            thumbnails_dir=tmp_dirs["thumbnails"],
        )
        assert False, "Should have raised ValueError"
    except ValueError as exc:
        assert "Invalid image file" in str(exc)

    # No orphaned files
    assert list(tmp_dirs["originals"].iterdir()) == []
    assert list(tmp_dirs["thumbnails"].iterdir()) == []


# ─── HEIC Happy Paths ────────────────────────────────────────


def test_process_image_heic_becomes_jpg(tmp_dirs, sample_heic):
    """Real HEIC file is processed and saved as .jpg."""
    result = process_image(
        sample_heic, "photo.heic",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    assert result["filename"].endswith(".jpg")
    assert result["thumb_filename"].endswith(".jpg")
    assert result["width"] == 640
    assert result["height"] == 480
    assert result["file_size"] > 0

    # Verify files exist and are valid JPEGs
    original_path = tmp_dirs["originals"] / result["filename"]
    thumb_path = tmp_dirs["thumbnails"] / result["thumb_filename"]
    assert original_path.exists()
    assert thumb_path.exists()

    # Verify the saved original is a valid JPEG
    img = Image.open(original_path)
    assert img.format == "JPEG"
    assert img.size == (640, 480)

    # Verify thumbnail dimensions
    thumb = Image.open(thumb_path)
    assert max(thumb.size) <= 300


def test_process_image_heic_rgba_converts_to_rgb(tmp_dirs, sample_heic_rgba):
    """HEIC with alpha channel converts to RGB without error."""
    result = process_image(
        sample_heic_rgba, "rgba.heic",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    assert result["filename"].endswith(".jpg")
    assert result["width"] == 640
    assert result["height"] == 480

    # Verify the saved image is RGB (no alpha)
    img = Image.open(tmp_dirs["originals"] / result["filename"])
    assert img.mode == "RGB"
