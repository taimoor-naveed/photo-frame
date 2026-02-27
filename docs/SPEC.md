# Photo Frame — Specification

## API Contract

### Media
| Method   | Endpoint                          | Description                           |
|----------|-----------------------------------|---------------------------------------|
| `GET`    | `/api/media`                      | List all media (paginated)            |
| `POST`   | `/api/media`                      | Upload photos and/or videos           |
| `GET`    | `/api/media/{id}`                 | Get media metadata                    |
| `DELETE` | `/api/media/{id}`                 | Delete media + all associated files   |
| `GET`    | `/uploads/originals/{filename}`   | Serve full-size image/video           |
| `GET`    | `/uploads/thumbnails/{filename}`  | Serve thumbnail                       |
| `GET`    | `/uploads/transcoded/{filename}`  | Serve transcoded video (H.264)        |

### Settings
| Method | Endpoint         | Description            |
|--------|------------------|------------------------|
| `GET`  | `/api/settings`  | Get slideshow settings |
| `PUT`  | `/api/settings`  | Update settings        |

### WebSocket
`ws://host/ws` — JSON events with format `{"type": "<event>", "payload": {...}}`:
- `media_added` — payload: full media object
- `media_deleted` — payload: `{"id": <media_id>}`
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
  uploaded_at DATETIME NOT NULL       -- UTC

settings:
  id                  INTEGER PRIMARY KEY DEFAULT 1
  slideshow_interval  INTEGER NOT NULL DEFAULT 10    -- seconds
  transition_type     TEXT NOT NULL DEFAULT 'crossfade'
  photo_order         TEXT NOT NULL DEFAULT 'random'
```

No migrations — tables auto-created via `Base.metadata.create_all()`.

## Media Pipeline

### Photo Upload
1. Validate extension (jpg, jpeg, png, webp, heic) + mime type
2. `ImageOps.exif_transpose()` — auto-rotate to correct orientation
3. Generate thumbnail (300px max dimension, preserve aspect ratio)
4. Save: rotated original → `data/originals/`, thumbnail → `data/thumbnails/`
5. Extract dimensions from rotated image
6. Insert DB row, broadcast `media_added` via WebSocket

### Video Upload
1. Validate extension (mp4, mov, webm) + mime type
2. `ffprobe` — extract duration, resolution, codec
3. Generate thumbnail: snapshot at 25% of duration → `data/thumbnails/`
4. If HEVC/H.265 → transcode to H.264 MP4 → `data/transcoded/`
5. Save original → `data/originals/`
6. Insert DB row, broadcast `media_added` via WebSocket

### Supported Formats
- **Photos**: .jpg, .jpeg, .png, .webp, .heic
- **Videos**: .mp4 (H.264), .mov (H.264/HEVC), .webm (VP9)
- **Max upload size**: 200MB

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
Frosted glass bottom sheet. Controls: interval slider, transition toggle, order toggle, pause/play, "Manage Photos" link. Auto-hides after 5s of inactivity. Any interaction inside the overlay resets the timer. Clicking/tapping outside the overlay dismisses it. Pointer events inside the overlay do not propagate to the slideshow tap zones.

## UX / Design Principles

- **Apple-inspired**: generous white space, rounded corners (lg/xl), subtle shadows
- **System font stack**: -apple-system, BlinkMacSystemFont, SF Pro
- **Colors**: whites, light grays, one accent color (gray-900 for primary actions)
- **Transitions**: 200-300ms ease
- **Overlays**: `backdrop-filter: blur` (frosted glass)
- **Touch targets**: minimum 44px
- **Responsive**: mobile hamburger nav, desktop inline nav
- **Photo-first**: UI fades into background, photos/videos are the star
