# Photo Frame — Project State

## Phase Overview

| Phase | Description                          | Status       |
|-------|--------------------------------------|--------------|
| 1     | Foundation (Docker, scaffolding, DB) | **COMPLETE** |
| 2     | Backend API + WebSocket + Tests      | **COMPLETE** |
| 3     | Frontend Management UI + Tests       | **COMPLETE** |
| 4     | Slideshow + Touch + Live Updates     | **COMPLETE** |
| 5     | E2E Tests + Docker Polish            | **COMPLETE** |

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

---

## Phase 2 — COMPLETE: Backend API + WebSocket + Tests

**What was done:**
- Image service: EXIF auto-rotate, thumbnail generation (300px), RGB conversion
- Video service: ffprobe metadata, thumbnail at 25%, HEVC→H.264 transcode
- Media router: multi-file upload, paginated list, get by ID, delete with file cleanup
- Settings router: get with auto-create defaults, partial update
- Uploads router: FileResponse-based file serving
- WebSocket events: media_added, media_deleted, settings_changed
- Full test suite: 40 tests (18 unit + 22 integration), all passing

**Decisions:**
- Replaced StaticFiles mounts with FileResponse router for testability
- All services read paths from `app.config` at call time (not import time)
- Added `thumb_filename` and `transcoded_filename` to Media model

---

## Phase 3 — COMPLETE: Frontend Management UI + Tests

**What was done:**
- API client (`api/client.ts`): typed fetch wrapper, `api.media.*` and `api.settings.*` methods, `thumbnailUrl()` / `originalUrl()` helpers
- `usePhotos` hook: fetch, upload, delete with auto-refetch
- `useSettings` hook: fetch, update with "Saved" toast state (auto-clears after 2s)
- `ConfirmDialog` component: frosted glass modal, escape-to-close, focus management
- `PhotoCard` component: thumbnail with 4:3 aspect, video badge, hover overlay with filename + delete button
- `GalleryPage`: responsive grid (2/3/4 cols), loading skeletons, empty state, error state, media count
- `UploadPage`: drag-and-drop zone, file picker, uploading spinner, success state with "Upload more" / "View Gallery"
- `SettingsPage`: interval slider (3-60s), transition type toggle buttons, photo order toggle buttons, instant save
- Apple-like styling throughout: rounded-2xl, shadows, system fonts, smooth transitions
- 27 frontend tests: 3 hook tests (usePhotos, useSettings), 6 ConfirmDialog, 5 PhotoCard, 3 Navbar, 4 GalleryPage, 3 SettingsPage
- TypeScript compiles clean with `vitest/globals` types

**Test breakdown:**
- `usePhotos.test.ts` (3) — fetch on mount, error handling, delete + refetch
- `useSettings.test.ts` (3) — fetch on mount, update + saved flag, error handling
- `ConfirmDialog.test.tsx` (6) — closed state, open rendering, confirm click, cancel click, escape key, custom label
- `PhotoCard.test.tsx` (5) — thumbnail render, video badge, no badge for photos, delete flow, cancel flow
- `Navbar.test.tsx` (3) — title, links, mobile menu toggle
- `GalleryPage.test.tsx` (4) — loading skeletons, empty state, photo grid, error state
- `SettingsPage.test.tsx` (3) — loading state, controls rendering, update on click

**Verified:** `docker compose exec frontend npm test` → 27 passed, `npx tsc --noEmit` → clean

**Decisions:**
- Added `"types": ["vitest/globals"]` to tsconfig.json so tsc recognizes test globals
- Settings updates are instant (no save button) — each control change fires API call immediately
- Upload page shows success state with navigation options after upload completes

---

## Phase 4 — COMPLETE: Slideshow + Touch + Live Updates

**What was done:**
- `useWebSocket` hook: auto-connect to `ws://host/ws`, auto-reconnect (2s delay), JSON event parsing, callback pattern via `onEvent`, clean disconnect on unmount
- `useGestures` hook: wraps `@use-gesture/react` `useDrag` for swipe left/right, tap detection via `filterTaps`, long press via manual timer (500ms) — `useLongPress` not available in `@use-gesture/react`
- `SlideshowPage` fullscreen rewrite:
  - Fetches media list + settings via `Promise.all`, loading spinner, empty state with upload link
  - Playlist ordering: random (Fisher-Yates shuffle), sequential, newest
  - Auto-advance timer based on `slideshow_interval` setting, pauses when `paused` state
  - CSS crossfade/slide transitions between current and previous slide
  - Blur background effect: `object-cover` + `blur(30px)` + `brightness(0.7)` + `scale(1.2)` background, `object-contain` foreground
  - Photo: `<img>`, Video: `<video autoplay muted>` (freezes on last frame naturally)
  - Preloads next image for smooth transitions
  - Keyboard support: ArrowLeft/Right, Space (pause), Escape (close overlay)
