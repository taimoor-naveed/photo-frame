# Live Photo & Motion Photo Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable uploading Live Photos (iOS) and Motion Photos (Android) to the photo frame, extracting the embedded video so it plays in the slideshow.

**Architecture:**
- **Android Motion Photos**: Server-side extraction. User uploads the JPEG from the browser as usual. Backend detects the embedded video (via XMP metadata or Samsung markers), extracts it, and creates a separate video media record. No app needed.
- **iOS Live Photos**: iOS Shortcut. Safari can't access the video component of a Live Photo, so an iOS Shortcut extracts the MOV and uploads it to the backend API. No app needed.
- **Everything else**: Existing web UI (gallery, settings, deletion) works on mobile browsers as-is.

**Tech Stack:** Python (backend extraction), iOS Shortcuts (no code — configured on device), existing FastAPI + React stack.

**All work runs in Docker** using the existing `docker compose exec` workflow. No Xcode, no Android Studio, no native builds.

---

## Phase 1: Motion Photo Detection Service

Backend service to detect whether a JPEG/HEIC contains an embedded Motion Photo video.

### How Motion Photos work

A Motion Photo is a valid JPEG with video bytes appended after the image data. Four known formats:

| Manufacturer | Format | Detection | Video location |
|-------------|--------|-----------|---------------|
| Google Pixel (pre-Android 11) | XMP `GCamera:MicroVideo="1"` | `MicroVideoOffset` in XMP | `file_size - MicroVideoOffset` to EOF |
| Google Pixel (Android 11+) | XMP `GCamera:MotionPhoto="1"` | `Container:Directory` with `Item:Length` | `file_size - Item:Length` to EOF |
| Samsung (older) | ASCII marker | `MotionPhoto_Data` byte sequence | After the 16-byte marker to EOF |
| Samsung (newer) | SEF trailer | `SEFH`/`SEFT` footer block | Offset table in SEFH block (not implemented yet — rare) |

All formats: the embedded video is H.264 MP4.

---

### Task 1.1: Write unit tests for Motion Photo detection

**Files:**
- Create: `backend/tests/unit/test_motion_photo.py`

**Test cases:**

| Test | Input | Expected result |
|------|-------|----------------|
| Regular JPEG | Valid JPEG, no XMP | `detect_motion_photo()` returns `None` |
| Empty bytes | `b""` | Returns `None` |
| Random binary | Non-JPEG bytes | Returns `None` |
| Google Pixel older format | JPEG + XMP with `MicroVideoOffset` + appended video | Returns `{"format": "pixel", "video_offset": N}` |
| Google Pixel newer format | JPEG + XMP with `MotionPhoto="1"` + `Item:Length` | Returns `{"format": "pixel", "video_offset": N}` |
| Samsung older format | JPEG + `MotionPhoto_Data` marker + MP4 | Returns `{"format": "samsung", "video_offset": N}` |
| Offset beyond file size | XMP with `MicroVideoOffset` larger than file | Returns `None` |
| Offset zero | `MicroVideoOffset="0"` | Returns `None` |
| Item:Length zero | `Item:Length="0"` | Returns `None` |
| Unrelated XMP | JPEG with XMP but no GCamera namespace | Returns `None` |

