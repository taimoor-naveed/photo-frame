import asyncio
import hashlib
import logging
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app import config
from app.database import SessionLocal, get_db
from app.models import Media
from app.schemas import BulkDeleteRequest, BulkDeleteResponse, MediaListOut, MediaOut
from app.services.image import process_image
from app.services.video import needs_transcode, save_video_original, scale_video_for_display, transcode_to_h264
from app.websocket import manager

router = APIRouter(prefix="/api/media", tags=["media"])
logger = logging.getLogger(__name__)


def _broadcast(loop: asyncio.AbstractEventLoop, message: dict) -> None:
    """Schedule a WebSocket broadcast on the given event loop (error-safe)."""
    try:
        asyncio.run_coroutine_threadsafe(manager.broadcast(message), loop)
    except Exception:
        logger.exception("WebSocket broadcast failed for message type=%s", message.get("type"))


def _transcode_in_background(
    media_id: int,
    original_path: Path,
    duration: float,
    loop: asyncio.AbstractEventLoop,
) -> None:
    """Run ffmpeg transcode in a background thread, then update DB + notify clients."""
    try:
        transcoded_filename = f"{uuid.uuid4()}.mp4"
        last_broadcast = [0]  # mutable container for closure

        def _on_progress(pct: int) -> None:
            # Throttle: only broadcast every 3 percentage points
            if pct - last_broadcast[0] >= 3 or pct >= 100:
                last_broadcast[0] = pct
                _broadcast(loop, {
                    "type": "media_processing_progress",
                    "payload": {"id": media_id, "progress": pct},
                })

        output_path = transcode_to_h264(
            original_path, transcoded_filename,
            duration=duration, on_progress=_on_progress,
        )

        db = SessionLocal()
        try:
            media = db.query(Media).filter(Media.id == media_id).first()
            if media:
                media.processing_status = "ready"
                media.transcoded_filename = transcoded_filename
                media.display_filename = transcoded_filename  # transcode already scales to 1920
                db.commit()
                db.refresh(media)
                _broadcast(loop, {
                    "type": "media_processing_complete",
                    "payload": MediaOut.model_validate(media).model_dump(mode="json"),
                })
            else:
                # Record was deleted during processing — clean up orphaned file
                output_path.unlink(missing_ok=True)
        finally:
            db.close()
    except Exception:
        logger.exception("Transcode failed for media_id=%s", media_id)
        db = SessionLocal()
        try:
            media = db.query(Media).filter(Media.id == media_id).first()
            if media:
                media.processing_status = "error"
                db.commit()
                _broadcast(loop, {
                    "type": "media_processing_error",
                    "payload": {"id": media_id},
                })
        finally:
            db.close()


def _scale_display_in_background(
    media_id: int,
    original_path: Path,
    duration: float,
    loop: asyncio.AbstractEventLoop,
) -> None:
    """Scale a browser-compatible video to display size in a background thread."""
    try:
        display_filename = f"display_{uuid.uuid4()}.mp4"
        last_broadcast = [0]

        def _on_progress(pct: int) -> None:
            if pct - last_broadcast[0] >= 3 or pct >= 100:
                last_broadcast[0] = pct
                _broadcast(loop, {
                    "type": "media_processing_progress",
                    "payload": {"id": media_id, "progress": pct},
                })

        output_path = scale_video_for_display(
            original_path, display_filename,
            duration=duration, on_progress=_on_progress,
        )

        db = SessionLocal()
        try:
            media = db.query(Media).filter(Media.id == media_id).first()
            if media:
                media.processing_status = "ready"
                media.display_filename = display_filename
                db.commit()
                db.refresh(media)
                _broadcast(loop, {
                    "type": "media_processing_complete",
                    "payload": MediaOut.model_validate(media).model_dump(mode="json"),
                })
            else:
                # Record was deleted during processing — clean up orphaned file
                output_path.unlink(missing_ok=True)
        finally:
            db.close()
    except Exception:
        logger.exception("Display scaling failed for media_id=%s", media_id)
        db = SessionLocal()
        try:
            media = db.query(Media).filter(Media.id == media_id).first()
            if media:
                media.processing_status = "error"
                db.commit()
                _broadcast(loop, {
                    "type": "media_processing_error",
                    "payload": {"id": media_id},
                })
        finally:
            db.close()


