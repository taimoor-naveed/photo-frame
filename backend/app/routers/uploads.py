from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app import config

router = APIRouter(prefix="/uploads", tags=["uploads"])


def _serve_file(directory: Path, filename: str) -> FileResponse:
    path = (directory / filename).resolve()
    if not path.is_relative_to(directory.resolve()):
        raise HTTPException(403, "Access denied")
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path)


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