```python
# backend/tests/unit/test_motion_photo.py
import struct
import pytest
from app.services.motion_photo import detect_motion_photo, extract_motion_video

# --- Test data builders ---

JPEG_SOI = b"\xff\xd8"
JPEG_EOI = b"\xff\xd9"
FAKE_VIDEO = b"\x00\x00\x00\x1c\x66\x74\x79\x70\x69\x73\x6f\x6d"  # minimal ftyp box
XMP_NS = b"http://ns.adobe.com/xap/1.0/\x00"


def _make_jpeg_with_xmp(xmp_payload: bytes, appended: bytes = b"") -> bytes:
    """Build a minimal JPEG with an APP1 XMP segment and optional appended data."""
    app1_data = XMP_NS + xmp_payload
    app1_length = len(app1_data) + 2  # +2 for the length field itself
    return (
        JPEG_SOI
        + b"\xff\xe1"
        + struct.pack(">H", app1_length)
        + app1_data
        + b"\x00" * 50  # image data padding
        + JPEG_EOI
        + appended
    )


def _make_plain_jpeg() -> bytes:
    return JPEG_SOI + b"\x00" * 100 + JPEG_EOI


def _make_pixel_older(video: bytes = FAKE_VIDEO) -> bytes:
    xmp = f'<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MicroVideo="1" GCamera:MicroVideoOffset="{len(video)}"/></rdf:RDF></x:xmpmeta>'.encode()
    return _make_jpeg_with_xmp(xmp, video)


def _make_pixel_newer(video: bytes = FAKE_VIDEO) -> bytes:
    xmp = (
        '<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1">'
        f'<Container:Directory><rdf:Seq>'
        f'<rdf:li Item:Semantic="Primary" Item:Mime="image/jpeg"/>'
        f'<rdf:li Item:Semantic="MotionPhoto" Item:Mime="video/mp4" Item:Length="{len(video)}"/>'
        f'</rdf:Seq></Container:Directory>'
        f'</rdf:Description></rdf:RDF></x:xmpmeta>'
    ).encode()
    return _make_jpeg_with_xmp(xmp, video)


def _make_samsung_older(video: bytes = FAKE_VIDEO) -> bytes:
    return JPEG_SOI + b"\x00" * 100 + JPEG_EOI + b"MotionPhoto_Data" + video


# --- Detection tests ---


class TestDetectMotionPhoto:
    def test_plain_jpeg_returns_none(self):
        assert detect_motion_photo(_make_plain_jpeg()) is None

    def test_empty_bytes_returns_none(self):
        assert detect_motion_photo(b"") is None

    def test_random_binary_returns_none(self):
        assert detect_motion_photo(b"\x00\x01\x02\x03" * 100) is None

    def test_pixel_older_format(self):
        data = _make_pixel_older()
        result = detect_motion_photo(data)
        assert result is not None
        assert result["format"] == "pixel"
        assert result["video_offset"] == len(data) - len(FAKE_VIDEO)

    def test_pixel_newer_format(self):
        data = _make_pixel_newer()
        result = detect_motion_photo(data)
        assert result is not None
        assert result["format"] == "pixel"
        assert result["video_offset"] == len(data) - len(FAKE_VIDEO)

    def test_samsung_older_format(self):
        data = _make_samsung_older()
        result = detect_motion_photo(data)
        assert result is not None
        assert result["format"] == "samsung"

    def test_offset_beyond_file_returns_none(self):
        xmp = '<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MicroVideo="1" GCamera:MicroVideoOffset="999999"/></rdf:RDF></x:xmpmeta>'.encode()
        data = _make_jpeg_with_xmp(xmp)
        assert detect_motion_photo(data) is None

    def test_offset_zero_returns_none(self):
        xmp = '<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MicroVideo="1" GCamera:MicroVideoOffset="0"/></rdf:RDF></x:xmpmeta>'.encode()
        data = _make_jpeg_with_xmp(xmp)
        assert detect_motion_photo(data) is None

    def test_unrelated_xmp_returns_none(self):
        xmp = b'<x:xmpmeta><rdf:RDF><rdf:Description dc:title="My Photo"/></rdf:RDF></x:xmpmeta>'
        data = _make_jpeg_with_xmp(xmp)
        assert detect_motion_photo(data) is None

    def test_item_length_zero_returns_none(self):
        xmp = (
            '<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MotionPhoto="1">'
            '<Container:Directory><rdf:Seq>'
            '<rdf:li Item:Semantic="Primary" Item:Mime="image/jpeg"/>'
            '<rdf:li Item:Semantic="MotionPhoto" Item:Mime="video/mp4" Item:Length="0"/>'
            '</rdf:Seq></Container:Directory>'
            '</rdf:Description></rdf:RDF></x:xmpmeta>'
        ).encode()
        data = _make_jpeg_with_xmp(xmp)
        assert detect_motion_photo(data) is None
```

