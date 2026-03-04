import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
DB_PATH = DATA_DIR / "photos.db"
ORIGINALS_DIR = DATA_DIR / "originals"
THUMBNAILS_DIR = DATA_DIR / "thumbnails"
TRANSCODED_DIR = DATA_DIR / "transcoded"
DISPLAY_DIR = DATA_DIR / "display"

DATABASE_URL = f"sqlite:///{DB_PATH}"

THUMBNAIL_SIZE = 300
DISPLAY_MAX_SIZE = 1920

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
ALLOWED_EXTENSIONS = ALLOWED_IMAGE_EXTENSIONS | ALLOWED_VIDEO_EXTENSIONS

MAX_UPLOAD_SIZE = 200 * 1024 * 1024  # 200MB
