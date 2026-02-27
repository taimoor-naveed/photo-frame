# Photo Frame — Raspberry Pi Photo Frame with Web Management UI

## Overview

A photo frame application for Raspberry Pi 5 with a touchscreen display and web-based management UI. Developed on Mac with Docker, deployed to RPi5 later. Supports photos and videos (motion pictures). Low traffic: 2-3 concurrent users, 50 max.

## Stack

| Layer        | Technology                      | Version        |
|--------------|---------------------------------|----------------|
| Backend      | Python + FastAPI + uvicorn      | Python 3.12    |
| Frontend     | TypeScript + React + Vite       | React 19, Vite 6 |
| Database     | SQLite (sync SQLAlchemy)        | SQLAlchemy 2.0 |
| Images       | Pillow                          | 11.1           |
| Video        | ffmpeg (via ffmpeg-python)      | —              |
| Styling      | Tailwind CSS                    | 3.4            |
| Real-time    | WebSocket (FastAPI native)      | —              |
| Touch        | @use-gesture/react              | 10.3           |
| Deployment   | Docker Compose                  | —              |
| Backend Test | pytest + httpx                  | —              |
| Frontend Test| Vitest + React Testing Library  | —              |
| E2E Test     | Playwright                      | —              |

## Architecture

```
Browser ──→ Vite Dev Server (:5173)
              │
              ├── /api/*     ──proxy──→  FastAPI (:8000)
              ├── /uploads/* ──proxy──→  FastAPI (static files)
              └── /ws        ──proxy──→  FastAPI WebSocket
```

Backend serves API + static files (originals, thumbnails, transcoded videos). Frontend proxies API calls in dev mode. WebSocket broadcasts events for live slideshow updates.

## File Structure

```
photo-frame/
├── CLAUDE.md                    # This file — project context
├── docker-compose.yml           # Backend + frontend services
├── backend/
│   ├── Dockerfile               # Python 3.12-slim + ffmpeg
│   ├── requirements.txt         # Production deps
│   ├── requirements-dev.txt     # Test deps (pytest, httpx)
│   ├── pytest.ini
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, health, WebSocket, static files
│   │   ├── config.py            # Paths, defaults, allowed extensions
│   │   ├── database.py          # SQLite engine, sessionmaker, init_db()
│   │   ├── models.py            # Media, Settings (SQLAlchemy ORM)
│   │   ├── schemas.py           # Pydantic: MediaOut, SettingsOut, SettingsUpdate
│   │   ├── websocket.py         # ConnectionManager (connect, disconnect, broadcast)
│   │   ├── routers/
│   │   │   ├── media.py         # Media CRUD (stub — Phase 2)
│   │   │   └── settings.py      # Settings CRUD (stub — Phase 2)
│   │   └── services/
│   │       ├── image.py         # EXIF rotate, thumbnails (stub — Phase 2)
│   │       └── video.py         # Transcode, thumbnails (stub — Phase 2)
│   ├── tests/
│   │   ├── conftest.py
│   │   ├── unit/
│   │   └── integration/
│   └── data/                    # Volume: photos.db, originals/, thumbnails/, transcoded/
├── frontend/
│   ├── Dockerfile               # Node 20-slim
│   ├── package.json
│   ├── vite.config.ts           # Proxy /api, /uploads, /ws to backend
│   ├── vitest.config.ts         # jsdom, globals
│   ├── tailwind.config.js       # Apple system font stack
│   ├── index.html
│   └── src/
│       ├── main.tsx             # React root + BrowserRouter
│       ├── App.tsx              # Routes: Gallery, Upload, Settings, Slideshow
│       ├── index.css            # Tailwind directives
│       ├── api/client.ts        # (stub — Phase 3)
│       ├── hooks/               # (stubs — Phase 3-4)
│       ├── pages/
│       │   ├── GalleryPage.tsx  # Placeholder — empty state with upload link
│       │   ├── UploadPage.tsx   # Placeholder — drag-drop zone
│       │   ├── SettingsPage.tsx # Placeholder — settings form
│       │   └── SlideshowPage.tsx # Placeholder — fullscreen black
│       └── components/
│           └── Navbar.tsx       # Responsive nav with mobile hamburger
├── e2e/                         # Playwright (Phase 5)
└── scripts/
    ├── test-all.sh              # Fail-early: E2E → integration → unit
    ├── test-backend.sh          # Backend integration + unit
    ├── test-frontend.sh         # Frontend unit
    └── test-e2e.sh              # Playwright E2E
```

## API Contract