**Run:** `docker compose exec backend python -m pytest tests/unit/test_motion_photo.py::TestDetectMotionPhoto -v`
**Expected:** FAIL — `app.services.motion_photo` doesn't exist yet.

**Commit:** `test: add Motion Photo detection unit tests`

---

### Task 1.2: Implement Motion Photo detection

**Files:**
- Create: `backend/app/services/motion_photo.py`

```python
# backend/app/services/motion_photo.py
"""Detect and extract embedded video from Android Motion Photos.

Supports:
- Google Pixel (older): XMP GCamera:MicroVideoOffset
- Google Pixel (newer): XMP GCamera:MotionPhoto + Container:Directory Item:Length
- Samsung (older): MotionPhoto_Data ASCII marker
- Samsung (newer): SEF trailer — NOT YET IMPLEMENTED (rare, logged and skipped)
"""

import logging
import re

logger = logging.getLogger(__name__)

_SAMSUNG_MARKER = b"MotionPhoto_Data"

_MICRO_VIDEO_RE = re.compile(rb'GCamera:MicroVideo="1"')
_MICRO_VIDEO_OFFSET_RE = re.compile(rb'GCamera:MicroVideoOffset="(\d+)"')
_MOTION_PHOTO_RE = re.compile(rb'GCamera:MotionPhoto="1"')
_ITEM_LENGTH_RE = re.compile(rb'Item:Length="(\d+)"')

_MIN_VIDEO_SIZE = 8  # MP4 ftyp box is at least 8 bytes


def detect_motion_photo(data: bytes) -> dict | None:
    """Check if image data contains an embedded Motion Photo video.

    Returns {"format": "pixel"|"samsung", "video_offset": int} or None.
    """
    if len(data) < 20:
        return None

    # Samsung older format: MotionPhoto_Data ASCII marker
    samsung_idx = data.find(_SAMSUNG_MARKER)
    if samsung_idx != -1:
        video_offset = samsung_idx + len(_SAMSUNG_MARKER)
        video_size = len(data) - video_offset
        if video_size >= _MIN_VIDEO_SIZE:
            return {"format": "samsung", "video_offset": video_offset}

    # Google Pixel older format: MicroVideoOffset (offset from end of file)
    if _MICRO_VIDEO_RE.search(data):
        m = _MICRO_VIDEO_OFFSET_RE.search(data)
        if m:
            offset_from_end = int(m.group(1))
            if offset_from_end <= 0:
                return None
            video_offset = len(data) - offset_from_end
            if video_offset > 0 and offset_from_end >= _MIN_VIDEO_SIZE:
                return {"format": "pixel", "video_offset": video_offset}

    # Google Pixel newer format: MotionPhoto + Item:Length
    if _MOTION_PHOTO_RE.search(data):
        m = _ITEM_LENGTH_RE.search(data)
        if m:
            video_length = int(m.group(1))
            if video_length <= 0:
                return None
            video_offset = len(data) - video_length
            if video_offset > 0 and video_length >= _MIN_VIDEO_SIZE:
                return {"format": "pixel", "video_offset": video_offset}

    return None
```

**Run:** `docker compose exec backend python -m pytest tests/unit/test_motion_photo.py::TestDetectMotionPhoto -v`
**Expected:** All PASS.

**Commit:** `feat: implement Motion Photo detection service`

---

## Phase 2: Motion Photo Video Extraction

### Task 2.1: Write unit tests for video extraction

Add extraction tests to the existing test file.

**Files:**
- Modify: `backend/tests/unit/test_motion_photo.py` (add `TestExtractMotionVideo` class)

**Test cases:**

| Test | Input | Expected result |
|------|-------|----------------|
| Extract from Pixel older | Pixel Motion Photo | Returns `FAKE_VIDEO` bytes |
| Extract from Pixel newer | Pixel newer Motion Photo | Returns `FAKE_VIDEO` bytes |
| Extract from Samsung | Samsung Motion Photo | Returns `FAKE_VIDEO` bytes |
| Plain JPEG | No Motion Photo | Returns `None` |
| Empty bytes | `b""` | Returns `None` |
| Tiny video (<8 bytes) | Motion Photo with 3-byte video | Returns `None` |
| Samsung marker at very end | Marker present but nothing after it | Returns `None` |

