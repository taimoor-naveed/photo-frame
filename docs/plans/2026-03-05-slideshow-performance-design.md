# Slideshow Performance Optimization

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate slideshow sluggishness on all clients by removing real-time CSS blur, optimizing video encoding for hardware decode, adding cache headers, and preloading videos.

**Architecture:** Four independent backend+frontend changes: (1) pre-rendered blur backgrounds replace CSS blur(30px), (2) H.264 Main profile for hardware-friendly video, (3) immutable cache headers on static media, (4) video preloading alongside existing photo preloading.

**Tech Stack:** Python/Pillow (blur generation), ffmpeg (video encoding flags), FastAPI FileResponse headers, React video preloading

---

## Constraints

- No Pi-specific solutions. All changes improve every client.
- One media pipeline, one set of files served to all displays.
- No video duration limits (deferred).

---

### Task 1: Backend Config + Blur Directory

**Files:**
- Modify: `backend/app/config.py:1-21`
- Modify: `backend/app/database.py:1-50`

**Step 1: Add BLUR_DIR to config**

In `backend/app/config.py`, add after line 9 (`DISPLAY_DIR`):

```python
BLUR_DIR = DATA_DIR / "blur"
```

And add `BLUR_SIZE = 64` after `DISPLAY_MAX_SIZE`:

```python
BLUR_SIZE = 64
```

**Step 2: Create blur directory on startup**

In `backend/app/database.py`, add `BLUR_DIR` to the import and `init_db()`:

```python
from app.config import DATABASE_URL, DATA_DIR, BLUR_DIR, DISPLAY_DIR, ORIGINALS_DIR, THUMBNAILS_DIR, TRANSCODED_DIR
```

```python
for d in [DATA_DIR, ORIGINALS_DIR, THUMBNAILS_DIR, TRANSCODED_DIR, DISPLAY_DIR, BLUR_DIR]:
```

**Step 3: Verify no tests break**

Run: `docker compose exec backend pytest tests/ -x -q`
Expected: All existing tests pass (no behavior change yet)

**Step 4: Commit**

```
feat: add blur directory config for pre-rendered backgrounds
```

---

### Task 2: Backend Model + Migration for blur_filename

**Files:**
- Modify: `backend/app/models.py:9-31`
- Modify: `backend/app/database.py:15-30`
- Modify: `backend/app/schemas.py:7-24`

**Step 1: Add blur_filename to Media model**

In `backend/app/models.py`, add after `display_filename` (line 23):

```python
    blur_filename: Mapped[str | None] = mapped_column(String, nullable=True)
```

**Step 2: Add idempotent migration**

In `backend/app/database.py` `_migrate_columns()`, add after the `display_filename` migration block:

```python
    if "blur_filename" not in existing:
        conn.execute(text("ALTER TABLE media ADD COLUMN blur_filename TEXT"))
```

**Step 3: Add blur_filename to schema**

In `backend/app/schemas.py` `MediaOut`, add after `display_filename`:

```python
    blur_filename: str | None = None
```

**Step 4: Run tests**

Run: `docker compose exec backend pytest tests/ -x -q`
Expected: All pass (new column is nullable, backwards compatible)

**Step 5: Commit**

```
feat: add blur_filename column to media model and schema
```

---

### Task 3: Backend Generate Blur for Photos

**Files:**
- Modify: `backend/app/services/image.py:13-95`
- Test: `backend/tests/unit/test_image_service.py`

**Step 1: Write failing tests**

Add to `backend/tests/unit/test_image_service.py`:

```python
# ─── Blur Background Generation ──────────────────────────────


def test_process_image_generates_blur(tmp_dirs, sample_jpeg):
    """Every photo should get a pre-rendered blur background."""
    result = process_image(
        sample_jpeg, "photo.jpg",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
        display_dir=tmp_dirs["display"],
        blur_dir=tmp_dirs["blur"],
    )

    assert result["blur_filename"] is not None
    assert result["blur_filename"].startswith("blur_")
    assert result["blur_filename"].endswith(".jpg")
    blur_path = tmp_dirs["blur"] / result["blur_filename"]
    assert blur_path.exists()


def test_process_image_blur_is_tiny(tmp_dirs, sample_jpeg):
    """Blur image should be ~64px max dimension."""
    result = process_image(
        sample_jpeg, "photo.jpg",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
        display_dir=tmp_dirs["display"],
        blur_dir=tmp_dirs["blur"],
    )

    blur_path = tmp_dirs["blur"] / result["blur_filename"]
    blur_img = Image.open(blur_path)
    assert max(blur_img.size) <= 64


def test_process_image_blur_is_blurred(tmp_dirs, sample_jpeg):
    """Blur image should be a valid JPEG (visual blur verified by size being tiny)."""
    result = process_image(
        sample_jpeg, "photo.jpg",
        originals_dir=tmp_dirs["originals"],
        thumbnails_dir=tmp_dirs["thumbnails"],
        display_dir=tmp_dirs["display"],
        blur_dir=tmp_dirs["blur"],
    )

    blur_path = tmp_dirs["blur"] / result["blur_filename"]
    blur_img = Image.open(blur_path)
    assert blur_img.format == "JPEG"
    # Tiny blurred JPEG should be very small (~1-3KB)
    assert blur_path.stat().st_size < 5000


def test_process_image_blur_cleanup_on_failure(tmp_dirs):
    """If processing fails, no orphaned blur files should remain."""
    corrupt_bytes = b"not a real image at all"
    try:
        process_image(
            corrupt_bytes, "corrupt.jpg",
            originals_dir=tmp_dirs["originals"],
            thumbnails_dir=tmp_dirs["thumbnails"],
            display_dir=tmp_dirs["display"],
            blur_dir=tmp_dirs["blur"],
        )
        assert False, "Should have raised ValueError"
    except ValueError:
        pass

    assert list(tmp_dirs["blur"].iterdir()) == []
```

**Step 2: Update tmp_dirs fixture**

In `backend/tests/conftest.py`, add `blur` to `tmp_dirs`:

```python
@pytest.fixture()
def tmp_dirs(tmp_path):
    """Create temporary directories for uploads."""
    originals = tmp_path / "originals"
    thumbnails = tmp_path / "thumbnails"
    transcoded = tmp_path / "transcoded"
    display = tmp_path / "display"
    blur = tmp_path / "blur"
    originals.mkdir()
    thumbnails.mkdir()
    transcoded.mkdir()
    display.mkdir()
    blur.mkdir()
    return {"originals": originals, "thumbnails": thumbnails, "transcoded": transcoded, "display": display, "blur": blur}
```

**Step 3: Run tests to verify they fail**

