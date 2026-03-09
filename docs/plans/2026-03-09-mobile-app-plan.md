# Mobile App (Capacitor) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wrap the existing React frontend in Capacitor for iOS/Android, adding Live Photo video extraction (iOS native) and Motion Photo extraction (server-side for Android/web). Share sheet integration as a follow-up.

**Architecture:** Capacitor wraps the Vite build output (`dist/`) in a native WebView. All existing React UI code runs unchanged. HTTP requests are routed through Capacitor's native HTTP layer (`CapacitorHttp`) which bypasses CORS entirely — no backend CORS changes needed. WebSocket connections go through the WebView natively (no CORS restrictions). A custom iOS Swift plugin extracts the MOV component from iOS Live Photos via PHAssetResource APIs. For Android Motion Photos (Google Pixel + Samsung), the backend detects embedded video in uploaded JPEGs and extracts it server-side during the normal upload pipeline.

**Tech Stack:** Capacitor 6, Swift (iOS plugin), Python (server-side Motion Photo extraction), existing React 19 / TypeScript / Vite 6 / Tailwind stack.

**What runs where:**
- Phases 1-2: Backend changes → **Docker** (existing `docker compose exec backend` workflow)
- Phase 3: Frontend changes → **Docker** (existing `docker compose exec frontend` workflow)
- Phases 4+: Capacitor/native → **Mac host** (requires Xcode, Android Studio, `npm` on host)

---

## Phase 1: Server-Side Motion Photo Extraction

Android Motion Photos embed a video inside a JPEG/HEIC file. The backend should detect these on upload and extract the video as a separate media item. This works from the web UI too — not mobile-specific.

### How Motion Photos work

The file is a valid JPEG with video bytes appended after the image data. Four known formats:

| Manufacturer | Format | Detection | Video location |
|-------------|--------|-----------|---------------|
| Google Pixel (pre-Android 11) | XMP `GCamera:MicroVideo="1"` | `MicroVideoOffset` in XMP | `file_size - MicroVideoOffset` to EOF |
| Google Pixel (Android 11+) | XMP `GCamera:MotionPhoto="1"` | `Container:Directory` with `Item:Length` | `file_size - Item:Length` to EOF |
| Samsung (older) | ASCII marker | `MotionPhoto_Data` byte sequence | After the 16-byte marker to EOF |
| Samsung (newer) | SEF trailer | `SEFH`/`SEFT` footer block | Offset table in SEFH block |

All formats: the embedded video is H.264 MP4.

---

### Task 1.1: Create Motion Photo detection service — unit tests

Write tests first for detecting whether a JPEG contains a Motion Photo.

**Files:**
- Create: `backend/tests/unit/test_motion_photo.py`

**Test cases to cover:**

| Test | Input | Expected |
|------|-------|----------|
| Regular JPEG (no Motion Photo) | Valid JPEG, no XMP | `detect_motion_photo()` returns `None` |
| Google Pixel older format | JPEG + XMP with `MicroVideoOffset` + appended video | Returns `{"format": "pixel", "video_offset": N}` |
| Google Pixel newer format | JPEG + XMP with `MotionPhoto="1"` + `Item:Length` | Returns `{"format": "pixel", "video_offset": N}` |
| Samsung older format | JPEG + `MotionPhoto_Data` marker + MP4 | Returns `{"format": "samsung", "video_offset": N}` |
| Empty bytes | `b""` | Returns `None` |
| Non-JPEG binary data | Random bytes | Returns `None` |
| XMP says Motion Photo but offset is invalid (beyond file size) | JPEG + XMP with `MicroVideoOffset` larger than file | Returns `None` |
| XMP says Motion Photo but offset is zero | `MicroVideoOffset="0"` | Returns `None` |
| JPEG with unrelated XMP (no GCamera namespace) | JPEG + generic XMP | Returns `None` |

**Code:**

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
        """MicroVideoOffset larger than file size → invalid, return None."""
        xmp = '<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MicroVideo="1" GCamera:MicroVideoOffset="999999"/></rdf:RDF></x:xmpmeta>'.encode()
        data = _make_jpeg_with_xmp(xmp)
        assert detect_motion_photo(data) is None

    def test_offset_zero_returns_none(self):
        """MicroVideoOffset=0 means no video → return None."""
        xmp = '<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MicroVideo="1" GCamera:MicroVideoOffset="0"/></rdf:RDF></x:xmpmeta>'.encode()
        data = _make_jpeg_with_xmp(xmp)
        assert detect_motion_photo(data) is None

    def test_unrelated_xmp_returns_none(self):
        """XMP present but no GCamera namespace → not a Motion Photo."""
        xmp = b'<x:xmpmeta><rdf:RDF><rdf:Description dc:title="My Photo"/></rdf:RDF></x:xmpmeta>'
        data = _make_jpeg_with_xmp(xmp)
        assert detect_motion_photo(data) is None

    def test_item_length_zero_returns_none(self):
        """Item:Length="0" → no video, return None."""
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


# --- Extraction tests ---


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
        """Video portion < 8 bytes is too small to be valid → return None."""
        data = _make_pixel_older(video=b"\x00\x01\x02")
        video = extract_motion_video(data)
        assert video is None

    def test_samsung_marker_at_very_end_returns_none(self):
        """MotionPhoto_Data marker exists but nothing after it."""
        data = JPEG_SOI + b"\x00" * 50 + b"MotionPhoto_Data"
        assert extract_motion_video(data) is None
