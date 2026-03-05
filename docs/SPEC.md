# Photo Frame — Specification

## API Contract

### Media
| Method   | Endpoint                          | Description                           |
|----------|-----------------------------------|---------------------------------------|
| `GET`    | `/api/media`                      | List all media (paginated)            |
| `POST`   | `/api/media`                      | Upload photos and/or videos           |
| `GET`    | `/api/media/{id}`                 | Get media metadata                    |
| `DELETE` | `/api/media/bulk`                 | Bulk delete media by IDs              |
| `DELETE` | `/api/media/{id}`                 | Delete media + all associated files   |
| `GET`    | `/uploads/originals/{filename}`   | Serve full-size image/video           |
| `GET`    | `/uploads/thumbnails/{filename}`  | Serve thumbnail                       |
| `GET`    | `/uploads/transcoded/{filename}`  | Serve transcoded video (H.264)        |
| `GET`    | `/uploads/display/{filename}`     | Serve display-optimized media (1920px)|

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
- `media_processing_error` — payload: `{"id": <media_id>, "error": "<message>"}`
- `settings_changed` — payload: full settings object

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
  transcoded_filename TEXT            -- transcoded video filename, NULL if not needed
  processing_status TEXT NOT NULL DEFAULT 'ready'  -- 'processing' | 'ready' | 'error'
  display_filename TEXT               -- display-optimized file (1920px max), NULL if not needed
  content_hash  TEXT UNIQUE           -- SHA-256 for duplicate detection
  uploaded_at DATETIME NOT NULL       -- UTC

settings:
  id                  INTEGER PRIMARY KEY DEFAULT 1
  slideshow_interval  INTEGER NOT NULL DEFAULT 10    -- seconds
  transition_type     TEXT NOT NULL DEFAULT 'crossfade'
```

No migrations — tables auto-created via `Base.metadata.create_all()`.
New columns added via idempotent `ALTER TABLE` in `database.py`.

## Media Pipeline

### Photo Upload
1. Validate extension (jpg, jpeg, png, webp, heic) + mime type
2. `ImageOps.exif_transpose()` — auto-rotate to correct orientation
3. Generate thumbnail (300px max dimension, preserve aspect ratio)
4. Save: rotated original → `data/originals/`, thumbnail → `data/thumbnails/`
5. Extract dimensions from rotated image
6. Insert DB row, broadcast `media_added` via WebSocket

### Video Upload (Two-Phase)
**Phase 1 (synchronous — returns immediately):**
1. Validate extension (mp4, mov, webm) + mime type
2. SHA-256 content hash → skip if duplicate
3. Save original → `data/originals/`
4. `ffprobe` — extract duration, resolution, codec
5. Generate thumbnail at 25% → `data/thumbnails/`
6. Insert DB row with `processing_status="processing"` (or `"ready"` if no transcode needed)
7. Broadcast `media_added` via WebSocket

**Phase 2 (background thread — only if transcode needed):**
1. `ffmpeg` transcode to H.264 MP4 with `-progress pipe:1`
2. Parse progress, broadcast `media_processing_progress` events (throttled every 3%)
3. On success: update DB to `"ready"`, broadcast `media_processing_complete`
4. On failure: update DB to `"error"`, broadcast `media_processing_error`

### Supported Formats
- **Photos**: .jpg, .jpeg, .png, .webp, .heic
- **Videos**: .mp4 (H.264), .mov (H.264/HEVC), .webm (VP9)
- **Max upload size**: 200MB

## Gallery — Media Detail Modal

Clicking a thumbnail in the gallery opens a lightbox modal:

| Element         | Details                                                    |
|-----------------|------------------------------------------------------------|
| Backdrop        | `bg-black/60 backdrop-blur-sm`, click to close             |
| Header          | Filename (truncated), trash icon, close (X) button         |
| Media area      | Full-size `<img>` or `<video autoPlay muted controls>`     |
| Metadata bar    | W × H, file size (human-readable), duration (videos), date |
| Delete          | Trash icon → ConfirmDialog → delete + close modal          |
| Close           | X button, Escape key, or backdrop click                    |

Body scroll is locked while the modal is open. Escape is suppressed when the ConfirmDialog is open (to avoid closing both).

## Display — Blur Background Effect

Aspect ratio: 10:7 (~1.43:1). Pure CSS, no backend processing.

```
┌─────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← Blurred + zoomed (object-fit: cover, blur 30px)
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
- **Crossfade**: new slide fades in (opacity 0→1) over previous via double-rAF technique
- **Slide**: new slide slides in from right, previous slides out left
- **None**: instant swap

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
