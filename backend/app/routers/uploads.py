from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app import config

router = APIRouter(prefix="/uploads", tags=["uploads"])

_CACHE_HEADERS = {"Cache-Control": "public, max-age=31536000, immutable"}


def _serve_file(directory: Path, filename: str) -> FileResponse:
    if "\x00" in filename:
        raise HTTPException(400, "Invalid filename")
    try:
        path = (directory / filename).resolve()
    except (ValueError, OSError):
        raise HTTPException(400, "Invalid filename")
    if not path.is_relative_to(directory.resolve()):
        raise HTTPException(403, "Access denied")
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, headers=_CACHE_HEADERS)


@router.get("/originals/{filename}")
def serve_original(filename: str):
    return _serve_file(config.ORIGINALS_DIR, filename)


@router.get("/thumbnails/{filename}")
def serve_thumbnail(filename: str):
    return _serve_file(config.THUMBNAILS_DIR, filename)


@router.get("/transcoded/{filename}")
def serve_transcoded(filename: str):
    return _serve_file(config.TRANSCODED_DIR, filename)


@router.get("/display/{filename}")
def serve_display(filename: str):
    return _serve_file(config.DISPLAY_DIR, filename)


@router.get("/blur/{filename}")
def serve_blur(filename: str):
    return _serve_file(config.BLUR_DIR, filename)
