# Photo Frame

A self-hosted digital photo frame with a web management UI. Upload photos and videos from any device, and display them in a fullscreen slideshow on a Raspberry Pi or any screen with a browser.

Built for a Raspberry Pi 4 with a 1024x600 touchscreen, but works on any device with a browser.

## Features

**Slideshow**
- Fullscreen display with blur background effect — no black borders, no cropping
- Crossfade, slide, or instant transitions
- Videos auto-play muted; long videos wait to finish before advancing, short videos show first frame while waiting
- Configurable interval (3s–60min) and transition type
- Tap zones (right/left halves) and arrow keys for navigation; long press for settings overlay
- Shuffled playlist order, auto-advances
- "Show in slideshow" — jump all connected slideshows to a specific photo/video from any device

**Gallery**
- Dark editorial theme ("Gallery After Dark") with frosted glass effects
- Responsive photo grid with click-to-open lightbox modal
- Lightbox shows full-size media, metadata (dimensions, file size, duration, upload date), download button, delete with confirmation
- Multi-select bulk deletion via long press
- Real-time processing indicator for videos (circular progress)

**Upload**
- Drag-and-drop or file picker with progress bar
- HEIC/HEIF support (iPhone photos) — auto-converted to JPEG
- Duplicate detection via SHA-256 content hashing

**Video Processing**
- Uploads return instantly — transcoding happens in the background
- Only non-browser codecs (HEVC, ProRes) get transcoded to H.264 (Main profile, level 4.0 for hardware decode on RPi)
- Browser-compatible videos (H.264, VP8, VP9, AV1) are kept as-is
- Real-time progress broadcast via WebSocket

**Performance**
- Display-optimized media generated at upload (sized for target display), originals preserved for download
- Cache headers on all static assets (UUID filenames = safe to cache forever)
- Next slide preloaded (photos and videos) for instant transitions

**Live Updates**
- WebSocket-powered — uploads, deletes, processing progress, and settings changes sync across all open tabs instantly
- No page refresh needed

## How It Looks

The slideshow uses a blur effect to fill the screen without cropping:

```
┌─────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░ │  <- Blurred + dimmed version of the media
│ ░░░░┌─────────────────┐░░░░ │
│ ░░░░│   actual photo   │░░░░ │  <- Full photo/video, uncropped
│ ░░░░└─────────────────┘░░░░ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└─────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLite (sync SQLAlchemy), Pillow, ffmpeg |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 3.4 |
| Real-time | WebSocket (FastAPI native) |
| Tests | pytest, Vitest, Playwright |
| Deploy | Docker Compose |

## Quick Start

```bash
# Clone and start
git clone <repo-url>
cd photo-frame
docker compose up --build

# Open in browser
# Gallery:    http://localhost:5173
# Slideshow:  http://localhost:5173/slideshow
# Upload:     http://localhost:5173/upload
# Settings:   http://localhost:5173/settings
```

## Production Deployment

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Builds optimized static assets and serves them via nginx on port 80. Backend runs with multiple uvicorn workers.

For RPi kiosk setup, see `docs/STATE.md` (Deployment Topology section).

## Project Structure

```
photo-frame/
├── backend/
│   ├── app/
│   │   ├── routers/        # media.py, settings.py
│   │   ├── services/       # image.py (Pillow), video.py (ffmpeg)
│   │   ├── models.py       # SQLAlchemy models
│   │   ├── schemas.py      # Pydantic schemas
│   │   ├── websocket.py    # WebSocket manager
│   │   └── config.py       # Paths, limits, extensions
│   └── tests/              # unit/ + integration/
├── frontend/
│   └── src/
│       ├── pages/          # Gallery, Upload, Settings, Slideshow
│       ├── components/     # PhotoCard, MediaDetailModal, SlideshowOverlay, etc.
│       ├── hooks/          # usePhotos, useSettings, useWebSocket
│       └── api/            # Typed API client
├── e2e/                    # Playwright tests (desktop + mobile viewports)
├── scripts/                # Test runners, deployment, migrations
├── docs/                   # SPEC.md (contract), STATE.md (progress)
├── docker-compose.yml      # Development
└── docker-compose.prod.yml # Production
```

## Architecture

```
Browser ──> Vite Dev Server (:5173)      # Development
              ├── /api/*     ──proxy──> FastAPI (:8000)
              ├── /uploads/* ──proxy──> FastAPI (static files)
              └── /ws        ──proxy──> FastAPI WebSocket

Browser ──> nginx (:80)                  # Production
              ├── /api/*     ──proxy──> FastAPI (:8000)
              ├── /uploads/* ──proxy──> FastAPI (:8000)
              ├── /ws        ──proxy──> FastAPI WebSocket
              └── /*         ──> Static React build
```

## Supported Formats

| Type | Formats | Max Size |
|------|---------|----------|
| Photos | .jpg, .jpeg, .png, .webp, .heic | 200 MB |
| Videos | .mp4, .mov, .webm | 200 MB |

HEIC photos (iPhone) are auto-converted to JPEG. Videos with non-browser codecs (HEVC, ProRes) are automatically transcoded to H.264.

## Running Tests

All tests run inside Docker — no host dependencies needed.

```bash
# All tests (fail-early order: frontend -> backend unit -> backend integration -> e2e)
./scripts/test-all.sh

# Individual suites
./scripts/test-frontend.sh    # Vitest (~142 tests)
./scripts/test-backend.sh     # pytest (~142 tests)
./scripts/test-e2e.sh         # Playwright (~200 tests, desktop + mobile)
```

## Slideshow Controls

| Action | Result |
|--------|--------|
| Tap right half | Next slide |
| Tap left half | Previous slide |
| Long press (~500ms) | Toggle settings overlay |
| Arrow keys (left/right) | Previous / Next |
| Space | Pause / Resume |
| Escape | Close overlay |

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/media` | List media (paginated) |
| `POST` | `/api/media` | Upload files (multipart) |
| `GET` | `/api/media/{id}` | Get media details |
| `DELETE` | `/api/media/{id}` | Delete media + files |
| `DELETE` | `/api/media/bulk` | Bulk delete by IDs |
| `POST` | `/api/media/slideshow/jump` | Jump slideshow to specific media |
| `GET` | `/api/settings` | Get slideshow settings |
| `PUT` | `/api/settings` | Update settings (partial) |
| `WS` | `/ws` | Real-time events |

### WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `media_added` | Server -> Client | New media uploaded |
| `media_deleted` | Server -> Client | Media deleted |
| `media_processing_complete` | Server -> Client | Video transcode finished |
| `media_processing_progress` | Server -> Client | Transcode progress (0-100%) |
| `settings_changed` | Server -> Client | Settings updated |
| `slideshow_jump` | Server -> Client | Jump to specific media |

## License

Private project.
