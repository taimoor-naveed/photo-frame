# Photo Frame — Project State

## Phase Overview

| Phase | Description                          | Status       |
|-------|--------------------------------------|--------------|
| 1     | Foundation (Docker, scaffolding, DB) | **COMPLETE** |
| 2     | Backend API + WebSocket + Tests      | **COMPLETE** |
| 3     | Frontend Management UI + Tests       | **COMPLETE** |
| 4     | Slideshow + Touch + Live Updates     | **CURRENT**  |
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

## Phase 4 — CURRENT: Slideshow + Touch + Live Updates

### Definition of Done
- [ ] `useWebSocket` hook: auto-connect, auto-reconnect, event dispatch
- [ ] `useGestures` hook: swipe left/right, single tap, long press via @use-gesture/react
- [ ] `SlideshowPage`: fullscreen display, preload next image, CSS crossfade transition, auto-advance timer
- [ ] Video playback: `<video autoplay muted>`, freeze on last frame, same blur background
- [ ] Blur background effect: blurred cover behind contained image/video (CSS only)
- [ ] `SlideshowOverlay`: frosted glass bottom sheet, interval slider, transition/order toggles, pause/play, "Manage Photos" link
- [ ] Touch gestures wired: swipe nav, tap overlay toggle, long-press pause
- [ ] WebSocket wired: live photo list updates (add/delete), settings sync
- [ ] Tests: slideshow logic, gesture handlers, overlay, WebSocket hook
- [ ] `./scripts/test-frontend.sh` passes clean (all 27 existing + new tests)

### Ordered Task List

1. **useWebSocket hook** (`frontend/src/hooks/useWebSocket.ts`)
   - Connect to `ws://host/ws`, auto-reconnect on disconnect
   - Parse JSON messages, expose `lastEvent` or callback pattern
   - Clean disconnect on unmount

2. **useGestures hook** (`frontend/src/hooks/useGestures.ts`)
   - Wrap @use-gesture/react for slideshow: swipe left/right, tap, long press
   - Return bind function for gesture target element

3. **SlideshowPage** — fullscreen rewrite
   - Fetch media list, handle empty state
   - Current slide index, auto-advance timer based on settings
   - CSS crossfade between current and next slide
   - Blur background effect (bg: cover+blur, fg: contain)
   - Photo: `<img>`, Video: `<video autoplay muted>`

4. **SlideshowOverlay** (`frontend/src/components/SlideshowOverlay.tsx`)
   - Frosted glass bottom sheet (backdrop-blur)
   - Controls: interval slider, transition/order toggles, pause/play
   - "Manage Photos" link to gallery
   - Auto-hide after 5s of inactivity

5. **Wire gestures + overlay + WebSocket**
   - Swipe left → next, swipe right → previous
   - Tap → toggle overlay
   - Long press → pause/resume
   - WebSocket media_added/deleted → refresh media list
   - WebSocket settings_changed → update slideshow behavior

6. **Tests for new functionality**
   - useWebSocket hook tests
   - useGestures hook tests
   - SlideshowOverlay component tests
   - Slideshow logic tests (advance, pause, video handling)

7. **Verify & update state**

---

## Phase 5 — Pending: E2E Tests + Docker Polish

Playwright tests (gallery, upload, settings, slideshow, touch, responsive, live-update). Production Docker config with nginx.
