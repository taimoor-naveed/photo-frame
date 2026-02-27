# Photo Frame — Project State

## Phase Overview

| Phase | Description                          | Status       |
|-------|--------------------------------------|--------------|
| 1     | Foundation (Docker, scaffolding, DB) | **COMPLETE** |
| 2     | Backend API + WebSocket + Tests      | **COMPLETE** |
| 3     | Frontend Management UI + Tests       | **COMPLETE** |
| 4     | Slideshow + Touch + Live Updates     | **COMPLETE** |
| 5     | E2E Tests + Docker Polish            | **CURRENT**  |

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

## Phase 5 — CURRENT: E2E Tests + Docker Polish

### Definition of Done
- [ ] Playwright config: Chromium, desktop + mobile viewports
- [ ] Test fixtures: page objects, test images, API helpers
- [ ] E2E: gallery CRUD flow
- [ ] E2E: upload flows (drag-drop, multi-file, invalid files)
- [ ] E2E: settings modification + persistence
- [ ] E2E: slideshow display + transitions
- [ ] E2E: touch gestures (swipe, tap overlay, long-press)
- [ ] E2E: responsive layout (mobile vs desktop)
- [ ] E2E: live update (add photo while slideshow runs)
- [ ] Docker prod mode: nginx for frontend, optimized builds
- [ ] `./scripts/test-all.sh` passes clean
