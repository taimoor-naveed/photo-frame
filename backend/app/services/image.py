import io
import uuid
from pathlib import Path

import pillow_heif
from PIL import Image, ImageOps

from app import config

pillow_heif.register_heif_opener()


def process_image(
    file_bytes: bytes,
    original_name: str,
    originals_dir: Path | None = None,
    thumbnails_dir: Path | None = None,
) -> dict:
    """Process an uploaded image: EXIF auto-rotate, save original, generate thumbnail.

    Returns dict with: filename, width, height, file_size, thumb_filename
    Raises ValueError for corrupt or empty files.
    """
    if not file_bytes:
        raise ValueError("Empty file")

    if originals_dir is None:
        originals_dir = config.ORIGINALS_DIR
    if thumbnails_dir is None:
        thumbnails_dir = config.THUMBNAILS_DIR

    ext = Path(original_name).suffix.lower()
    if ext == ".heic":
        ext = ".jpg"
    filename = f"{uuid.uuid4()}{ext}"
    thumb_filename = f"thumb_{filename}"
    if not thumb_filename.lower().endswith((".jpg", ".jpeg")):
        thumb_filename = Path(thumb_filename).stem + ".jpg"

    created_files: list[Path] = []
    try:
        img = Image.open(io.BytesIO(file_bytes))
        img.load()  # Force decode — catches corrupt data

        # EXIF auto-rotate
        img = ImageOps.exif_transpose(img)

        # Convert to RGB if needed (e.g., RGBA PNGs, palette images)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        # Save rotated original
        original_path = originals_dir / filename
        img.save(original_path, quality=95)
        created_files.append(original_path)

        width, height = img.size
        file_size = original_path.stat().st_size

        # Generate thumbnail
        thumb = img.copy()
        thumb.thumbnail((config.THUMBNAIL_SIZE, config.THUMBNAIL_SIZE), Image.LANCZOS)
        thumb_path = thumbnails_dir / thumb_filename
        thumb.save(thumb_path, "JPEG", quality=85)
        created_files.append(thumb_path)
    except (Image.UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as exc:
        # Clean up any partially written files
        for f in created_files:
            f.unlink(missing_ok=True)
        raise ValueError(f"Invalid image file: {exc}") from exc

    return {
        "filename": filename,
        "thumb_filename": thumb_filename,
        "width": width,
        "height": height,
        "file_size": file_size,
    }
