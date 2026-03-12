# Photo Frame — Specification

## API Contract

### Media
| Method   | Endpoint                          | Description                           |
|----------|-----------------------------------|---------------------------------------|
| `GET`    | `/api/media`                      | List all media (paginated)            |
| `POST`   | `/api/media`                      | Upload photos, videos, or Motion Photos |
| `GET`    | `/api/media/{id}`                 | Get media metadata                    |
| `DELETE` | `/api/media/bulk`                 | Bulk delete media by IDs              |
| `POST`   | `/api/media/slideshow/jump`       | Jump slideshow to specific media item |
| `DELETE` | `/api/media/{id}`                 | Delete media + all associated files   |
| `GET`    | `/uploads/originals/{filename}`   | Serve full-size image/video           |
| `GET`    | `/uploads/thumbnails/{filename}`  | Serve thumbnail                       |
| `GET`    | `/uploads/display/{filename}`     | Serve display-optimized media (1024x600)|

### Settings
| Method | Endpoint         | Description            |
|--------|------------------|------------------------|
| `GET`  | `/api/settings`  | Get slideshow settings |
| `PUT`  | `/api/settings`  | Update settings        |

### WebSocket
`ws://host/ws` — JSON events with format `{"type": "<event>", "payload": {...}}`:
- `media_added` — payload: full media object (may have `processing_status: "processing"` for videos)
- `media_deleted` — payload: `{"id": <media_id>}`
- `media_processing_progress` — payload: `{"id": <media_id>, "progress": 0-100}`
- `media_processing_complete` — payload: full media object (with `processing_status: "ready"`)
- `media_processing_error` — payload: `{"id": <media_id>}`
- `slideshow_jump` — payload: `{"id": <media_id>}` (jump all slideshows to this media)
- `settings_changed` — payload: full settings object

### File Serving
All `/uploads/*` routes return `Cache-Control: public, max-age=31536000, immutable` (filenames contain UUIDs). Path traversal protection via `is_relative_to()` + null byte rejection.

### Health
`GET /api/health` → `{"status": "ok"}`

## Database Schema

```sql
media:
  id          INTEGER PRIMARY KEY AUTOINCREMENT
  filename    TEXT NOT NULL UNIQUE    -- stored filename (UUID-based)
  original_name TEXT NOT NULL         -- user's original filename
  media_type  TEXT NOT NULL           -- 'photo' | 'video'
  width       INTEGER NOT NULL
  height      INTEGER NOT NULL
  file_size   INTEGER NOT NULL        -- bytes
  duration    REAL                    -- seconds, NULL for photos
  codec       TEXT                    -- original codec, NULL for photos
  thumb_filename TEXT NOT NULL        -- thumbnail filename in thumbnails/
  processing_status TEXT NOT NULL DEFAULT 'ready'  -- 'processing' | 'ready' | 'error'
  display_filename TEXT               -- display-optimized file (1024x600 max), NULL if within bounds
  content_hash  TEXT UNIQUE           -- SHA-256 for duplicate detection
  uploaded_at DATETIME NOT NULL       -- UTC

settings:
  id                  INTEGER PRIMARY KEY DEFAULT 1
  slideshow_interval  INTEGER NOT NULL DEFAULT 10    -- seconds
  transition_type     TEXT NOT NULL DEFAULT 'crossfade'
```

No migrations — clean-slate deploy. Tables auto-created via `Base.metadata.create_all()`.

## Media Pipeline

### Duplicate Detection
All uploads are SHA-256 hashed. If the hash matches an existing record, the existing media item is returned (no error, no re-processing). For Motion Photos, the hash is computed on the extracted video bytes.

### Motion Photo / Live Photo Support
JPEG files are checked for embedded video before normal photo processing. If detected, the video is extracted and saved as a video media record (the JPEG wrapper is discarded).

