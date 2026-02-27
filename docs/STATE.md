# Photo Frame — Project State

## Phase Overview

| Phase | Description                          | Status       |
|-------|--------------------------------------|--------------|
| 1     | Foundation (Docker, scaffolding, DB) | **COMPLETE** |
| 2     | Backend API + WebSocket + Tests      | **COMPLETE** |
| 3     | Frontend Management UI + Tests       | **CURRENT**  |
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

**Decisions:**
- Sync SQLAlchemy (not async) — sufficient for 2-3 users
- No package-lock.json committed — generated in container at build
- Test scripts use `docker compose exec` (requires running containers)

---

## Phase 2 — COMPLETE: Backend API + WebSocket + Tests

**What was done:**
- Image service: EXIF auto-rotate (ImageOps.exif_transpose), thumbnail generation (300px max), RGB conversion
- Video service: ffprobe metadata, thumbnail at 25% duration, HEVC→H.264 transcode detection
- Media router: multi-file upload (POST), paginated list (GET), get by ID, delete with file cleanup
- Settings router: get with auto-create defaults, partial update (PUT)
- Uploads router: FileResponse-based file serving for originals/thumbnails/transcoded
- WebSocket events: media_added, media_deleted, settings_changed broadcast on mutations
- Full test suite: 40 tests (18 unit + 22 integration), all passing

**Test breakdown:**
- `tests/unit/test_image_service.py` (5) — basic processing, thumbnail size, EXIF rotation, PNG, HEIC
- `tests/unit/test_video_service.py` (5) — metadata, invalid file, thumbnail, transcode check, full processing
- `tests/unit/test_models.py` (3) — media creation, video fields, settings defaults
- `tests/unit/test_schemas.py` (5) — serialization, video fields, settings, partial update, empty update
- `tests/integration/test_media_api.py` (14) — upload photo/png/video, multi-file, invalid, list, pagination, get, 404, delete, file serving
- `tests/integration/test_settings_api.py` (4) — defaults, full update, partial update, persistence
- `tests/integration/test_websocket.py` (4) — connect, media_added, media_deleted, settings_changed

**Verified:** `docker compose exec backend pytest tests/ -v` → 40 passed in 1.53s

**Decisions:**
- Replaced StaticFiles mounts with FileResponse router (`uploads.py`) for testability
- All services/routers read paths from `app.config` at call time (not import time) — enables monkeypatch in tests
- Added `thumb_filename` and `transcoded_filename` columns to Media model (not in original plan but needed to serve/delete files)
- Added `piexif` to dev deps for EXIF rotation tests
- Added `./backend/tests` volume mount to docker-compose.yml for hot-reloading tests

---

## Phase 3 — CURRENT: Frontend Management UI + Tests

### Definition of Done
- [ ] Typed API client (`frontend/src/api/client.ts`) with fetch wrapper
- [ ] `usePhotos` hook: fetch media list, upload, delete (with optimistic updates or refetch)
- [ ] `useSettings` hook: fetch settings, update
- [ ] Navbar: responsive with active route highlighting (already exists — verify)
- [ ] GalleryPage: photo/video grid using thumbnails, PhotoCard component, delete with ConfirmDialog
- [ ] UploadPage: drag-drop + file picker, multi-file, upload progress indicator
- [ ] SettingsPage: interval slider, transition/order dropdowns, save with toast/feedback
- [ ] Apple-like styling: white space, rounded corners, shadows, transitions, frosted glass
- [ ] Hook tests: usePhotos, useSettings (mocked API)
- [ ] Component tests: PhotoCard, ConfirmDialog, pages
- [ ] `./scripts/test-frontend.sh` passes clean

### Ordered Task List

1. **API client** (`frontend/src/api/client.ts`)
   - Typed fetch wrapper: `get<T>`, `post<T>`, `put<T>`, `del`
   - Types matching backend schemas: `Media`, `MediaList`, `Settings`, `SettingsUpdate`

2. **usePhotos hook** (`frontend/src/hooks/usePhotos.ts`)
   - `photos`, `total`, `loading`, `error` state
   - `fetchPhotos(page?)`, `uploadFiles(files)`, `deletePhoto(id)` actions
   - Auto-fetch on mount

3. **useSettings hook** (`frontend/src/hooks/useSettings.ts`)
   - `settings`, `loading`, `error` state
   - `fetchSettings()`, `updateSettings(partial)` actions
   - Auto-fetch on mount

4. **ConfirmDialog component** (`frontend/src/components/ConfirmDialog.tsx`)
   - Modal with frosted glass backdrop
   - Title, message, confirm/cancel buttons
   - Accessible (focus trap, escape to close)

5. **PhotoCard component** (`frontend/src/components/PhotoCard.tsx`)
   - Thumbnail display with rounded corners
   - Media type badge (photo/video)
   - Delete button with ConfirmDialog
   - Filename overlay on hover

6. **GalleryPage** — full implementation
   - Responsive grid of PhotoCards
   - Empty state with upload link (already exists)
   - Loading skeleton
   - Pagination or infinite scroll

7. **UploadPage** — full implementation
   - Drag-and-drop zone
   - File picker button
   - Multi-file support
   - Upload progress per file
   - Success/error feedback

8. **SettingsPage** — full implementation
   - Interval slider (5-60s)
   - Transition type dropdown
   - Photo order dropdown
   - Save button with success toast

9. **Component + hook tests** (`frontend/src/__tests__/`)
   - Hook tests with mocked fetch
   - Component render tests
   - User interaction tests (click, type, drag)

10. **Verify & update state**
    - Run `./scripts/test-frontend.sh` — all green
    - Update this file, git commit

---

## Phase 4 — Pending: Slideshow + Touch + Live Updates

Fullscreen slideshow with crossfade, video playback, touch gestures (@use-gesture), WebSocket live updates, on-screen settings overlay.

## Phase 5 — Pending: E2E Tests + Docker Polish

Playwright tests (gallery, upload, settings, slideshow, touch, responsive, live-update). Production Docker config with nginx.
