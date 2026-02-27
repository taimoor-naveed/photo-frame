import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app import config
from app.database import get_db
from app.models import Media
from app.schemas import MediaListOut, MediaOut
from app.services.image import process_image
from app.services.video import process_video
from app.websocket import manager

router = APIRouter(prefix="/api/media", tags=["media"])


@router.post("", response_model=list[MediaOut])
async def upload_media(files: list[UploadFile], db: Session = Depends(get_db)):
    results = []
    for file in files:
        ext = Path(file.filename or "").suffix.lower()
        if ext not in config.ALLOWED_IMAGE_EXTENSIONS and ext not in config.ALLOWED_VIDEO_EXTENSIONS:
            raise HTTPException(400, f"Unsupported file type: {ext}")

        content = await file.read()
        if len(content) > config.MAX_UPLOAD_SIZE:
            raise HTTPException(400, f"File too large: {len(content)} bytes (max {config.MAX_UPLOAD_SIZE})")

        if ext in config.ALLOWED_IMAGE_EXTENSIONS:
            info = process_image(content, file.filename or "upload.jpg")
            media = Media(
                filename=info["filename"],
                original_name=file.filename or "upload.jpg",
                media_type="photo",
                width=info["width"],
                height=info["height"],
                file_size=info["file_size"],
                thumb_filename=info["thumb_filename"],
            )
        else:
            info = process_video(content, file.filename or "upload.mp4")
            media = Media(
                filename=info["filename"],
                original_name=file.filename or "upload.mp4",
                media_type="video",
                width=info["width"],
                height=info["height"],
                file_size=info["file_size"],
                duration=info["duration"],
                codec=info["codec"],
                thumb_filename=info["thumb_filename"],
                transcoded_filename=info["transcoded_filename"],
            )

        db.add(media)
        db.commit()
        db.refresh(media)
        results.append(media)

        asyncio.create_task(
            manager.broadcast({"event": "media_added", "data": MediaOut.model_validate(media).model_dump(mode="json")})
        )

    return results


@router.get("", response_model=MediaListOut)
def list_media(page: int = 1, per_page: int = 20, db: Session = Depends(get_db)):
    if page < 1:
        page = 1
    if per_page < 1:
        per_page = 1
    if per_page > 100:
        per_page = 100

    total = db.query(Media).count()
    items = (
        db.query(Media)
        .order_by(Media.uploaded_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    return MediaListOut(items=items, total=total, page=page, per_page=per_page)


@router.get("/{media_id}", response_model=MediaOut)
def get_media(media_id: int, db: Session = Depends(get_db)):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(404, "Media not found")
    return media


@router.delete("/{media_id}")
async def delete_media(media_id: int, db: Session = Depends(get_db)):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(404, "Media not found")

    # Remove files from disk
    for path in [
        config.ORIGINALS_DIR / media.filename,
        config.THUMBNAILS_DIR / media.thumb_filename,
    ]:
        path.unlink(missing_ok=True)

    if media.transcoded_filename:
        (config.TRANSCODED_DIR / media.transcoded_filename).unlink(missing_ok=True)

    db.delete(media)
    db.commit()

    asyncio.create_task(
        manager.broadcast({"event": "media_deleted", "data": {"id": media_id}})
    )

    return {"ok": True}