```python
# Add to backend/tests/unit/test_motion_photo.py

class TestExtractMotionVideo:
    def test_extract_from_pixel_older(self):
        data = _make_pixel_older()
        video = extract_motion_video(data)
        assert video == FAKE_VIDEO

    def test_extract_from_pixel_newer(self):
        data = _make_pixel_newer()
        video = extract_motion_video(data)
        assert video == FAKE_VIDEO

    def test_extract_from_samsung(self):
        data = _make_samsung_older()
        video = extract_motion_video(data)
        assert video == FAKE_VIDEO

    def test_extract_plain_jpeg_returns_none(self):
        assert extract_motion_video(_make_plain_jpeg()) is None

    def test_extract_empty_returns_none(self):
        assert extract_motion_video(b"") is None

    def test_extract_tiny_video_returns_none(self):
        """Video portion < 8 bytes is too small to be valid."""
        data = _make_pixel_older(video=b"\x00\x01\x02")
        assert extract_motion_video(data) is None

    def test_samsung_marker_at_very_end_returns_none(self):
        """MotionPhoto_Data marker exists but nothing after it."""
        data = JPEG_SOI + b"\x00" * 50 + b"MotionPhoto_Data"
        assert extract_motion_video(data) is None
```

**Run:** `docker compose exec backend python -m pytest tests/unit/test_motion_photo.py::TestExtractMotionVideo -v`
**Expected:** FAIL — `extract_motion_video` not implemented yet.

**Commit:** `test: add Motion Photo video extraction unit tests`

---

### Task 2.2: Implement video extraction

**Files:**
- Modify: `backend/app/services/motion_photo.py` (add `extract_motion_video`)

```python
# Add to backend/app/services/motion_photo.py

def extract_motion_video(data: bytes) -> bytes | None:
    """Extract the embedded video from a Motion Photo.

    Returns video bytes (MP4), or None if not a Motion Photo or video too small.
    """
    info = detect_motion_photo(data)
    if info is None:
        return None

    video_bytes = data[info["video_offset"]:]

    if len(video_bytes) < _MIN_VIDEO_SIZE:
        logger.warning(
            "Motion Photo (%s) video too small (%d bytes), skipping",
            info["format"],
            len(video_bytes),
        )
        return None

    logger.info(
        "Extracted %d-byte video from %s Motion Photo",
        len(video_bytes),
        info["format"],
    )
    return video_bytes
```

**Run:** `docker compose exec backend python -m pytest tests/unit/test_motion_photo.py -v`
**Expected:** All PASS (both detection and extraction).

**Commit:** `feat: implement Motion Photo video extraction`

---

## Phase 3: Upload Pipeline Integration

Wire the Motion Photo extraction into the existing upload endpoint. When an image is uploaded, check for embedded video. If found, extract it and process through the normal video pipeline.

### Task 3.1: Write integration tests for Motion Photo upload

These tests upload real files through the API and verify the correct records are created.

**Challenge:** The embedded video must be valid enough for ffprobe. Use ffmpeg to generate a real tiny MP4 in a test fixture.

**Files:**
- Create: `backend/tests/integration/test_motion_photo_upload.py`

**Test cases:**

| Test | Input | Expected |
|------|-------|----------|
| Samsung Motion Photo | Valid JPEG + marker + real MP4 | 200, returns 2 items: 1 photo + 1 video |
| Pixel Motion Photo | Valid JPEG + XMP offset + real MP4 | 200, returns 2 items: 1 photo + 1 video |
| Corrupt embedded video | Valid JPEG + Samsung marker + garbage bytes | 200, returns 1 item (photo only), video extraction fails gracefully |
| Regular JPEG (regression) | Valid JPEG, no Motion Photo | 200, returns 1 item (photo only) |
| Duplicate Motion Photo | Same file uploaded twice | Second upload returns same records (content_hash dedup) |
| Video named with _live suffix | Any Motion Photo | Extracted video `original_name` contains `_live` |