- `SlideshowOverlay` component: frosted glass bottom sheet (`bg-black/60 backdrop-blur-xl`), interval slider, transition/order toggle buttons, pause/play with SVG icons, "Manage Photos" link, auto-hide after 5s
- Touch gestures wired: swipe left → next, swipe right → prev, tap → toggle overlay, long press → pause/resume
- WebSocket wired: `media_added`/`media_deleted` → refetch media list, `settings_changed` → update slideshow settings in real-time
- 17 new tests (44 total): 4 useWebSocket, 3 useGestures, 6 SlideshowOverlay, 4 SlideshowPage

**Test breakdown (new):**
- `useWebSocket.test.ts` (4) — connect on mount, onEvent callback, auto-reconnect, cleanup on unmount
- `useGestures.test.ts` (3) — returns bind/cleanup functions, bind returns handler props, works with no callbacks
- `SlideshowOverlay.test.tsx` (6) — renders controls, Play/Pause toggle, onTogglePause, transition update, order update, hidden state
- `SlideshowPage.test.tsx` (4) — loading spinner, empty state, renders first photo, pause indicator on space key

**Verified:** `docker compose exec frontend npm test` → 44 passed, `npx tsc --noEmit` → clean

**Decisions:**
- `useLongPress` not exported from `@use-gesture/react` — implemented long press via `setTimeout` within `useDrag` handler
- WebSocket mock tests use `vi.stubGlobal("WebSocket", MockWS)` in `beforeEach` + `act(async => renderHook)` pattern for proper effect flushing
- SlideshowPage fetches all media (up to 1000) in one call for playlist — no pagination needed for slideshow
- Overlay auto-hide timer resets on settings changes (user interaction keeps it visible)

---

## Phase 5 — COMPLETE: E2E Tests + Docker Polish

**What was done:**
- Playwright config: Chromium, desktop (Desktop Chrome) + mobile (Pixel 5) viewports, serial execution
- E2E Dockerfile: `mcr.microsoft.com/playwright:v1.49.0-noble`, pinned to exact version match
- E2E fixtures (`base.ts`): API helpers (delete all media, reset settings, upload, get media/settings), programmatic PNG generation (valid 2x2 red PNG with IHDR/IDAT/IEND chunks + CRC32), `cleanState` auto-fixture cleans DB before each test
- E2E service added to `docker-compose.yml` with `profiles: ["test"]`, depends on frontend
- 6 E2E test suites (42 tests total, 39 pass, 3 appropriately skipped):
  - `gallery.spec.ts` (4): empty state, upload link nav, upload via file picker, delete with confirm dialog
  - `upload.spec.ts` (3): page renders, upload via file picker, upload more resets form
  - `settings.spec.ts` (4): renders controls, change transition, change order, persist across reload
  - `slideshow.spec.ts` (4): empty state redirect, blur background effect, space key pause toggle, click overlay toggle
  - `responsive.spec.ts` (4): hamburger on mobile, nav links on desktop, mobile menu navigation, viewport loads
  - `live-update.spec.ts` (2): gallery refresh after API upload, settings sync via WebSocket overlay
- Production Docker config:
  - `docker-compose.prod.yml`: backend (2 uvicorn workers, no reload) + frontend (nginx on port 80)
  - `backend/Dockerfile.prod`: production uvicorn with 2 workers
  - `frontend/Dockerfile.prod`: multi-stage build (Node → nginx:alpine)
  - `frontend/nginx.conf`: proxies /api/, /uploads/, /ws to backend, SPA fallback, static asset caching
- Updated test scripts: `test-e2e.sh` uses `--profile test`, `test-all.sh` runs E2E → backend → frontend in fail-early order
- Added `data-testid="photo-card"` to PhotoCard for E2E targeting
- Added `allowedHosts: true` to Vite config for cross-container E2E access

**Test breakdown:**
- `gallery.spec.ts` (4) — empty state message, upload link navigation, upload via file picker shows in gallery, delete with hover + confirm dialog
- `upload.spec.ts` (3) — page heading + button render, upload shows success, upload more resets
- `settings.spec.ts` (4) — slider + toggles render, transition type change persists, order change persists, settings survive page reload
- `slideshow.spec.ts` (4) — redirects when empty, blur bg layers present, space pauses/resumes, click toggles overlay
- `responsive.spec.ts` (4) — mobile hamburger visible, desktop nav links visible, mobile menu opens + navigates, gallery loads at viewport
- `live-update.spec.ts` (2) — API upload reflected after refresh, settings API change reflected in overlay

**Verified:** `docker compose --profile test run --rm e2e npx playwright test` → 39 passed, 3 skipped (mobile/desktop exclusions)

**Decisions:**
- Playwright pinned to exact `1.49.0` — must match Docker image version, npm caret range resolved to incompatible 1.58.2
- E2E API helpers call backend directly (`http://backend:8000`) — Vite proxy only works for browser requests
- Test PNG generated programmatically (proper chunks + CRC32) — minimal hand-crafted JPEG was too incomplete for Pillow
- Vite 6 requires `allowedHosts: true` for cross-container requests (returns 403 otherwise)

---

## All Phases Complete

**Total test counts:**
- Backend: 40 tests (18 unit + 22 integration)
- Frontend: 44 unit tests
- E2E: 42 tests (39 pass, 3 skipped for viewport-specific tests)
- **Grand total: 126 tests**
