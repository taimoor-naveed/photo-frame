# Photo Frame — Project State

## Phase Overview

| Phase | Description                          | Status       |
|-------|--------------------------------------|--------------|
| 1     | Foundation (Docker, scaffolding, DB) | **COMPLETE** |
| 2     | Backend API + WebSocket + Tests      | **CURRENT**  |
| 3     | Frontend Management UI + Tests       | Pending      |
| 4     | Slideshow + Touch + Live Updates     | Pending      |
| 5     | E2E Tests + Docker Polish            | Pending      |

---

## Phase 1 — COMPLETE

**What was done:**
- Git repo initialized with .gitignore
- Docker Compose: backend (Python 3.12 + FastAPI) + frontend (Node 20 + Vite)
- Backend skeleton: health endpoint, SQLAlchemy models (Media, Settings), WebSocket manager, Pydantic schemas, router/service stubs
- Frontend skeleton: React 19 + TS + Tailwind, responsive Navbar, 4 placeholder pages
- Vite proxy config for /api, /uploads, /ws
- Test runner scripts (stubs)
- CLAUDE.md + docs/SPEC.md + docs/STATE.md

**Verified:** `docker compose up` → both services start, `GET /api/health` → `{"status":"ok"}`, frontend serves React app on :5173

**Decisions:**
- Sync SQLAlchemy (not async) — sufficient for 2-3 users
- No package-lock.json committed — generated in container at build
- Test scripts use `docker compose exec` (requires running containers)

---

## Phase 2 — CURRENT: Backend API + WebSocket + Tests

### Definition of Done
- [ ] `POST /api/media` handles multi-file upload, stores originals, creates thumbnail (Pillow for photos, ffmpeg for videos), transcodes HEVC→H.264, inserts DB rows
- [ ] `GET /api/media` returns paginated list with media metadata (page, per_page query params)
- [ ] `GET /api/media/{id}` returns single media item metadata
- [ ] `DELETE /api/media/{id}` removes DB row + original + thumbnail + transcoded files
- [ ] `GET /api/settings` returns settings (creates default row if missing)
- [ ] `PUT /api/settings` updates settings (partial update)
- [ ] Static file serving works for `/uploads/originals/`, `/uploads/thumbnails/`, `/uploads/transcoded/`
- [ ] WebSocket broadcasts `media_added` on upload, `media_deleted` on delete, `settings_changed` on settings update
- [ ] Unit tests: image service (EXIF rotation, thumbnail), video service (metadata, thumbnail, transcode)
- [ ] Integration tests: all media endpoints (photo + video), all settings endpoints, WebSocket broadcast
- [ ] `./scripts/test-backend.sh` passes clean

### Ordered Task List

1. **Image service** (`backend/app/services/image.py`)
   - `process_image(file) → (saved_path, thumb_path, width, height)`
   - EXIF auto-rotate with `ImageOps.exif_transpose()`
   - Thumbnail: 300px max dimension, JPEG output

2. **Video service** (`backend/app/services/video.py`)
   - `get_video_metadata(path) → (duration, width, height, codec)`
   - `generate_video_thumbnail(path) → thumb_path` (snapshot at 25% duration)
   - `transcode_to_h264(path) → transcoded_path` (only if HEVC)

3. **Media router — upload** (`backend/app/routers/media.py`)
   - `POST /api/media` accepting `UploadFile` list
   - Route to image or video service based on extension
   - UUID filenames, preserve original_name
   - Return list of created MediaOut

4. **Media router — list, get, delete** (`backend/app/routers/media.py`)
   - `GET /api/media?page=1&per_page=20` — paginated, ordered by uploaded_at desc
   - `GET /api/media/{id}` — 404 if not found
   - `DELETE /api/media/{id}` — remove DB row + all files on disk

5. **Settings router** (`backend/app/routers/settings.py`)
   - `GET /api/settings` — return settings, auto-create default row if missing
   - `PUT /api/settings` — partial update, validate values

6. **WebSocket events** (`backend/app/routers/media.py`, `settings.py`)
   - Broadcast `{"event": "media_added", "data": {...}}` after upload
   - Broadcast `{"event": "media_deleted", "data": {"id": ...}}` after delete
   - Broadcast `{"event": "settings_changed", "data": {...}}` after settings update

7. **Test fixtures** (`backend/tests/conftest.py`)
   - Test database (in-memory or temp file SQLite)
   - Test client (httpx AsyncClient or TestClient)
   - Temp directories for uploads
   - Sample test images (small JPEG, PNG with EXIF)

8. **Unit tests** (`backend/tests/unit/`)
   - `test_image_service.py` — EXIF rotation, thumbnail generation, dimensions
   - `test_video_service.py` — metadata extraction, thumbnail, transcode
   - `test_models.py` — model creation, defaults
   - `test_schemas.py` — serialization, validation

9. **Integration tests** (`backend/tests/integration/`)
   - `test_media_api.py` — upload photo, upload video, list, get, delete, invalid files
   - `test_settings_api.py` — get defaults, update, partial update
   - `test_websocket.py` — connect, receive broadcast on media/settings changes

10. **Verify & update state**
    - Run `./scripts/test-backend.sh` — all green
    - Update this file, git commit

---

## Phase 3 — Pending: Frontend Management UI + Tests

Implement gallery grid, upload with drag-drop + progress, settings page, all with Apple-like styling. Hook + component tests.

## Phase 4 — Pending: Slideshow + Touch + Live Updates

Fullscreen slideshow with crossfade, video playback, touch gestures (@use-gesture), WebSocket live updates, on-screen settings overlay.

## Phase 5 — Pending: E2E Tests + Docker Polish

Playwright tests (gallery, upload, settings, slideshow, touch, responsive, live-update). Production Docker config with nginx.