```python
# backend/tests/integration/test_motion_photo_upload.py
import subprocess
from io import BytesIO

import pytest
from PIL import Image


@pytest.fixture
def real_tiny_mp4(tmp_path) -> bytes:
    """Generate a real 1-frame MP4 video using ffmpeg."""
    output = tmp_path / "tiny.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=red:s=64x64:d=0.1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-frames:v", "1",
            str(output),
        ],
        capture_output=True,
        check=True,
    )
    return output.read_bytes()


@pytest.fixture
def real_jpeg_bytes() -> bytes:
    img = Image.new("RGB", (100, 100), "blue")
    buf = BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def samsung_motion_photo(real_jpeg_bytes, real_tiny_mp4) -> bytes:
    return real_jpeg_bytes + b"MotionPhoto_Data" + real_tiny_mp4


@pytest.fixture
def pixel_motion_photo(real_jpeg_bytes, real_tiny_mp4) -> bytes:
    import struct
    xmp_ns = b"http://ns.adobe.com/xap/1.0/\x00"
    xmp = f'<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MicroVideo="1" GCamera:MicroVideoOffset="{len(real_tiny_mp4)}"/></rdf:RDF></x:xmpmeta>'.encode()
    app1_data = xmp_ns + xmp
    app1_length = len(app1_data) + 2
    jpeg_with_xmp = (
        b"\xff\xd8"
        + b"\xff\xe1"
        + struct.pack(">H", app1_length)
        + app1_data
        + real_jpeg_bytes[2:]
    )
    return jpeg_with_xmp + real_tiny_mp4


class TestMotionPhotoUpload:
    def test_samsung_creates_photo_and_video(self, client, samsung_motion_photo):
        resp = client.post(
            "/api/media",
            files=[("files", ("IMG_20260309.jpg", samsung_motion_photo, "image/jpeg"))],
        )
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 2
        types = {item["media_type"] for item in items}
        assert types == {"photo", "video"}
        video = next(i for i in items if i["media_type"] == "video")
        assert "_live" in video["original_name"]

    def test_pixel_creates_photo_and_video(self, client, pixel_motion_photo):
        resp = client.post(
            "/api/media",
            files=[("files", ("PXL_20260309.jpg", pixel_motion_photo, "image/jpeg"))],
        )
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 2
        types = {item["media_type"] for item in items}
        assert types == {"photo", "video"}

    def test_corrupt_video_still_saves_photo(self, client, real_jpeg_bytes):
        motion = real_jpeg_bytes + b"MotionPhoto_Data" + b"\x00" * 100
        resp = client.post(
            "/api/media",
            files=[("files", ("corrupt_motion.jpg", motion, "image/jpeg"))],
        )
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["media_type"] == "photo"

    def test_regular_jpeg_not_affected(self, client, real_jpeg_bytes):
        resp = client.post(
            "/api/media",
            files=[("files", ("regular.jpg", real_jpeg_bytes, "image/jpeg"))],
        )
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["media_type"] == "photo"

    def test_duplicate_motion_photo(self, client, samsung_motion_photo):
        resp1 = client.post(
            "/api/media",
            files=[("files", ("dup.jpg", samsung_motion_photo, "image/jpeg"))],
        )
        resp2 = client.post(
            "/api/media",
            files=[("files", ("dup.jpg", samsung_motion_photo, "image/jpeg"))],
        )
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        ids1 = {item["id"] for item in resp1.json()}
        ids2 = {item["id"] for item in resp2.json()}
        assert ids1 == ids2
```

**Run:** `docker compose exec backend python -m pytest tests/integration/test_motion_photo_upload.py -v`
**Expected:** FAIL — upload handler doesn't extract Motion Photos yet.

**Commit:** `test: add integration tests for Motion Photo upload`

---

### Task 3.2: Wire extraction into the upload handler

**Files:**
- Modify: `backend/app/routers/media.py`

**What to change:**

1. Add import at top: `from app.services.motion_photo import extract_motion_video`

2. After the image `Media` record is committed and appended to `results` (around line 196), add the Motion Photo extraction block:

