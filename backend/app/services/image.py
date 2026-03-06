import io
import uuid
from pathlib import Path

import pillow_heif
from PIL import Image, ImageFilter, ImageOps

from app import config

pillow_heif.register_heif_opener()


def process_image(
    file_bytes: bytes,
    original_name: str,
    originals_dir: Path | None = None,
    thumbnails_dir: Path | None = None,
    display_dir: Path | None = None,
    blur_dir: Path | None = None,
) -> dict:
    """Process an uploaded image: EXIF auto-rotate, save original, generate thumbnail + display version.

    Returns dict with: filename, width, height, file_size, thumb_filename, display_filename
    Raises ValueError for corrupt or empty files.
    """
    if not file_bytes:
        raise ValueError("Empty file")

    if originals_dir is None:
        originals_dir = config.ORIGINALS_DIR
    if thumbnails_dir is None:
        thumbnails_dir = config.THUMBNAILS_DIR
    if display_dir is None:
        display_dir = config.DISPLAY_DIR
    if blur_dir is None:
        blur_dir = config.BLUR_DIR
    blur_dir.mkdir(parents=True, exist_ok=True)

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

        # Generate display-optimized version if image exceeds DISPLAY_MAX_SIZE
        display_filename = None
        max_dim = max(width, height)
        if max_dim > config.DISPLAY_MAX_SIZE:
            display_filename = f"display_{uuid.uuid4()}.jpg"
            display_img = img.copy()
            display_img.thumbnail(
                (config.DISPLAY_MAX_SIZE, config.DISPLAY_MAX_SIZE), Image.LANCZOS
            )
            display_path = display_dir / display_filename
            display_img.save(display_path, "JPEG", quality=90)
            created_files.append(display_path)

        # Generate pre-rendered blur background
        blur_filename = f"blur_{uuid.uuid4()}.jpg"
        blur_img = img.copy()
        blur_img.thumbnail((config.BLUR_SIZE, config.BLUR_SIZE), Image.LANCZOS)
        blur_img = blur_img.filter(ImageFilter.GaussianBlur(radius=30))
        blur_path = blur_dir / blur_filename
        blur_img.save(blur_path, "JPEG", quality=60)
        created_files.append(blur_path)
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
        "display_filename": display_filename,
        "blur_filename": blur_filename,
    }
