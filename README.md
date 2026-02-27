# Photo Frame

A self-hosted digital photo frame with a web management UI. Upload photos and videos from any device, and display them in a fullscreen slideshow on a Raspberry Pi or any screen with a browser.

## Features

**Slideshow**
- Fullscreen display with blur background effect — no black borders, no cropping
- Crossfade, slide, or instant transitions between photos
- Videos auto-play muted and wait to finish before advancing
- Configurable interval, transition type, and photo ordering
- Tap or use arrow keys to navigate; long press for settings overlay

**Gallery & Upload**
- Drag-and-drop or file picker upload with progress bar
- Responsive photo grid with hover actions
- Real-time processing indicator for videos (circular progress, like downloading an app on iPhone)
- Duplicate detection via content hashing

**Video Processing**
- Uploads return instantly — transcoding happens in the background
- Only non-browser codecs (HEVC, ProRes) get transcoded to H.264
- Real-time progress broadcast via WebSocket

**Live Updates**
- WebSocket-powered — uploads, deletes, and settings changes sync across all open tabs instantly
- No page refresh needed

## How It Looks

The slideshow uses a CSS blur effect to fill the screen without cropping:

```
┌─────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░ │  ← Blurred + dimmed copy of the photo
│ ░░░░┌─────────────────┐░░░░ │
│ ░░░░│   actual photo   │░░░░ │  ← Full photo, uncropped
│ ░░░░└─────────────────┘░░░░ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└─────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLite (SQLAlchemy), Pillow, ffmpeg |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 3.4 |
| Real-time | WebSocket (FastAPI native) |
| Tests | pytest, Vitest, Playwright |
| Deploy | Docker Compose |

## Quick Start

```bash
# Clone and start
git clone https://github.com/taimoor-naveed/photo-frame.git
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

This builds optimized static assets and serves them via nginx on port 80. The backend runs with multiple uvicorn workers.

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
│       ├── components/     # PhotoCard, SlideshowOverlay, Navbar, ConfirmDialog
│       ├── hooks/          # usePhotos, useSettings, useWebSocket
│       └── api/            # Typed API client
├── e2e/                    # Playwright tests (desktop + mobile)
├── scripts/                # Test runner scripts
├── docs/                   # SPEC.md, STATE.md
├── docker-compose.yml      # Development
└── docker-compose.prod.yml # Production
```

## Architecture

```
Browser ──→ Vite Dev Server (:5173)      # Development
              ├── /api/*     ──proxy──→ FastAPI (:8000)
              ├── /uploads/* ──proxy──→ FastAPI (static files)
              └── /ws        ──proxy──→ FastAPI WebSocket

Browser ──→ nginx (:80)                  # Production
              ├── /api/*     ──proxy──→ FastAPI (:8000)
              ├── /uploads/* ──proxy──→ FastAPI (:8000)
              ├── /ws        ──proxy──→ FastAPI WebSocket
              └── /*         ──→ Static React build
```

## Supported Formats

| Type | Formats | Max Size |
|------|---------|----------|
| Photos | .jpg, .jpeg, .png, .webp, .heic | 200 MB |
| Videos | .mp4, .mov, .webm | 200 MB |

Videos with non-browser codecs (HEVC, ProRes) are automatically transcoded to H.264.

## Running Tests

```bash
# All tests (fail-early order: fast → slow)
./scripts/test-all.sh

# Individual suites
./scripts/test-frontend.sh    # Vitest (57 tests)
./scripts/test-backend.sh     # pytest (43 tests)
./scripts/test-e2e.sh         # Playwright (57 tests, desktop + mobile)
```

## Slideshow Controls

| Action | Result |
|--------|--------|
| Tap right half | Next slide |
| Tap left half | Previous slide |
| Long press (~500ms) | Toggle settings overlay |
| Arrow keys (←/→) | Previous / Next |
| Space | Pause / Resume |
| Escape | Close overlay |

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/media` | List media (paginated) |
| `POST` | `/api/media` | Upload files |
| `GET` | `/api/media/{id}` | Get media details |
| `DELETE` | `/api/media/{id}` | Delete media + files |
| `GET` | `/api/settings` | Get slideshow settings |
| `PUT` | `/api/settings` | Update settings |
| `WS` | `/ws` | Real-time events |

## License

Private project.