```

**Run:** `docker compose exec backend python -m pytest tests/unit/test_motion_photo.py -v`
**Expected:** FAIL — `app.services.motion_photo` doesn't exist yet.

---

### Task 1.2: Implement Motion Photo detection and extraction service

**Files:**
- Create: `backend/app/services/motion_photo.py`

```python
# backend/app/services/motion_photo.py
"""Detect and extract embedded video from Android Motion Photos.

Supports:
- Google Pixel (older): XMP GCamera:MicroVideoOffset
- Google Pixel (newer): XMP GCamera:MotionPhoto + Container:Directory Item:Length
- Samsung (older): MotionPhoto_Data ASCII marker
- Samsung (newer): SEF trailer — NOT YET IMPLEMENTED (rare, log and skip)

The video is always appended after the JPEG/HEIC image data.
Extraction is non-destructive: the original image bytes are unchanged.
"""

import logging
import re

logger = logging.getLogger(__name__)

# --- Samsung ---
_SAMSUNG_MARKER = b"MotionPhoto_Data"

# --- Google Pixel XMP patterns ---
_MICRO_VIDEO_RE = re.compile(rb'GCamera:MicroVideo="1"')
_MICRO_VIDEO_OFFSET_RE = re.compile(rb'GCamera:MicroVideoOffset="(\d+)"')
_MOTION_PHOTO_RE = re.compile(rb'GCamera:MotionPhoto="1"')
_ITEM_LENGTH_RE = re.compile(rb'Item:Length="(\d+)"')

# Minimum viable video size (an MP4 ftyp box is at least 8 bytes)
_MIN_VIDEO_SIZE = 8


def detect_motion_photo(data: bytes) -> dict | None:
    """Check if image data contains an embedded Motion Photo video.

    Args:
        data: Raw file bytes (JPEG or HEIC).

    Returns:
        {"format": "pixel"|"samsung", "video_offset": int} if Motion Photo detected.
        None otherwise.
    """
    if len(data) < 20:
        return None

    # Samsung older format: look for MotionPhoto_Data ASCII marker
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
            video_size = offset_from_end
            if video_offset > 0 and video_size >= _MIN_VIDEO_SIZE:
                return {"format": "pixel", "video_offset": video_offset}

    # Google Pixel newer format: MotionPhoto + Container:Directory Item:Length
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


