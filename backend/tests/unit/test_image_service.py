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


def test_process_image_heic_becomes_jpg(tmp_dirs, sample_jpeg):
    """HEIC extension should be saved as .jpg."""
    result = process_image(
        sample_jpeg, "photo.heic",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    assert result["filename"].endswith(".jpg")