```python
# --- Motion Photo: check for embedded video ---
video_bytes = extract_motion_video(content)
if video_bytes:
    try:
        video_name = f"{Path(original_name).stem}_live.mp4"
        video_hash = hashlib.sha256(video_bytes).hexdigest()
        existing_video = db.query(Media).filter(
            Media.content_hash == video_hash
        ).first()
        if existing_video:
            results.append(existing_video)
        else:
            info_v = save_video_original(video_bytes, video_name)
            require_transcode_v = needs_transcode(info_v["codec"])
            needs_scale_v = (
                not require_transcode_v
                and (
                    info_v["width"] > config.DISPLAY_MAX_WIDTH
                    or info_v["height"] > config.DISPLAY_MAX_HEIGHT
                )
            )
            video_media = Media(
                filename=info_v["filename"],
                original_name=video_name,
                media_type="video",
                width=info_v["width"],
                height=info_v["height"],
                file_size=info_v["file_size"],
                duration=info_v["duration"],
                codec=info_v["codec"],
                thumb_filename=info_v["thumb_filename"],
                processing_status=(
                    "processing"
                    if (require_transcode_v or needs_scale_v)
                    else "ready"
                ),
                content_hash=video_hash,
            )
            db.add(video_media)
            db.commit()
            db.refresh(video_media)
            results.append(video_media)

            asyncio.create_task(
                manager.broadcast({
                    "type": "media_added",
                    "payload": MediaOut.model_validate(video_media).model_dump(mode="json"),
                })
            )

            if require_transcode_v:
                original_path_v = config.ORIGINALS_DIR / info_v["filename"]
                threading.Thread(
                    target=_transcode_in_background,
                    args=(video_media.id, original_path_v, info_v["duration"], loop),
                    daemon=True,
                ).start()
            elif needs_scale_v:
                original_path_v = config.ORIGINALS_DIR / info_v["filename"]
                threading.Thread(
                    target=_scale_display_in_background,
                    args=(video_media.id, original_path_v, info_v["duration"], loop),
                    daemon=True,
                ).start()
    except Exception:
        logger.warning(
            "Failed to extract Motion Photo video from '%s', image saved successfully",
            original_name,
            exc_info=True,
        )
```

**Key design decisions:**
- **Non-fatal:** Video extraction failure is caught and logged. Image upload always succeeds.
- **Duplicate detection:** Extracted video gets its own `content_hash` (SHA-256 of video bytes only). Same Motion Photo uploaded twice → both image and video deduplicated.
- **Naming:** Extracted video named `{stem}_live.mp4` for easy identification.
- **Transcoding:** Extracted video goes through the same transcode/scale pipeline as regular video uploads.

**Run:** `docker compose exec backend python -m pytest tests/integration/test_motion_photo_upload.py -v`
**Expected:** All PASS.

**Commit:** `feat: extract Motion Photo video during image upload`

---

### Task 3.3: Full backend regression test

Run the entire backend test suite to verify nothing is broken.

**Run:** `./scripts/test-backend.sh`
**Expected:** All existing tests still pass plus the new ones.

**Commit (if fixes needed):** `fix: resolve test regressions from Motion Photo integration`

---

## Phase 4: iOS Shortcut

Create an iOS Shortcut that extracts the video from Live Photos and uploads it to the photo frame backend. This phase is manual configuration on the iPhone, not code.

### Task 4.1: Design the Shortcut flow

The Shortcut does this:

1. **Select Photos** — opens photo picker, allows multiple selection
2. **Repeat with Each** selected item:
   a. **If** item is a Live Photo:
      - **Get component of Live Photo** → Video
      - **Set Name** to `{original_name}_live.mov`
   b. **Else** (regular photo or video):
      - Use the file as-is
   c. **Upload** via `POST http://home-pc/api/media` with the file as form data
3. **Show notification** — "X files uploaded to Photo Frame"

**Share sheet version:** Same Shortcut but triggered from the share sheet instead of manually. Set "Show in Share Sheet" → receives Images and Videos.

### Task 4.2: Create the Shortcut on iPhone