@router.post("", response_model=list[MediaOut])
async def upload_media(files: list[UploadFile], db: Session = Depends(get_db)):
    # ─── Phase 0: Read all files and validate upfront ─────────
    file_data: list[tuple[str, str, bytes]] = []  # (original_name, ext, content)
    for file in files:
        ext = Path(file.filename or "").suffix.lower()
        if ext not in config.ALLOWED_IMAGE_EXTENSIONS and ext not in config.ALLOWED_VIDEO_EXTENSIONS:
            raise HTTPException(400, f"Unsupported file type: {ext}")

        content = await file.read()
        if len(content) == 0:
            raise HTTPException(400, f"Empty file: {file.filename}")
        if len(content) > config.MAX_UPLOAD_SIZE:
            raise HTTPException(400, f"File too large: {len(content)} bytes (max {config.MAX_UPLOAD_SIZE})")

        file_data.append((file.filename or f"upload{ext}", ext, content))

    # ─── Phase 1: Process each file ──────────────────────────
    results = []
    loop = asyncio.get_running_loop()

    for original_name, ext, content in file_data:
        # Duplicate detection via content hash
        content_hash = hashlib.sha256(content).hexdigest()
        existing = db.query(Media).filter(Media.content_hash == content_hash).first()
        if existing:
            results.append(existing)
            continue

        if ext in config.ALLOWED_IMAGE_EXTENSIONS:
            try:
                info = process_image(content, original_name)
            except (ValueError, Exception) as exc:
                raise HTTPException(400, f"Invalid image file '{original_name}': {exc}") from exc
            media = Media(
                filename=info["filename"],
                original_name=original_name,
                media_type="photo",
                width=info["width"],
                height=info["height"],
                file_size=info["file_size"],
                thumb_filename=info["thumb_filename"],
                display_filename=info.get("display_filename"),
                blur_filename=info.get("blur_filename"),
                processing_status="ready",
                content_hash=content_hash,
            )
            db.add(media)
            db.commit()
            db.refresh(media)
            results.append(media)

            asyncio.create_task(
                manager.broadcast({"type": "media_added", "payload": MediaOut.model_validate(media).model_dump(mode="json")})
            )
        else:
            # Video: save + thumbnail (fast), then transcode in background if needed
            try:
                info = save_video_original(content, original_name)
            except (ValueError, Exception) as exc:
                raise HTTPException(400, f"Invalid video file '{original_name}': {exc}") from exc
            require_transcode = needs_transcode(info["codec"])
            needs_display_scale_check = (
                not require_transcode
                and max(info["width"], info["height"]) > config.DISPLAY_MAX_SIZE
            )
            media = Media(
                filename=info["filename"],
                original_name=original_name,
                media_type="video",
                width=info["width"],
                height=info["height"],
                file_size=info["file_size"],
                duration=info["duration"],
                codec=info["codec"],
                thumb_filename=info["thumb_filename"],
                blur_filename=info.get("blur_filename"),
                processing_status="processing" if (require_transcode or needs_display_scale_check) else "ready",
                content_hash=content_hash,
            )
            db.add(media)
            db.commit()
            db.refresh(media)
            results.append(media)

            asyncio.create_task(
                manager.broadcast({"type": "media_added", "payload": MediaOut.model_validate(media).model_dump(mode="json")})
            )

            if require_transcode:
                # Kick off transcode in background thread (also scales to DISPLAY_MAX_SIZE)
                original_path = config.ORIGINALS_DIR / info["filename"]
                thread = threading.Thread(
                    target=_transcode_in_background,
                    args=(media.id, original_path, info["duration"], loop),
                    daemon=True,
                )
                thread.start()
            elif needs_display_scale_check:
                # Browser-compatible but oversized — scale in background
                original_path = config.ORIGINALS_DIR / info["filename"]
                thread = threading.Thread(
                    target=_scale_display_in_background,
                    args=(media.id, original_path, info["duration"], loop),
                    daemon=True,
                )
                thread.start()

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


@router.delete("/bulk", response_model=BulkDeleteResponse)
async def bulk_delete_media(body: BulkDeleteRequest, db: Session = Depends(get_db)):
    deleted = []
    not_found = []
    seen = set()

    for media_id in body.ids:
        if media_id in seen:
            not_found.append(media_id)
            continue
        seen.add(media_id)

        media = db.query(Media).filter(Media.id == media_id).first()
        if not media:
            not_found.append(media_id)
            continue

        # Remove files from disk
        for path in [
            config.ORIGINALS_DIR / media.filename,
            config.THUMBNAILS_DIR / media.thumb_filename,
        ]:
            path.unlink(missing_ok=True)

        if media.transcoded_filename:
            (config.TRANSCODED_DIR / media.transcoded_filename).unlink(missing_ok=True)
        if media.display_filename:
            (config.DISPLAY_DIR / media.display_filename).unlink(missing_ok=True)
        if media.blur_filename:
            (config.BLUR_DIR / media.blur_filename).unlink(missing_ok=True)

        db.delete(media)
        deleted.append(media_id)

    db.commit()

    # Broadcast individual media_deleted events for each deleted item
    for media_id in deleted:
        asyncio.create_task(
            manager.broadcast({"type": "media_deleted", "payload": {"id": media_id}})
        )

    return BulkDeleteResponse(deleted=deleted, not_found=not_found)


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
    if media.display_filename:
        (config.DISPLAY_DIR / media.display_filename).unlink(missing_ok=True)
    if media.blur_filename:
        (config.BLUR_DIR / media.blur_filename).unlink(missing_ok=True)

    db.delete(media)
    db.commit()

    asyncio.create_task(
        manager.broadcast({"type": "media_deleted", "payload": {"id": media_id}})
    )

    return {"ok": True}