### Media
| Method   | Endpoint                          | Description                           |
|----------|-----------------------------------|---------------------------------------|
| `GET`    | `/api/media`                      | List all media (paginated)            |
| `POST`   | `/api/media`                      | Upload photos and/or videos           |
| `GET`    | `/api/media/{id}`                 | Get media metadata                    |
| `DELETE` | `/api/media/{id}`                 | Delete media + all files              |
| `GET`    | `/uploads/originals/{filename}`   | Serve full-size image/video           |
| `GET`    | `/uploads/thumbnails/{filename}`  | Serve thumbnail                       |
| `GET`    | `/uploads/transcoded/{filename}`  | Serve transcoded video                |

### Settings
| Method | Endpoint         | Description          |
|--------|------------------|----------------------|
| `GET`  | `/api/settings`  | Get slideshow settings |
| `PUT`  | `/api/settings`  | Update settings      |

### WebSocket
`ws://host/ws` — events: `media_added`, `media_deleted`, `settings_changed`

### Health
`GET /api/health` → `{"status": "ok"}`

## Database Schema

```sql
media: id(PK), filename(unique), original_name, media_type('photo'|'video'),
       width, height, file_size, duration(nullable), codec(nullable), uploaded_at

settings: id(=1), slideshow_interval(=10), transition_type(='crossfade'), photo_order(='random')
```

## Media Handling

### Display: 10:7 aspect ratio — blur background effect (CSS only)
- Background: blurred + zoomed copy (`object-fit: cover`, `filter: blur(30px)`)
- Foreground: full uncropped image (`object-fit: contain`)
- No black borders, no cropping, no backend processing

### Upload pipeline
- Photos: EXIF auto-rotate → thumbnail (300px) → store
- Videos: ffprobe metadata → thumbnail at 25% → HEVC→H.264 transcode if needed → store

### Video playback in slideshow
- Auto-play muted, freeze on last frame, stay for remaining slide duration
- Same blur background effect as photos

## Design Principles

- Apple-inspired: generous white space, rounded corners (lg/xl), subtle shadows
- System font stack: -apple-system, SF Pro
- Muted colors: whites, light grays, one accent
- Smooth transitions (200-300ms ease)
- Frosted glass overlays (backdrop-filter: blur)
- Large touch targets (min 44px)
- Photo-first: UI fades into background

## Dev Commands

```bash
# Start services
docker compose up              # Both services, logs visible
docker compose up -d           # Detached mode

# Stop services
docker compose down

# Rebuild after dependency changes
docker compose build
docker compose up --build

# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Run tests (services must be running)
./scripts/test-backend.sh      # Backend integration + unit
./scripts/test-frontend.sh     # Frontend unit
./scripts/test-e2e.sh          # Playwright E2E
./scripts/test-all.sh          # Everything, fail-early order

# Access containers
docker compose exec backend bash
docker compose exec frontend sh
```

**Ports**: Backend = 8000, Frontend = 5173

## Touch Gestures (Slideshow)

| Gesture     | Action                     |
|-------------|----------------------------|
| Swipe left  | Next photo                 |
| Swipe right | Previous photo             |
| Single tap  | Toggle settings overlay    |
| Long press  | Pause/resume auto-advance  |

Overlay: frosted glass bottom sheet, auto-hides after 5s.

## Phase Tracker

| Phase | Description                              | Status      |
|-------|------------------------------------------|-------------|
| 1     | Foundation (Docker, scaffolding, DB)     | **COMPLETE** |
| 2     | Backend API + WebSocket + Tests          | PENDING     |
| 3     | Frontend Management UI + Tests           | PENDING     |
| 4     | Slideshow + Touch + Live Updates         | PENDING     |
| 5     | E2E Tests + Docker Polish                | PENDING     |

### Phase 1 — Complete
- Git repo initialized
- Docker Compose: backend (Python 3.12 + FastAPI) + frontend (Node 20 + Vite)
- Backend: FastAPI skeleton with health endpoint, SQLAlchemy models, WebSocket manager
- Frontend: React + TypeScript + Tailwind, responsive Navbar, placeholder pages
- Test scripts created (stubs for now)
- Verified: `docker compose up` — both services start, health returns ok, frontend serves pages

### Phase 2 — Next
Implement backend API: image service, video service, media CRUD, settings CRUD, WebSocket events, full test suite.

## Decisions Log

- Using sync SQLAlchemy (not async) — sufficient for 2-3 concurrent users, simpler code
- Frontend Dockerfile uses `npm install` at build time (no lock file committed yet — generated in container)
- Vite proxies all `/api`, `/uploads`, `/ws` to backend — no CORS issues in dev
- Test scripts use `docker compose exec` (requires running containers)