Manual steps on the iPhone:

1. Open **Shortcuts** app
2. Tap **+** → New Shortcut
3. Name: "Upload to Photo Frame"
4. Add actions:
   - **Select Photos** (allow multiple)
   - **Repeat with Each**
     - **If** → File Type is Live Photo
       - **Encode Media** (get video only)
     - **Otherwise**
       - Pass through
     - **End If**
     - **Get Contents of URL**:
       - URL: `http://home-pc/api/media`
       - Method: POST
       - Request Body: Form
       - Add field: File → `files` → Repeat Item (or encoded video)
   - **End Repeat**
   - **Show Notification**: "Upload complete"
5. Tap share icon → "Add to Home Screen" for quick access
6. In Shortcut settings → "Show in Share Sheet" → accept Images, Videos

### Task 4.3: Test the Shortcut

| Test | Action | Expected |
|------|--------|----------|
| Live Photo upload | Select a Live Photo in Shortcut | Video extracted and uploaded, appears in gallery as video |
| Regular photo | Select a regular photo | Photo uploaded normally |
| Regular video | Select a video | Video uploaded normally |
| Multiple files | Select mix of Live Photos, photos, videos | All uploaded, Live Photos become videos |
| Not on home network | Run Shortcut away from home | Request fails, Shortcut shows error |
| Share sheet | Share a Live Photo from Photos app to "Upload to Photo Frame" | Video extracted and uploaded |

---

## Phase 5: Deploy & Verify

### Task 5.1: Deploy backend changes

Deploy the updated backend (with Motion Photo extraction) to the production server.

**Run:** `./scripts/deploy.sh`

**Verify:** Upload a Motion Photo JPEG from Android browser → check gallery shows both photo and video.

### Task 5.2: Test iOS Shortcut against production

Run the Shortcut on iPhone while on home network:
1. Select a Live Photo → verify video appears in gallery
2. Select a regular photo → verify photo appears
3. Try from share sheet → verify it works

---

## Implementation Order

```
Phase 1: Detection service (Docker)
  1.1 (tests) → 1.2 (implementation)

Phase 2: Extraction service (Docker)
  2.1 (tests) → 2.2 (implementation)

Phase 3: Upload integration (Docker)
  3.1 (tests) → 3.2 (implementation) → 3.3 (regression check)

Phase 4: iOS Shortcut (manual, on iPhone)
  4.1 (design) → 4.2 (create) → 4.3 (test)

Phase 5: Deploy & verify
  5.1 (deploy) → 5.2 (test)
```

Phases 1-3 are code changes, testable in Docker.
Phase 4 is manual iPhone configuration.
Phase 5 is deployment.

---

## Edge Cases & Risks

| Scenario | What happens | Mitigation |
|----------|-------------|-----------|
| Motion Photo with corrupt embedded video | `save_video_original()` raises `ValueError` (ffprobe fails) | Caught by try/except, logged, image still saved |
| Motion Photo where XMP offset is slightly wrong | Video bytes start mid-frame | ffprobe may still parse it; if not, same as corrupt case |
| Samsung newer SEF trailer format | `detect_motion_photo()` returns `None` | Video not extracted. Logged. Can add support later when we have a test file |
| Very large Motion Photo (close to 200MB limit) | Image + embedded video both within limit | The 200MB limit applies to the uploaded file. A 3s video adds ~5-15MB. Not a concern. |
| Same Motion Photo uploaded from Android browser AND as regular JPEG from desktop | Two photo records with different `content_hash` (Motion Photo JPEG includes video bytes) | Acceptable — the files are genuinely different. User can delete the duplicate manually. |
| iOS Shortcut can't connect to home-pc | HTTP request fails | Shortcut shows native iOS error. User retries when on home network. |
| iOS Shortcut: Live Photo has no video component | "Get component" step returns nothing | Shortcut skips to next item or shows error. Non-fatal. |
| HEIC Motion Photo (not JPEG) | Detection still works — XMP markers are format-agnostic | Already handled: backend allows `.heic` uploads, Pillow decodes them, XMP regex search works on raw bytes regardless of container format |
