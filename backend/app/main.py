import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.database import SessionLocal, init_db
from app.models import Media
from app.routers import media, settings, uploads
from app.websocket import manager

logger = logging.getLogger(__name__)


def _backfill_blur_images():
    """Generate blur images for existing media that don't have one (idempotent)."""
    from PIL import Image, ImageFilter

    from app.services.video import generate_blur_from_thumbnail

    db = SessionLocal()
    try:
        media_without_blur = db.query(Media).filter(Media.blur_filename.is_(None)).all()
        if not media_without_blur:
            return

        logger.info("Backfilling blur images for %d media items", len(media_without_blur))

        for item in media_without_blur:
            try:
                blur_filename = f"blur_{uuid.uuid4()}.jpg"
                if item.media_type == "photo":
                    source = config.ORIGINALS_DIR / item.filename
                    if not source.exists():
                        continue
                    img = Image.open(source)
                    img.thumbnail((config.BLUR_SIZE, config.BLUR_SIZE), Image.LANCZOS)
                    img = img.filter(ImageFilter.GaussianBlur(radius=10))
                    blur_path = config.BLUR_DIR / blur_filename
                    img.save(blur_path, "JPEG", quality=60)
                else:
                    thumb_path = config.THUMBNAILS_DIR / item.thumb_filename
                    if not thumb_path.exists():
                        continue
                    generate_blur_from_thumbnail(thumb_path, blur_filename)

                item.blur_filename = blur_filename
                db.commit()
            except Exception:
                logger.exception("Failed to generate blur for media_id=%s", item.id)
                db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    _backfill_blur_images()
    yield


app = FastAPI(title="Photo Frame", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media.router)
app.include_router(settings.router)
app.include_router(uploads.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket connection error")
    finally:
        manager.disconnect(websocket)