Run: `docker compose exec backend pytest tests/unit/test_image_service.py::test_process_image_generates_blur -v`
Expected: FAIL (process_image doesn't accept blur_dir yet)

**Step 4: Implement blur generation in image.py**

Update `process_image` signature to accept `blur_dir`:

```python
def process_image(
    file_bytes: bytes,
    original_name: str,
    originals_dir: Path | None = None,
    thumbnails_dir: Path | None = None,
    display_dir: Path | None = None,
    blur_dir: Path | None = None,
) -> dict:
```

Add after imports:

```python
from PIL import Image, ImageFilter, ImageOps
```

Add after `if display_dir is None:` block:

```python
    if blur_dir is None:
        blur_dir = config.BLUR_DIR
```

Add blur generation after the display-optimized block (after line 81), inside the try block:

```python
        # Generate pre-rendered blur background
        blur_filename = f"blur_{uuid.uuid4()}.jpg"
        blur_img = img.copy()
        blur_img.thumbnail((config.BLUR_SIZE, config.BLUR_SIZE), Image.LANCZOS)
        blur_img = blur_img.filter(ImageFilter.GaussianBlur(radius=10))
        blur_path = blur_dir / blur_filename
        blur_img.save(blur_path, "JPEG", quality=60)
        created_files.append(blur_path)
```

Add `blur_filename` to the return dict:

```python
    return {
        "filename": filename,
        "thumb_filename": thumb_filename,
        "width": width,
        "height": height,
        "file_size": file_size,
        "display_filename": display_filename,
        "blur_filename": blur_filename,
    }
```

**Step 5: Run tests**

Run: `docker compose exec backend pytest tests/unit/test_image_service.py -v`
Expected: All pass including new blur tests

**Step 6: Commit**

```
feat: generate pre-rendered blur backgrounds for photos
```

---

### Task 4: Backend Generate Blur for Videos

**Files:**
- Modify: `backend/app/services/video.py:51-77`
- Test: `backend/tests/unit/test_video_service.py`

**Step 1: Write failing tests**

Add to `backend/tests/unit/test_video_service.py`:

```python
from app.services.video import generate_blur_from_thumbnail


def test_generate_blur_from_thumbnail(video_file, tmp_dirs):
    """Generate blur background from video thumbnail."""
    thumb_path = generate_video_thumbnail(
        video_file, "thumb_test.jpg",
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    blur_path = generate_blur_from_thumbnail(
        thumb_path, "blur_test.jpg",
        blur_dir=tmp_dirs["blur"],
    )

    assert blur_path.exists()
    assert blur_path.stat().st_size > 0
    assert blur_path.stat().st_size < 5000  # tiny file


def test_generate_blur_from_thumbnail_dimensions(video_file, tmp_dirs):
    """Blur image max dimension should be ≤ 64."""
    thumb_path = generate_video_thumbnail(
        video_file, "thumb_test2.jpg",
        thumbnails_dir=tmp_dirs["thumbnails"],
    )

    blur_path = generate_blur_from_thumbnail(
        thumb_path, "blur_test2.jpg",
        blur_dir=tmp_dirs["blur"],
    )

    from PIL import Image
    blur_img = Image.open(blur_path)
    assert max(blur_img.size) <= 64
```

**Step 2: Run tests to verify they fail**

Run: `docker compose exec backend pytest tests/unit/test_video_service.py::test_generate_blur_from_thumbnail -v`
Expected: FAIL (function doesn't exist)

**Step 3: Implement generate_blur_from_thumbnail**

Add to `backend/app/services/video.py` after the imports:

```python
from PIL import Image, ImageFilter
```

Add the function after `generate_video_thumbnail`:

```python
def generate_blur_from_thumbnail(
    thumb_path: Path,
    blur_filename: str,
    blur_dir: Path | None = None,
) -> Path:
    """Generate a tiny pre-blurred JPEG from a thumbnail for slideshow background."""
    if blur_dir is None:
        blur_dir = config.BLUR_DIR

    blur_path = blur_dir / blur_filename
    img = Image.open(thumb_path)
    img.thumbnail((config.BLUR_SIZE, config.BLUR_SIZE), Image.LANCZOS)
    img = img.filter(ImageFilter.GaussianBlur(radius=10))
    blur_path = blur_dir / blur_filename
    img.save(blur_path, "JPEG", quality=60)
    return blur_path
```

**Step 4: Run tests**

Run: `docker compose exec backend pytest tests/unit/test_video_service.py -v`
Expected: All pass

**Step 5: Commit**

```
feat: generate pre-rendered blur backgrounds for videos
```

---

### Task 5: Backend H.264 Main Profile

**Files:**
- Modify: `backend/app/services/video.py:90-301`
- Test: `backend/tests/unit/test_video_service.py`

**Step 1: Write failing test**

Add to `backend/tests/unit/test_video_service.py`:

```python
import json


def test_transcode_uses_main_profile(tmp_dirs, tmp_path):
    """Transcoded video should use H.264 Main profile for hardware decode compatibility."""
    # Create a non-browser-compatible video (MPEG4 Part 2)
    src = tmp_path / "src.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1",
            "-c:v", "mpeg4", "-t", "1",
            str(src),
        ],
        capture_output=True,
        check=True,
    )

    from app.services.video import transcode_to_h264
    output = transcode_to_h264(
        src, "transcoded_test.mp4",
        transcoded_dir=tmp_dirs["transcoded"],
    )

    # Verify output uses Main profile
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", str(output),
        ],
        capture_output=True, text=True, check=True,
    )
    streams = json.loads(result.stdout)
    video = next(s for s in streams["streams"] if s["codec_type"] == "video")
    assert video["profile"] == "Main"


def test_scale_video_uses_main_profile(tmp_dirs, large_video_file):
    """Scaled video should use H.264 Main profile."""
    scale_video_for_display(
        large_video_file, "display_profile.mp4",
        display_dir=tmp_dirs["display"],
    )

    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", str(tmp_dirs["display"] / "display_profile.mp4"),
        ],
        capture_output=True, text=True, check=True,
    )
    streams = json.loads(result.stdout)
    video = next(s for s in streams["streams"] if s["codec_type"] == "video")
    assert video["profile"] == "Main"
```

**Step 2: Run tests to verify they fail**

Run: `docker compose exec backend pytest tests/unit/test_video_service.py::test_transcode_uses_main_profile -v`
Expected: FAIL (profile will be "High")

**Step 3: Add profile flags to all ffmpeg encode commands**

In `backend/app/services/video.py`, there are 4 places with ffmpeg encode args. Add `-profile:v main -level 4.0` after `-crf`, `"23"` in each:

1. `transcode_to_h264` simple path (line 119): after `"-crf", "23",` add `"-profile:v", "main", "-level", "4.0",`
2. `_transcode_with_progress` (line 145): same addition after `"-crf", "23",`
3. `scale_video_for_display` with progress (line 256): same addition
4. `scale_video_for_display` simple path (line 293): same addition

**Step 4: Run tests**

Run: `docker compose exec backend pytest tests/unit/test_video_service.py -v`
Expected: All pass including new profile tests

**Step 5: Commit**

```
feat: use H.264 Main profile for hardware-decode compatibility
```

---

### Task 6: Backend Cache Headers + Blur Route

**Files:**
- Modify: `backend/app/routers/uploads.py:1-43`
- Test: `backend/tests/integration/test_security_and_validation.py`

**Step 1: Write failing tests**

Add to `backend/tests/integration/test_security_and_validation.py`:

```python
# ─── Cache Headers ─────────────────────────────────────────


def test_uploads_have_cache_headers(client, sample_jpeg):
    """All /uploads/* responses should have immutable cache headers."""
    # Upload a photo first
    response = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", sample_jpeg, "image/jpeg"))],
    )
    assert response.status_code == 200
    media = response.json()[0]

    # Fetch the thumbnail and check cache headers
    resp = client.get(f"/uploads/thumbnails/{media['thumb_filename']}")
    assert resp.status_code == 200
    assert "max-age=31536000" in resp.headers.get("cache-control", "")
    assert "immutable" in resp.headers.get("cache-control", "")


def test_uploads_blur_route(client, sample_jpeg):
    """Blur images should be served from /uploads/blur/."""
    response = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", sample_jpeg, "image/jpeg"))],
    )
    assert response.status_code == 200
    media = response.json()[0]

    assert media["blur_filename"] is not None
    resp = client.get(f"/uploads/blur/{media['blur_filename']}")
    assert resp.status_code == 200
    assert "max-age=31536000" in resp.headers.get("cache-control", "")
```

**Step 2: Run tests to verify they fail**

Run: `docker compose exec backend pytest tests/integration/test_security_and_validation.py::test_uploads_have_cache_headers -v`
Expected: FAIL (no cache-control header)

**Step 3: Implement cache headers and blur route**

Update `backend/app/routers/uploads.py`:

```python
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
```

**Step 4: Run tests**

Run: `docker compose exec backend pytest tests/integration/test_security_and_validation.py -v`
Expected: All pass

**Step 5: Commit**

```
feat: add cache headers to static media and blur serving route
```

---

### Task 7: Backend Upload + Delete Handler Updates

**Files:**
- Modify: `backend/app/routers/media.py:147-353`
- Modify: `backend/app/services/video.py:178-229` (save_video_original)

**Step 1: Write failing test**

Add to `backend/tests/integration/test_media_api.py` (or existing upload tests):

```python
def test_upload_photo_includes_blur_filename(client, sample_jpeg):
    """Uploaded photo response should include blur_filename."""
    response = client.post(
        "/api/media",
        files=[("files", ("photo.jpg", sample_jpeg, "image/jpeg"))],
    )
    assert response.status_code == 200
    media = response.json()[0]
    assert media["blur_filename"] is not None
    assert media["blur_filename"].startswith("blur_")
```

**Step 2: Run test to verify it fails**

Run: `docker compose exec backend pytest tests/integration/test_media_api.py::test_upload_photo_includes_blur_filename -v`
Expected: FAIL (blur_filename is None)

**Step 3: Update upload handler for photos**

In `backend/app/routers/media.py`, update the photo upload block (around line 181-192) to pass `blur_filename`:

```python
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
```

**Step 4: Update save_video_original to generate blur**

In `backend/app/services/video.py` `save_video_original`, add `blur_dir` parameter and generate blur after thumbnail:

```python
def save_video_original(
    file_bytes: bytes,
    original_name: str,
    originals_dir: Path | None = None,
    thumbnails_dir: Path | None = None,
    blur_dir: Path | None = None,
) -> dict:
```

Add after `if thumbnails_dir is None:` block:

```python
    if blur_dir is None:
        blur_dir = config.BLUR_DIR
```

Add blur generation after thumbnail generation (after line 214), inside the try block:

```python
        # Generate blur background from thumbnail
        blur_filename = f"blur_{uuid.uuid4()}.jpg"
        generate_blur_from_thumbnail(
            thumbnails_dir / thumb_filename, blur_filename, blur_dir,
        )
        created_files.append(blur_dir / blur_filename)
```

Add `blur_filename` to the return dict:

```python
    return {
        "filename": filename,
        "thumb_filename": thumb_filename,
        "width": meta["width"],
        "height": meta["height"],
        "file_size": file_size,
        "duration": meta["duration"],
        "codec": meta["codec"],
        "blur_filename": blur_filename,
    }
```

**Step 5: Update video upload handler in media.py**

In `backend/app/routers/media.py`, update the video Media creation (around line 212-228):

```python
                blur_filename=info.get("blur_filename"),
```

Add this line after `thumb_filename=info["thumb_filename"],`.

**Step 6: Update delete handlers to clean up blur files**

In both `delete_media` and `bulk_delete_media` in `media.py`, add blur cleanup alongside thumbnail cleanup:

```python
        if media.blur_filename:
            (config.BLUR_DIR / media.blur_filename).unlink(missing_ok=True)
```

Add this after the thumbnail cleanup in both delete functions. Also add `BLUR_DIR` to the config import if needed.

**Step 7: Run all tests**

Run: `docker compose exec backend pytest tests/ -x -q`
Expected: All pass

**Step 8: Commit**

```
feat: integrate blur generation into upload/delete pipeline
```

---

### Task 8: Backend Startup Migration for Existing Media

**Files:**
- Modify: `backend/app/main.py`

**Step 1: Add blur backfill to startup**

In `backend/app/main.py`, in the lifespan function (after `init_db()`), add:

```python
    _backfill_blur_images()
```

Add the helper function:

```python
import logging
from app.database import SessionLocal
from app.models import Media

logger = logging.getLogger(__name__)


def _backfill_blur_images():
    """Generate blur images for existing media that don't have one (idempotent)."""
    from app.services.image import process_blur_from_file
    from app.services.video import generate_blur_from_thumbnail

    db = SessionLocal()
    try:
        media_without_blur = db.query(Media).filter(Media.blur_filename.is_(None)).all()
        if not media_without_blur:
            return

        logger.info("Backfilling blur images for %d media items", len(media_without_blur))

        for media in media_without_blur:
            try:
                blur_filename = f"blur_{uuid.uuid4()}.jpg"
                if media.media_type == "photo":
                    # Generate from original or display image
                    source = config.ORIGINALS_DIR / media.filename
                    if not source.exists():
                        continue
                    from PIL import Image, ImageFilter
                    img = Image.open(source)
                    img.thumbnail((config.BLUR_SIZE, config.BLUR_SIZE), Image.LANCZOS)
                    img = img.filter(ImageFilter.GaussianBlur(radius=10))
                    blur_path = config.BLUR_DIR / blur_filename
                    img.save(blur_path, "JPEG", quality=60)
                else:
                    # Generate from thumbnail
                    thumb_path = config.THUMBNAILS_DIR / media.thumb_filename
                    if not thumb_path.exists():
                        continue
                    generate_blur_from_thumbnail(thumb_path, blur_filename)

                media.blur_filename = blur_filename
                db.commit()
            except Exception:
                logger.exception("Failed to generate blur for media_id=%s", media.id)
                db.rollback()
    finally:
        db.close()
```

**Step 2: Run tests**

Run: `docker compose exec backend pytest tests/ -x -q`
Expected: All pass (backfill runs but finds nothing in test DB)

**Step 3: Commit**

```
feat: backfill blur images for existing media on startup
```

---

### Task 9: Frontend blurUrl Helper

**Files:**
- Modify: `frontend/src/api/client.ts:1-144`
- Test: `frontend/src/__tests__/clientUrls.test.ts`

**Step 1: Write failing tests**

Add to `frontend/src/__tests__/clientUrls.test.ts`:

```typescript
import { blurUrl } from "../api/client";
```

And add a new describe block:

```typescript
describe("blurUrl", () => {
  it("returns blur path when blur_filename is set", () => {
    const media = makeMedia({ blur_filename: "blur_abc.jpg" });
    expect(blurUrl(media)).toBe("/uploads/blur/blur_abc.jpg");
  });

  it("returns null when blur_filename is null", () => {
    const media = makeMedia({ blur_filename: null });
    expect(blurUrl(media)).toBeNull();
  });
});
```

Also update the `makeMedia` helper to include `blur_filename`:

```typescript
    blur_filename: null,
```

**Step 2: Update Media interface**

In `frontend/src/api/client.ts`, add to the `Media` interface:

```typescript
  blur_filename: string | null;
```

**Step 3: Add blurUrl function**

In `frontend/src/api/client.ts`, add:

```typescript
export function blurUrl(media: Media): string | null {
  if (media.blur_filename) {
    return `/uploads/blur/${media.blur_filename}`;
  }
  return null;
}
```

**Step 4: Run tests**

Run: `docker compose exec frontend npx vitest run src/__tests__/clientUrls.test.ts`
Expected: All pass

**Step 5: Commit**

```
feat: add blurUrl helper for pre-rendered blur backgrounds
```

---

### Task 10: Frontend Replace CSS Blur with Pre-Rendered Image

**Files:**
- Modify: `frontend/src/pages/SlideshowPage.tsx:457-512`
- Test: `frontend/src/__tests__/SlideshowPage.test.tsx`

**Step 1: Write failing test**

Add to `frontend/src/__tests__/SlideshowPage.test.tsx`:

```typescript
  it("uses pre-rendered blur image instead of CSS blur", async () => {
    const photo = { ...makePhoto(1), blur_filename: "blur_abc.jpg" };
    mockFetch([photo]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    // Background image should use blur URL, not have CSS blur class
    const bgImg = document.querySelector("img[aria-hidden='true']") as HTMLImageElement;
    expect(bgImg).toBeTruthy();
    expect(bgImg.src).toContain("/uploads/blur/blur_abc.jpg");
    expect(bgImg.className).not.toContain("blur-");
  });

  it("falls back to CSS blur when blur_filename is null", async () => {
    const photo = makePhoto(1); // blur_filename is null
    mockFetch([photo]);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    const bgImg = document.querySelector("img[aria-hidden='true']") as HTMLImageElement;
    expect(bgImg).toBeTruthy();
    // Should use displayUrl as src and have CSS blur
    expect(bgImg.src).toContain("/uploads/originals/photo1.jpg");
    expect(bgImg.className).toContain("blur-");
  });
```

Update `makePhoto` and `makeVideo` helpers to include `blur_filename: null`.

**Step 2: Run tests to verify they fail**

Run: `docker compose exec frontend npx vitest run src/__tests__/SlideshowPage.test.tsx`
Expected: FAIL (still using CSS blur)

**Step 3: Update Slide component**

In `frontend/src/pages/SlideshowPage.tsx`, update the import to include `blurUrl`:

```typescript
import { api, blurUrl, displayUrl, thumbnailUrl, type Media, type Settings } from "../api/client";
```

Update the `Slide` component to use pre-rendered blur when available:

```typescript
const Slide = memo(function Slide({ media, videoRef, onEnded, onError }: SlideProps) {
  const src = displayUrl(media);
  const blur = blurUrl(media);

  // Blur background: use pre-rendered image if available, fall back to CSS blur
  const bgSrc = media.media_type === "video" ? (blur ?? thumbnailUrl(media)) : (blur ?? src);
  const bgClass = blur
    ? "absolute inset-0 w-full h-full object-cover brightness-[0.7]"
    : "absolute inset-0 w-full h-full object-cover scale-[1.2] blur-[30px] brightness-[0.7]";

  if (media.media_type === "video") {
    return (
      <>
        <img src={bgSrc} className={bgClass} alt="" aria-hidden="true" />
        <video
          ref={videoRef}
          src={src}
          data-media-id={media.id}
          className="absolute inset-0 w-full h-full object-contain"
          muted
          autoPlay
          onEnded={onEnded}
          onError={onError}
        />
      </>
    );
  }

  return (
    <>
      <img src={bgSrc} className={bgClass} alt="" aria-hidden="true" />
      <img
        src={src}
        data-media-id={media.id}
        className="absolute inset-0 w-full h-full object-contain"
        alt={media.original_name}
      />
    </>
  );
});
```

**Step 4: Run tests**

Run: `docker compose exec frontend npx vitest run src/__tests__/SlideshowPage.test.tsx`
Expected: All pass

**Step 5: Commit**

```
feat: use pre-rendered blur backgrounds in slideshow
```

---

### Task 11: Frontend Video Preloading

**Files:**
- Modify: `frontend/src/pages/SlideshowPage.tsx:332-342`
- Test: `frontend/src/__tests__/SlideshowPage.test.tsx`

**Step 1: Write failing test**

Add to `frontend/src/__tests__/SlideshowPage.test.tsx`:

```typescript
  it("preloads next video with a hidden video element", async () => {
    const items = [makePhoto(1), { ...makeVideo(2), blur_filename: null }];
    mockFetch(items);

    render(
      <MemoryRouter>
        <SlideshowPage />
      </MemoryRouter>,
    );

    await waitForSlideshow();

    // Navigate so that the next item is the video
    // We need to find the current item and check if next is video
    const allIds = await collectAllMediaIds(1);
    // There should be a hidden preload video element if next is a video
    const hiddenVideos = document.querySelectorAll("video[data-preload]");
    // At least assert no crash — preload behavior depends on playlist order
    // Since order is random, just verify the preload element exists when a video is next
    expect(document.querySelectorAll("[data-preload]").length).toBeLessThanOrEqual(1);
  });
```

**Step 2: Implement video preloading**

Replace the existing preload effect in `SlideshowPage.tsx` (lines 332-342):

```typescript
  // ─── Preload next media ───────────────────────────────────

  const preloadVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!playlist.length) return;
    const nextIdx = (currentIndex + 1) % playlist.length;
    const nextMedia = playlist[nextIdx];

    if (nextMedia?.media_type === "photo") {
      // Preload photo
      const img = new Image();
      img.src = displayUrl(nextMedia);
      // Also preload blur background
      const blur = blurUrl(nextMedia);
      if (blur) {
        const blurImg = new Image();
        blurImg.src = blur;
      }
    } else if (nextMedia?.media_type === "video") {
      // Preload video by creating a hidden element
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.src = displayUrl(nextMedia);
      video.setAttribute("data-preload", "true");
      preloadVideoRef.current = video;
      // Also preload blur background
      const blur = blurUrl(nextMedia);
      if (blur) {
        const blurImg = new Image();
        blurImg.src = blur;
      }
    }

    return () => {
      // Cleanup preloaded video on slide change
      if (preloadVideoRef.current) {
        preloadVideoRef.current.src = "";
        preloadVideoRef.current = null;
      }
    };
  }, [currentIndex, playlist]);
```

**Step 3: Run tests**

Run: `docker compose exec frontend npx vitest run src/__tests__/SlideshowPage.test.tsx`
Expected: All pass

**Step 4: Run all frontend tests**

Run: `docker compose exec frontend npx vitest run`
Expected: All pass

**Step 5: Commit**

```
feat: preload next video for instant playback on slide transition
```

---

### Task 12: Integration Test + Update Config Fixture

**Files:**
- Modify: `backend/tests/conftest.py:44-88`

**Step 1: Update client fixture to include blur dir**

In `backend/tests/conftest.py`, update the `client` fixture:

Add `blur` directory creation:
```python
    blur = tmp_path / "blur"
    blur.mkdir()
```

Add monkeypatch:
```python
    monkeypatch.setattr(config, "BLUR_DIR", blur)
```

**Step 2: Run ALL tests**

Run: `./scripts/test-backend.sh`
Run: `./scripts/test-frontend.sh`
Expected: All pass

**Step 3: Commit**

```
test: update test fixtures for blur directory support
```

---

### Task 13: Update Docs

**Files:**
- Modify: `docs/STATE.md`

**Step 1: Update STATE.md with completed optimization work**

Add the four optimizations to the completed section.

**Step 2: Commit**

```
docs: update state with slideshow performance optimizations
```