**Supported formats:**
- **Samsung**: `MotionPhoto_Data` marker (searched via `rfind` to avoid false positives from EXIF metadata)
- **Google Pixel (older)**: `MicroVideo` + `MicroVideoOffset` XMP markers
- **Google Pixel (newer)**: `MotionPhoto` + `Item:Length` XMP markers
- **iPhone (iOS)**: Live Photos are separate HEIC + MOV files natively. An iOS Shortcut uses "Encode Media" to produce a Motion Photo container before uploading. See `docs/ios-shortcut-setup.md`.

Non-JPEG files (PNG, HEIC, etc.) skip Motion Photo detection. If video extraction fails, the file falls back to normal photo processing.

### Photo Upload
1. Validate extension (jpg, jpeg, png, webp, heic) + mime type
2. Check for Motion Photo — if detected, extract video and process as video upload instead
3. `ImageOps.exif_transpose()` — auto-rotate to correct orientation
4. Convert HEIC → JPEG; convert RGBA/palette → RGB
5. SHA-256 content hash → skip if duplicate
6. Save processed original → `data/originals/` (EXIF-rotated, re-encoded at quality 95; **note:** raw bytes are not preserved — see future work)
7. Generate thumbnail (300px max dimension, JPEG quality 85)
8. Generate display-optimized JPEG if image exceeds 1024x600 bounding box → `data/display/`
9. Extract dimensions from rotated image
10. Insert DB row, broadcast `media_added` via WebSocket

### Video Upload (Two-Phase)
**Phase 1 (synchronous — returns immediately):**
1. Validate extension (mp4, mov, webm) + mime type
2. SHA-256 content hash → skip if duplicate
3. Save original → `data/originals/`
4. `ffprobe` — extract duration, resolution, codec
5. Generate thumbnail at 25% → `data/thumbnails/` (uses `-map 0:v:0` for multi-stream safety)
6. Insert DB row with `processing_status="processing"` if transcode/scaling needed, `"ready"` otherwise
7. Broadcast `media_added` via WebSocket

**Phase 2 (background thread — if transcode or display scaling needed):**
1. `ffmpeg` transcode to H.264 MP4 (Main profile, level 4.0, capped at 1024x600, `force_divisible_by=2`) with `-progress pipe:1`
2. Uses `-map 0:v:0 -map 0:a:0?` to handle iPhone `.mov` files with extra metadata streams
3. Parse progress, broadcast `media_processing_progress` events (throttled every 3%)
4. On success: update DB to `"ready"`, broadcast `media_processing_complete`
5. On failure: update DB to `"error"`, broadcast `media_processing_error`
6. Post-processing: verify DB record still exists — delete orphaned output file if record was deleted during processing

### Future: Preserve Original Uploads

Gotchas discovered during a prior attempt:

- **`displayUrl()` null safety**: Originals may be raw HEIC or un-rotated JPEG. `display_filename` is null during video background processing — `displayUrl()` needs a fallback to `originalUrl()` for that window.
- **Small video re-encoding**: Don't run all browser-compatible videos through ffmpeg just to generate a display version. Small videos (within 1024x600) don't need it.
- **Width/height vs raw file**: After EXIF transpose, DB dimensions reflect display orientation, but raw bytes have pre-rotation pixel dimensions.
- **All videos start as "processing"**: If every video needs a display version, they all start as `processing_status="processing"`, changing frontend behavior (slideshow skips processing items).

### Supported Formats
- **Photos**: .jpg, .jpeg, .png, .webp, .heic
- **Videos**: .mp4 (H.264), .mov (H.264/HEVC), .webm (VP9)
- **Max upload size**: 200MB

## Gallery — Media Detail Modal

Clicking a thumbnail in the gallery opens a lightbox modal:

| Element         | Details                                                    |
|-----------------|------------------------------------------------------------|
| Backdrop        | `bg-black/60 backdrop-blur-sm`, click to close             |
| Header          | Filename, show-in-slideshow / download / delete / close     |
| Media area      | Full-size `<img>` or `<video autoPlay muted controls>`     |
| Metadata bar    | W × H, file size (human-readable), duration (videos), date |
| Delete          | Trash icon → ConfirmDialog → delete + close modal          |
| Close           | X button, Escape key, or backdrop click                    |

