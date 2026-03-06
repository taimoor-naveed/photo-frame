#!/usr/bin/env python3
"""Regenerate blur background images for all existing media.

Run inside the backend container:
    docker compose exec backend python /app/scripts/regenerate-blur.py
"""
import sys
from pathlib import Path

sys.path.insert(0, "/app")

from app import config
from app.database import SessionLocal
from app.models import Media
from PIL import Image, ImageFilter

config.BLUR_DIR.mkdir(parents=True, exist_ok=True)

db = SessionLocal()
media_items = db.query(Media).all()
print(f"Regenerating blur images for {len(media_items)} items...")

count = 0
for item in media_items:
    # Determine source image
    if item.media_type == "photo":
        # Prefer display version, fall back to original
        if item.display_filename:
            src_path = config.DISPLAY_DIR / item.display_filename
        else:
            src_path = config.ORIGINALS_DIR / item.filename
    else:
        # Video — use thumbnail
        src_path = config.THUMBNAILS_DIR / item.thumb_filename

    if not src_path.exists():
        print(f"  SKIP {item.id} ({item.original_name}): source not found at {src_path}")
        continue

    # Delete old blur if exists
    if item.blur_filename:
        old_blur = config.BLUR_DIR / item.blur_filename
        old_blur.unlink(missing_ok=True)

    # Generate new blur
    try:
        img = Image.open(src_path)
        img.thumbnail((config.BLUR_SIZE, config.BLUR_SIZE), Image.LANCZOS)
        img = img.filter(ImageFilter.GaussianBlur(radius=30))

        blur_filename = f"blur_{item.id}.jpg"
        blur_path = config.BLUR_DIR / blur_filename
        img.save(blur_path, "JPEG", quality=60)

        item.blur_filename = blur_filename
        count += 1
    except Exception as e:
        print(f"  ERROR {item.id} ({item.original_name}): {e}")

db.commit()
db.close()
print(f"Done. Regenerated {count}/{len(media_items)} blur images.")