def extract_motion_video(data: bytes) -> bytes | None:
    """Extract the embedded video from a Motion Photo.

    Args:
        data: Raw file bytes (JPEG or HEIC).

    Returns:
        Video bytes (MP4), or None if not a Motion Photo or video too small.
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
**Expected:** All PASS.

**Commit:** `feat: add Motion Photo detection and video extraction service`

---

### Task 1.3: Integrate Motion Photo extraction into upload pipeline

When an image is uploaded, check if it contains an embedded Motion Photo video. If so, extract the video bytes and process them through the existing video pipeline (save, thumbnail, transcode if needed). The image itself is still saved normally.

**Key design decisions:**
- **Non-fatal:** If video extraction or video processing fails, log a warning and continue. The image upload still succeeds.
- **Duplicate detection:** The extracted video gets its own `content_hash` (SHA-256 of the video bytes, not the whole JPEG). If the same Motion Photo is uploaded twice, both the image hash and video hash will be caught.
- **Original name:** The extracted video is named `{original_stem}_live.mp4` so users can identify it in the gallery.
- **Both image and video are returned** in the upload response, so the frontend shows both.

**Files:**
- Modify: `backend/app/routers/media.py`

**Changes to `upload_media()` (after the image processing block, around line 196):**

After the image `Media` record is committed and appended to `results`, add:

```python
# Check for embedded Motion Photo video (Android/Google/Samsung)
from app.services.motion_photo import extract_motion_video

video_bytes = extract_motion_video(content)
if video_bytes:
    try:
        video_name = f"{Path(original_name).stem}_live.mp4"
        video_hash = hashlib.sha256(video_bytes).hexdigest()
        # Skip if this exact video was already extracted/uploaded
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
            "Failed to extract Motion Photo video from '%s', image was saved successfully",
            original_name,
            exc_info=True,
        )
        # Non-fatal: image upload already succeeded
```

**Import to add at top of file:**
```python
from app.services.motion_photo import extract_motion_video
```

**Commit:** `feat: extract Motion Photo video during image upload`

---

### Task 1.4: Integration tests for Motion Photo upload

Test the full upload flow: upload a Motion Photo JPEG → verify both photo and video records are created.

**Challenge:** The embedded video needs to be valid enough for ffprobe. We can't use a fake ftyp box. We need a real (tiny) MP4 video embedded in a JPEG.

**Approach:** Generate a minimal MP4 using ffmpeg in the test fixture, then embed it in a JPEG with the Samsung marker (simplest format).

**Files:**
- Create: `backend/tests/integration/test_motion_photo_upload.py`

**Test cases:**

| Test | Input | Expected |
|------|-------|----------|
| Samsung Motion Photo upload | Valid JPEG + `MotionPhoto_Data` + real MP4 | 200, returns 2 items: photo + video |
| Pixel Motion Photo upload | Valid JPEG + XMP MicroVideoOffset + real MP4 | 200, returns 2 items: photo + video |
| Motion Photo with corrupt video | Valid JPEG + Samsung marker + garbage bytes | 200, returns 1 item (photo only), video extraction fails gracefully |
| Regular JPEG upload (regression) | Valid JPEG, no Motion Photo | 200, returns 1 item (photo only) |
| Duplicate Motion Photo upload | Same Motion Photo uploaded twice | Second upload returns existing records (content_hash match) |
| Motion Photo video needs transcoding | JPEG + embedded HEVC video | 200, video record has `processing_status="processing"` |

```python
# backend/tests/integration/test_motion_photo_upload.py
"""Integration tests for Motion Photo upload flow."""
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

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
    """Generate a real JPEG image."""
    img = Image.new("RGB", (100, 100), "blue")
    buf = BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def samsung_motion_photo(real_jpeg_bytes, real_tiny_mp4) -> bytes:
    """Valid Samsung Motion Photo: JPEG + marker + MP4."""
    return real_jpeg_bytes + b"MotionPhoto_Data" + real_tiny_mp4


@pytest.fixture
def pixel_motion_photo(real_jpeg_bytes, real_tiny_mp4) -> bytes:
    """Valid Pixel Motion Photo: JPEG with XMP + appended MP4."""
    import struct
    xmp_ns = b"http://ns.adobe.com/xap/1.0/\x00"
    xmp = f'<x:xmpmeta><rdf:RDF><rdf:Description GCamera:MicroVideo="1" GCamera:MicroVideoOffset="{len(real_tiny_mp4)}"/></rdf:RDF></x:xmpmeta>'.encode()
    app1_data = xmp_ns + xmp
    app1_length = len(app1_data) + 2
    # Rebuild JPEG with XMP APP1 segment injected after SOI
    jpeg_with_xmp = (
        b"\xff\xd8"
        + b"\xff\xe1"
        + struct.pack(">H", app1_length)
        + app1_data
        + real_jpeg_bytes[2:]  # rest of JPEG after SOI
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
        # Video should be named with _live suffix
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
        """Embedded video is garbage bytes → photo saved, video skipped."""
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
        """Regular JPEG without Motion Photo markers → single photo only."""
        resp = client.post(
            "/api/media",
            files=[("files", ("regular.jpg", real_jpeg_bytes, "image/jpeg"))],
        )
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["media_type"] == "photo"

    def test_duplicate_motion_photo(self, client, samsung_motion_photo):
        """Uploading same Motion Photo twice → returns existing records."""
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
        # Second upload should return same records (content_hash dedup)
        ids1 = {item["id"] for item in resp1.json()}
        ids2 = {item["id"] for item in resp2.json()}
        # The photo is deduped by content_hash of the full JPEG.
        # The video was already extracted on first upload.
        # Second upload: JPEG hash matches → returns existing photo, no re-extraction.
        assert ids1 == ids2
```

**Run:** `docker compose exec backend python -m pytest tests/integration/test_motion_photo_upload.py -v`
**Expected:** All PASS.

**Run full backend suite for regression check:** `./scripts/test-backend.sh`
**Expected:** All existing tests still pass.

**Commit:** `test: add integration tests for Motion Photo upload`

---

### Task 1.5: Backend test suite — verify no regressions

Run the full test suite to make sure nothing is broken.

**Run:** `./scripts/test-backend.sh`
**Expected:** All pass. If any fail, fix before proceeding.

**Commit (if fixes needed):** `fix: resolve test regressions from Motion Photo integration`

---

## Phase 2: Frontend — Base URL Configuration

Make the API base URL, asset URLs, and WebSocket URL configurable via `VITE_SERVER_BASE` environment variable. When unset (web builds), behavior is identical to current. When set to `http://home-pc` (mobile builds), all URLs become absolute.

### Task 2.1: Make API and asset base URLs configurable

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/vite-env.d.ts`

**Changes to `client.ts`:**

```typescript
// Top of file — replace `const API_BASE = "/api";`
const SERVER_BASE = import.meta.env.VITE_SERVER_BASE || "";
const API_BASE = `${SERVER_BASE}/api`;
```

Update asset URL helpers:

```typescript
export function thumbnailUrl(media: Media): string {
  return `${SERVER_BASE}/uploads/thumbnails/${media.thumb_filename}`;
}

export function originalUrl(media: Media): string {
  if (media.media_type === "video" && media.transcoded_filename) {
    return `${SERVER_BASE}/uploads/transcoded/${media.transcoded_filename}`;
  }
  return `${SERVER_BASE}/uploads/originals/${media.filename}`;
}

export function displayUrl(media: Media): string {
  if (media.display_filename) {
    if (media.media_type === "video" && media.transcoded_filename === media.display_filename) {
      return `${SERVER_BASE}/uploads/transcoded/${media.display_filename}`;
    }
    return `${SERVER_BASE}/uploads/display/${media.display_filename}`;
  }
  return originalUrl(media);
}
```

Export `SERVER_BASE` for use by other modules:

```typescript
export { SERVER_BASE };
```

**Changes to `vite-env.d.ts`:**

```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

**Commit:** `feat: make API and asset URLs configurable via VITE_SERVER_BASE`

---

### Task 2.2: Make WebSocket URL configurable

**Files:**
- Modify: `frontend/src/hooks/useWebSocket.ts`

**Change the `connect` function** to use `SERVER_BASE` when set:

```typescript
import { SERVER_BASE } from "../api/client";

// Inside connect():
let wsUrl: string;
if (SERVER_BASE) {
  // Mobile build: convert http(s)://host to ws(s)://host
  wsUrl = SERVER_BASE.replace(/^http/, "ws") + "/ws";
} else {
  // Web build: relative URL from current host
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  wsUrl = `${protocol}//${window.location.host}/ws`;
}
const ws = new WebSocket(wsUrl);
```

**Commit:** `feat: make WebSocket URL configurable for mobile builds`

---

### Task 2.3: Verify web build is unaffected

The web build should behave identically since `VITE_SERVER_BASE` is unset (empty string = same relative URLs).

**Run:** `docker compose exec frontend npm run build`
**Expected:** Build succeeds.

**Run:** `docker compose exec frontend npm run test`
**Expected:** All frontend tests pass (existing tests don't set `VITE_SERVER_BASE`, so `SERVER_BASE = ""`).

**Commit (if fixes needed):** `fix: resolve frontend regressions from base URL change`

---

## Phase 3: Capacitor Initialization

**IMPORTANT:** This phase runs on the **Mac host**, not in Docker. Capacitor needs Xcode (iOS) and Android Studio (Android) which aren't available in Docker.

### Task 3.1: Install Capacitor dependencies

**Run on Mac host:**

```bash
cd frontend
npm install @capacitor/core @capacitor/app
npm install @capacitor/cli --save-dev
```

- `@capacitor/core` — runtime bridge between web and native
- `@capacitor/app` — app lifecycle events (appUrlOpen, backButton, etc.) — needed for share extension handling later
- `@capacitor/cli` — build tools (`cap sync`, `cap open`, etc.)

**Commit:** `feat: add Capacitor dependencies`

---

### Task 3.2: Initialize Capacitor and configure

**Run:**
```bash
cd frontend
npx cap init "Photo Frame" com.flexoptix.photoframe --web-dir dist
```

**Then edit the generated `capacitor.config.ts`:**

```typescript
import type { CapacitorConfig } from "@capacitor/core";

const config: CapacitorConfig = {
  appId: "com.flexoptix.photoframe",
  appName: "Photo Frame",
  webDir: "dist",
  plugins: {
    CapacitorHttp: {
      enabled: true, // Patches fetch/XHR to use native HTTP — bypasses CORS entirely
    },
  },
};

export default config;
```

**Why `CapacitorHttp`:** The Capacitor WebView runs on `capacitor://localhost` (iOS) or `http://localhost` (Android). Requests to `http://home-pc` would be cross-origin. Instead of configuring CORS, `CapacitorHttp` routes all `fetch()` and `XMLHttpRequest` calls through the native HTTP layer — completely transparent to existing code.

**Note:** `CapacitorHttp` does NOT patch `WebSocket`. That's fine — WebSocket connections from Capacitor WebView work without CORS restrictions.

**Commit:** `feat: configure Capacitor with CapacitorHttp for CORS bypass`

---

### Task 3.3: Add iOS platform

**Prerequisites:** Xcode installed, Apple developer account (free is fine for personal device testing).

```bash
cd frontend
VITE_SERVER_BASE=http://home-pc npm run build   # Build with mobile base URL
npx cap add ios
npx cap sync
```

This creates `frontend/ios/` with an Xcode project.

**Verify:** `npx cap open ios` — Xcode opens, project loads without errors.

**Commit:** `feat: add iOS platform`

---

### Task 3.4: Add Android platform

**Prerequisites:** Android Studio installed, Android SDK.

```bash
cd frontend
npx cap add android
npx cap sync
```

This creates `frontend/android/` with an Android Studio project.

**Verify:** `npx cap open android` — Android Studio opens, project syncs without errors.

**Commit:** `feat: add Android platform`

---

### Task 3.5: First build — verify web content loads in simulators

Build and run the app in both iOS Simulator and Android Emulator. At this point it should show the existing web UI (gallery, upload, settings) with the connectivity guard blocking if `home-pc` isn't reachable.

**iOS:**
1. Open Xcode: `npx cap open ios`
2. Select a simulator (e.g., iPhone 15)
3. Build and run (Cmd+R)
4. Expected: App launches, shows web UI or connectivity error (depending on network)

**Android:**
1. Open Android Studio: `npx cap open android`
2. Select an emulator
3. Build and run
4. Expected: Same as iOS

**Known issues to watch for:**
- If the app shows a blank white screen, check that `webDir: "dist"` is correct and `npm run build` was run
- If assets don't load, verify `VITE_SERVER_BASE` was set during build
- If WebSocket doesn't connect, verify the WS URL is correct in the console

**Commit:** `chore: verify Capacitor builds on iOS and Android simulators`

---

## Phase 4: Connectivity Guard

### Task 4.1: Create ConnectivityGuard component

When `VITE_SERVER_BASE` is set (mobile build), ping the server on launch. If unreachable, block the app with a friendly message. If `VITE_SERVER_BASE` is unset (web build), render children immediately.

**Files:**
- Create: `frontend/src/components/ConnectivityGuard.tsx`

**Edge cases handled:**
- Server unreachable (network error, DNS failure) → "Not Connected" screen
- Server reachable but returns non-200 (e.g., 500) → still considered "connected" (server is up, just having issues — let the user in)
- Timeout after 5 seconds → treat as unreachable
- Web build (no `VITE_SERVER_BASE`) → skip check entirely, render children

```tsx
// frontend/src/components/ConnectivityGuard.tsx
import { useCallback, useEffect, useState } from "react";
import { SERVER_BASE } from "../api/client";

type Status = "checking" | "connected" | "unreachable";

export default function ConnectivityGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>(
    SERVER_BASE ? "checking" : "connected",
  );

  const check = useCallback(async () => {
    if (!SERVER_BASE) return;
    setStatus("checking");
    try {
      await fetch(`${SERVER_BASE}/api/settings`, {
        signal: AbortSignal.timeout(5000),
      });
      // Any response (even 500) means server is reachable
      setStatus("connected");
    } catch {
      setStatus("unreachable");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/[0.08] border-t-copper mx-auto mb-4" />
          <p className="text-warm-gray text-sm">
            Connecting to Photo Frame...
          </p>
        </div>
      </div>
    );
  }

  if (status === "unreachable") {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <svg
            className="mx-auto h-16 w-16 text-warm-muted mb-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0"
            />
          </svg>
          <h1 className="font-display text-2xl text-warm-white mb-3">
            Not Connected
          </h1>
          <p className="text-warm-gray mb-8">
            Connect to your home network to use Photo Frame.
          </p>
          <button
            onClick={check}
            className="rounded-xl bg-copper px-6 py-3 text-sm font-semibold text-ink hover:bg-copper-light transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
```

---

### Task 4.2: Integrate ConnectivityGuard into App

**Files:**
- Modify: `frontend/src/App.tsx`

Wrap the entire `<Routes>` block:

```tsx
import ConnectivityGuard from "./components/ConnectivityGuard";

export default function App() {
  return (
    <ConnectivityGuard>
      <Routes>
        {/* ... existing routes unchanged ... */}
      </Routes>
    </ConnectivityGuard>
  );
}
```

**Verify web build unaffected:** `docker compose exec frontend npm run test`

**Commit:** `feat: add connectivity guard for mobile app`

---

### Task 4.3: Unit tests for ConnectivityGuard

**Files:**
- Create: `frontend/src/components/__tests__/ConnectivityGuard.test.tsx`

**Test cases:**

| Test | Setup | Expected |
|------|-------|----------|
| Web mode (no SERVER_BASE) | Mock `SERVER_BASE = ""` | Renders children immediately, no fetch |
| Mobile mode — server reachable | Mock fetch resolving | Shows loading spinner, then renders children |
| Mobile mode — server unreachable | Mock fetch rejecting | Shows "Not Connected" screen |
| Retry button works | Mock fetch reject → click retry → mock fetch resolve | Shows children after retry |
| Server returns 500 | Mock fetch returning 500 | Still shows children (server is reachable) |
| Fetch times out | Mock fetch that never resolves (AbortSignal.timeout) | Shows "Not Connected" after timeout |

**Commit:** `test: add ConnectivityGuard tests`

---

## Phase 5: iOS Live Photo Plugin

iOS Live Photos are stored as two separate resources in the photo library: a still image (HEIC/JPEG) and a ~3s video (MOV). Unlike Android Motion Photos, these are NOT embedded in a single file — they require native iOS APIs (PhotoKit `PHAssetResource`) to access both components.

### Task 5.1: Create the Swift plugin

**Files:**
- Create: `frontend/ios/App/App/LivePhotoPlugin.swift`
- Create: `frontend/ios/App/App/LivePhotoPlugin.m` (Objective-C bridge for Capacitor)

**What the plugin does:**
1. Presents iOS PHPicker (native photo picker)
2. User selects photos/videos (including Live Photos)
3. For each selection:
   - **Live Photo**: Extracts the MOV video resource via `PHAssetResource`, saves to temp dir, returns path
   - **Regular photo**: Loads the image file, saves to temp dir, returns path
   - **Video**: Loads the video file, saves to temp dir, returns path
4. Returns array of `{path, name, mimeType, isLivePhoto}` to JavaScript

**Edge cases handled:**
- User denies photo library permission → plugin returns error with descriptive message
- User cancels picker → returns empty array (not an error)
- iCloud-only photo (not downloaded) → `PHAssetResourceRequestOptions.isNetworkAccessAllowed = true` triggers download
- Live Photo with missing video resource (damaged) → falls back to still image only
- Large selection (20+ items) → works but may be slow due to sequential file copies

```swift
// frontend/ios/App/App/LivePhotoPlugin.swift
import Foundation
import Capacitor
import Photos
import PhotosUI

@objc(LivePhotoPlugin)
public class LivePhotoPlugin: CAPPlugin, PHPickerViewControllerDelegate, CAPBridgedPlugin {
    public let identifier = "LivePhotoPlugin"
    public let jsName = "LivePhotoPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickMedia", returnType: CAPPluginReturnPromise)
    ]

    private var currentCall: CAPPluginCall?

    @objc func pickMedia(_ call: CAPPluginCall) {
        // Check photo library permission
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .denied || status == .restricted {
            call.reject("Photo library access denied. Please enable in Settings.")
            return
        }

        currentCall = call
        let maxItems = call.getInt("maxItems") ?? 20

        DispatchQueue.main.async {
            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.selectionLimit = maxItems
            config.filter = .any(of: [.images, .videos, .livePhotos])
            config.preferredAssetRepresentationMode = .current

            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = currentCall else { return }

        if results.isEmpty {
            call.resolve(["files": []])
            return
        }

        let group = DispatchGroup()
        var files: [[String: Any]] = []
        let tempDir = FileManager.default.temporaryDirectory
        let lock = NSLock() // Thread-safe access to files array

        for result in results {
            let provider = result.itemProvider

            // Live Photo: extract video component
            if provider.canLoadObject(ofClass: PHLivePhoto.self),
               let assetId = result.assetIdentifier {
                group.enter()
                extractLivePhotoVideo(assetIdentifier: assetId, tempDir: tempDir) { videoPath in
                    if let path = videoPath {
                        lock.lock()
                        files.append([
                            "path": path,
                            "name": UUID().uuidString + ".mov",
                            "mimeType": "video/quicktime",
                            "isLivePhoto": true,
                        ])
                        lock.unlock()
                    }
                    group.leave()
                }
            }
            // Video
            else if provider.hasItemConformingToTypeIdentifier("public.movie") {
                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: "public.movie") { url, _ in
                    if let url = url {
                        let dest = tempDir.appendingPathComponent(UUID().uuidString + "." + url.pathExtension)
                        try? FileManager.default.copyItem(at: url, to: dest)
                        lock.lock()
                        files.append([
                            "path": dest.path,
                            "name": url.lastPathComponent,
                            "mimeType": "video/" + url.pathExtension,
                            "isLivePhoto": false,
                        ])
                        lock.unlock()
                    }
                    group.leave()
                }
            }
            // Regular image
            else if provider.hasItemConformingToTypeIdentifier("public.image") {
                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: "public.image") { url, _ in
                    if let url = url {
                        let dest = tempDir.appendingPathComponent(UUID().uuidString + "." + url.pathExtension)
                        try? FileManager.default.copyItem(at: url, to: dest)
                        lock.lock()
                        files.append([
                            "path": dest.path,
                            "name": url.lastPathComponent,
                            "mimeType": "image/" + url.pathExtension,
                            "isLivePhoto": false,
                        ])
                        lock.unlock()
                    }
                    group.leave()
                }
            }
        }

        group.notify(queue: .main) {
            call.resolve(["files": files])
        }
    }

    private func extractLivePhotoVideo(
        assetIdentifier: String,
        tempDir: URL,
        completion: @escaping (String?) -> Void
    ) {
        let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: [assetIdentifier], options: nil)
        guard let asset = fetchResult.firstObject else {
            completion(nil)
            return
        }

        let resources = PHAssetResource.assetResources(for: asset)
        guard let videoResource = resources.first(where: {
            $0.type == .pairedVideo || $0.uniformTypeIdentifier == "com.apple.quicktime-movie"
        }) else {
            // Live Photo without video resource (damaged) — skip
            completion(nil)
            return
        }

        let dest = tempDir.appendingPathComponent(UUID().uuidString + ".mov")
        let options = PHAssetResourceRequestOptions()
        options.isNetworkAccessAllowed = true // Download from iCloud if needed

        PHAssetResourceManager.default().writeData(for: videoResource, toFile: dest, options: options) { error in
            if let error = error {
                print("LivePhotoPlugin: Failed to extract video: \(error.localizedDescription)")
                completion(nil)
            } else {
                completion(dest.path)
            }
        }
    }
}
```

**Objective-C bridge:**
```objc
// frontend/ios/App/App/LivePhotoPlugin.m
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LivePhotoPlugin, "LivePhotoPlugin",
    CAP_PLUGIN_METHOD(pickMedia, CAPPluginReturnPromise);
)
```

**Info.plist addition:**
```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>Photo Frame needs access to your photos to upload them to the slideshow.</string>
```

**Commit:** `feat: add iOS Live Photo plugin with PHAssetResource video extraction`

---

### Task 5.2: Create TypeScript wrapper

**Files:**
- Create: `frontend/src/native/livePhotoPlugin.ts`
- Create: `frontend/src/native/platform.ts`

```typescript
// frontend/src/native/platform.ts
import { Capacitor } from "@capacitor/core";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function isIOS(): boolean {
  return Capacitor.getPlatform() === "ios";
}

export function isAndroid(): boolean {
  return Capacitor.getPlatform() === "android";
}
```

```typescript
// frontend/src/native/livePhotoPlugin.ts
import { registerPlugin } from "@capacitor/core";

export interface PickedFile {
  path: string;
  name: string;
  mimeType: string;
  isLivePhoto: boolean;
}

interface LivePhotoPluginInterface {
  pickMedia(options?: { maxItems?: number }): Promise<{ files: PickedFile[] }>;
}

const LivePhotoPlugin = registerPlugin<LivePhotoPluginInterface>("LivePhotoPlugin");

export default LivePhotoPlugin;
```

**Commit:** `feat: add TypeScript wrapper for iOS Live Photo plugin`

---

### Task 5.3: Test on physical iOS device

**Live Photos are not available in the iOS Simulator.** You must test on a real device.

1. Connect iPhone to Mac via USB
2. In Xcode, select the physical device as build target
3. Build and run (you may need to trust the developer profile on the device: Settings > General > Device Management)
4. Navigate to Upload page
5. Tap "Choose Files" — native picker should appear
6. Select a Live Photo — verify it extracts the MOV and uploads as video
7. Select a regular photo — verify it uploads normally
8. Select a video — verify it uploads normally
9. Cancel the picker — verify no error, returns to upload page

---

## Phase 6: Upload Page — Native Picker Integration

### Task 6.1: Add native file upload function to API client

The native picker returns file paths on the device filesystem. We need to read these paths into Blobs and upload via the existing FormData/XHR pipeline.

**Files:**
- Modify: `frontend/src/api/client.ts`

```typescript
/**
 * Upload files from native file paths (Capacitor only).
 * Reads each path into a Blob via fetch(), then uploads through FormData.
 */
export async function uploadNativeFiles(
  files: Array<{ path: string; name: string; mimeType: string }>,
  onProgress?: (percent: number) => void,
): Promise<Media[]> {
  const form = new FormData();
  for (const f of files) {
    // Capacitor WebView can fetch() local file paths
    const response = await fetch(f.path);
    const blob = await response.blob();
    form.append("files", blob, f.name);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/media`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new ApiError(xhr.status, xhr.responseText || "Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}
```

**Edge case:** If `fetch(f.path)` fails (OS cleaned up temp file), the error propagates to the UI via the existing error handling in UploadPage.

**Fallback plan:** If `fetch()` can't read Capacitor temp paths (unlikely but possible), use `@capacitor/filesystem` plugin to read as base64 and convert to Blob. Don't implement this upfront — only if the fetch approach fails during testing.

**Commit:** `feat: add native file upload function for Capacitor`

---

### Task 6.2: Integrate native picker into UploadPage

**Files:**
- Modify: `frontend/src/pages/UploadPage.tsx`

**Changes:**

1. Import platform detection and native picker
2. Add `handleNativePick()` callback
3. Modify "Choose Files" button to use native picker on iOS
4. Hide drag-and-drop on native (not useful on mobile)
5. Update description text for mobile

```tsx
// Add imports
import { isNative, isIOS } from "../native/platform";
import LivePhotoPlugin from "../native/livePhotoPlugin";
import { uploadNativeFiles } from "../api/client";

// Add handler inside component
const [nativeProgress, setNativeProgress] = useState<number | null>(null);

const handleNativePick = useCallback(async () => {
  try {
    const result = await LivePhotoPlugin.pickMedia({ maxItems: 20 });
    if (result.files.length === 0) return; // User cancelled

    setStatus("uploading");
    setErrorMsg("");
    try {
      const uploaded = await uploadNativeFiles(
        result.files,
        setNativeProgress,
      );
      setUploadedCount(uploaded.length);
      setStatus("done");
      setNativeProgress(null);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
      setStatus("error");
      setNativeProgress(null);
    }
  } catch (e) {
    // Plugin error (e.g., permission denied)
    setErrorMsg(e instanceof Error ? e.message : "Could not open photo picker");
    setStatus("error");
  }
}, []);

// Modify button onClick
<button
  onClick={() => {
    if (isIOS()) {
      handleNativePick();
    } else {
      fileInputRef.current?.click(); // Android + Web: HTML file input
    }
  }}
  className="inline-flex items-center rounded-xl bg-copper px-6 py-3 text-sm font-semibold text-ink hover:bg-copper-light transition-colors"
>
  Choose Files
</button>

// Use nativeProgress for progress display (falls back to uploadProgress for web)
const displayProgress = isNative() ? nativeProgress : uploadProgress;

// Conditional drag-and-drop (disabled on native)
onDragOver={isNative() ? undefined : (e) => { e.preventDefault(); setDragOver(true); }}
onDragLeave={isNative() ? undefined : () => setDragOver(false)}
onDrop={isNative() ? undefined : onDrop}

// Mobile-friendly description text
<p className="text-sm text-warm-gray mb-6">
  {isNative()
    ? "Photos, Videos, and Live Photos"
    : "JPG, PNG, WEBP, MP4, MOV — up to 200MB"}
</p>
```

**Edge cases:**
- User cancels picker → `result.files.length === 0`, no-op (no error shown)
- Permission denied → `LivePhotoPlugin.pickMedia()` rejects, caught in outer try/catch, shows error
- Upload fails → inner try/catch shows error, doesn't leave UI in broken state
- Progress tracking → XHR onprogress works with Blob payloads, same as web

**Commit:** `feat: integrate native photo picker with Live Photo support on iOS`

---

### Task 6.3: Verify Android uses HTML file input

On Android, the HTML `<input type="file">` works well in Capacitor WebView. When users select a Motion Photo JPEG, it uploads as-is, and the backend (Phase 1) extracts the embedded video automatically.

No code changes needed — the `isIOS()` check in Task 6.2 already falls through to `fileInputRef.current?.click()` on Android and web.

**Verify:** Build and run on Android emulator, open upload page, use file picker.

**Commit (if fixes needed):** `fix: adjust upload page for Android`

---

### Task 6.4: Frontend test updates

Update existing UploadPage tests to handle the new native picker code paths. The `isNative()` and `isIOS()` functions return `false` in test environments (jsdom), so existing web-mode tests should still pass.

Add tests for:
- `isNative()` returns `false` in jsdom → drag-and-drop handlers are active
- `uploadNativeFiles()` function (unit test with mocked fetch)

**Run:** `docker compose exec frontend npm run test`
**Expected:** All pass.

**Commit:** `test: update upload page tests for native picker integration`

---

## Phase 7: Build & Distribution

### Task 7.1: Create mobile build script

**Files:**
- Create: `scripts/build-mobile.sh`

```bash
#!/usr/bin/env bash
# Build the mobile app for iOS and Android.
# Runs on Mac host (not Docker) — requires Xcode and Android Studio.
set -euo pipefail

cd "$(dirname "$0")/../frontend"

echo "==> Building web assets with mobile base URL..."
VITE_SERVER_BASE=http://home-pc npx vite build

echo "==> Syncing with native projects..."
npx cap sync

echo ""
echo "Done. Next steps:"
echo "  iOS:     npx cap open ios     (then build in Xcode)"
echo "  Android: npx cap open android (then build in Android Studio)"
```

**Commit:** `feat: add mobile build script`

---

### Task 7.2: App icon (optional but recommended)

Even for personal use, a recognizable icon helps find the app on the home screen.

Use the existing "Gallery After Dark" aesthetic — a simple copper-toned frame icon on a dark background.

**iOS:** Replace `frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/` contents
**Android:** Replace `frontend/android/app/src/main/res/mipmap-*/` contents

Can be done manually in Xcode (drag into asset catalog) and Android Studio.

---

## Phase 8: Share Extension (Deferred)

Share extensions are complex (especially iOS — separate process, App Groups, URL schemes). Defer to a follow-up PR after the core upload flow is working.

### Task 8.1: iOS Share Extension (future)

High-level steps documented here for reference:
1. Add Share Extension target in Xcode (separate process)
2. Configure App Group `group.com.flexoptix.photoframe` on both main app and extension
3. Extension receives shared media, saves to App Group shared container
4. Extension opens main app via `photoframe://shared` URL scheme
5. Main app reads shared files, uploads them
6. TypeScript: listen for `appUrlOpen` event via `@capacitor/app`

### Task 8.2: Android Share Target (future)

1. Add intent filters to `AndroidManifest.xml` for `SEND` and `SEND_MULTIPLE` with image/* and video/*
2. Handle incoming intent in the Capacitor activity
3. Read shared file URIs, upload them

---

## Implementation Order

```
Phase 1: Backend Motion Photo extraction (Docker, no native tools needed)
  1.1 → 1.2 → 1.3 → 1.4 → 1.5

Phase 2: Frontend base URL config (Docker)
  2.1 → 2.2 → 2.3

Phase 3: Capacitor init (Mac host)
  3.1 → 3.2 → 3.3 → 3.4 → 3.5

Phase 4: Connectivity guard (Docker for code, Mac for testing)
  4.1 → 4.2 → 4.3

Phase 5: iOS Live Photo plugin (Mac host + physical device)
  5.1 → 5.2 → 5.3

Phase 6: Upload page native integration (Docker for code, Mac for testing)
  6.1 → 6.2 → 6.3 → 6.4

Phase 7: Build & distribution (Mac host)
  7.1 → 7.2

Phase 8: Share extensions (future)
  8.1, 8.2
```

**Phases 1-2 can be done entirely in Docker** with existing test infrastructure — start here.
**Phases 3-7 require Mac host** with Xcode and Android Studio.
**Phase 8 is deferred** to a follow-up.

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Motion Photo XMP formats vary across manufacturers | Unrecognized format → video not extracted | Support 4 known formats, log unrecognized ones. Non-fatal: image always saved. |
| Embedded video corrupt / too small for ffprobe | Video processing fails | Wrap in try/except, log warning, image upload still succeeds. |
| Live Photo extraction plugin doesn't work | Can't upload Live Photos as video from iOS | Test on physical device early (simulator lacks Live Photos). |
| `fetch()` can't read Capacitor temp file paths | Native upload fails | Fallback: `@capacitor/filesystem` to read as base64, convert to Blob. |
| `CapacitorHttp` interferes with WebSocket | WS connection broken | CapacitorHttp only patches fetch/XHR, not WebSocket. Verified by research. |
| CORS issues despite CapacitorHttp | API calls fail | Backend already has `allow_origins=["*"]` as safety net. |
| iCloud-only photos take long to download | User waits, may think it's stuck | `isNetworkAccessAllowed = true` in PHAssetResourceRequestOptions. Consider adding a "downloading from iCloud" indicator (future). |
| Large Motion Photo exceeds upload limit | 200MB limit hit by JPEG + embedded video | The 200MB limit applies to the whole file. A Motion Photo with a 3s video is typically 5-15MB total. Not a realistic concern. |
| Samsung newer SEF trailer format not supported | Video not extracted from newer Samsung phones | Log and skip. Can be added later when we have a test file. Non-fatal. |
| Duplicate detection edge case: same photo uploaded as Motion Photo and separately as regular JPEG | Two photo records (different content_hash because Motion Photo JPEG includes video bytes) | Acceptable — different files, different hashes. User can delete duplicates manually. |