Body scroll is locked while the modal is open. Escape is suppressed when the ConfirmDialog is open (to avoid closing both).

### Multi-Select Bulk Deletion
Long press (500ms) on any photo card enters selection mode. In selection mode:
- Tap toggles selection (copper ring + checkmark)
- Floating bottom bar: Cancel, selected count, "Select all" / "Deselect all", red Delete button
- Delete opens ConfirmDialog → calls `DELETE /api/media/bulk`
- Escape exits selection mode
- Auto-exits when gallery empties
- Stale IDs pruned when photos are deleted via WebSocket

### Download
Download button in modal header triggers native `<a download>` for the original file.

## Display — Blur Background Effect

Real-time CSS `blur(30px)` applied to a scaled-up copy of the media element. For photos, a background `<img>` with the same src is CSS-blurred. For videos, a second `<video>` element plays in sync and is CSS-blurred (dynamic blur that moves with the video). No server-side blur generation — all blur is CSS-only.

```
┌─────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← CSS blur(30px) + scale(1.2) + brightness(0.7)
│ ░░░░┌─────────────────┐░░░░ │
│ ░░░░│   actual photo  │░░░░ │  ← Full uncropped (object-fit: contain)
│ ░░░░└─────────────────┘░░░░ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└─────────────────────────────┘
```

Works for both `<img>` and `<video>`.

## Slideshow Behavior

### Photo Slides
- Display for `slideshow_interval` seconds, then crossfade to next

### Video Slides (Motion Pictures)
- Slide appears → `<video autoplay muted>` plays immediately
- On `ended`: video pauses on last frame (natural behavior)
- If video duration ≤ interval: timer advances after `slideshow_interval` seconds (video freezes on last frame until timer fires)
- If video duration > interval: slideshow waits for video to finish, then advances on the `ended` event

### Touch / Click Interaction
| Action               | Result                    |
|----------------------|---------------------------|
| Tap right half       | Next slide                |
| Tap left half        | Previous slide            |
| Long press (~500ms)  | Toggle settings overlay   |
| Tap outside overlay  | Dismiss settings overlay  |
| Arrow keys (L/R)     | Previous / Next slide     |
| Space                | Pause / resume            |
| Escape               | Dismiss overlay           |

### Transitions
- **Crossfade**: new slide fades in (opacity 0→1) over previous via CSS `@keyframes` animation (800ms)
- **Slide**: new slide slides in from right (or left for backward navigation), previous slides out opposite direction (800ms)
- **None**: instant swap

### Preloading
Next media item is preloaded while the current slide is displayed. Images use `new Image()`, videos use a hidden `<video preload="auto">` element. Preload is discarded on manual skip.

### Settings Overlay
Frosted glass bottom sheet with drag handle and rounded top corners. Controls: large centered play/pause button, interval slider (3–60s, debounced 400ms), transition segmented control (crossfade / slide / none). Auto-hides after 5s of inactivity; any interaction or WebSocket settings change resets the timer. Clicking/tapping outside the overlay dismisses it. Pointer events inside the overlay do not propagate to the slideshow tap zones.

## UX / Design Principles — "Gallery After Dark"

- **Dark editorial theme**: warm navy background (#303548), copper accent (#D4956A)
- **Typography**: DM Serif Display (headings), Karla (body) — editorial gallery aesthetic
- **Ambient depth**: gradient mesh blobs (copper + indigo) behind content, film grain overlay
- **Cards**: surface-colored (#3A4058) with warm shadows, lift-on-hover effect
- **Frosted glass**: `backdrop-filter: blur` on navbar, slideshow overlay, selection bar
- **Touch targets**: minimum 44px, large controls in slideshow overlay (56px play/pause)
- **Responsive**: mobile hamburger nav, desktop inline nav
- **Photo-first**: UI fades into background, photos/videos are the star
