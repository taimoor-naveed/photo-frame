# Photo Frame — Project State

## Current Status: Feature-Complete MVP

All core features implemented and tested. Ready for manual QA and RPi deployment.

## Test Counts

| Suite | Tests | Status |
|-------|-------|--------|
| Backend (pytest) | 123 | All passing |
| Frontend (vitest) | 115 | All passing |
| E2E (playwright) | 195 passed, 2 flaky (3 skipped) | Passing |
| **Total** | **~411** | **Green** |

E2E skips: 3 responsive tests that intentionally skip on wrong viewport.
E2E flaky: 2 video tests (H.264 doesn't play in headless Chromium — known issue).

---

## What's Built

### Backend
- **Media API**: upload (multi-file), list (paginated), get, delete, bulk delete with file cleanup
- **Settings API**: get with auto-create defaults, partial update
- **Video processing**: two-phase upload — fast save + background ffmpeg transcode in thread
- **HEIC support**: `pillow-heif` plugin registers HEIC/HEIF format, converts to JPEG on upload
- **Smart transcoding**: only non-browser codecs (HEVC, ProRes) get transcoded; H.264/VP8/VP9/AV1 kept as-is
- **Progress tracking**: ffmpeg `-progress pipe:1` parsed in real-time, broadcast via WebSocket
- **Duplicate detection**: SHA-256 content hash, returns existing item if duplicate
- **WebSocket**: real-time events for media_added, media_deleted, media_processing_complete, media_processing_progress, settings_changed
- **File serving**: originals, thumbnails, transcoded videos via FileResponse

### Frontend
- **Gallery**: responsive grid, click-to-open detail modal (lightbox), processing overlay (iPhone-style circular progress), error state, multi-select bulk deletion (long-press to select)
- **Media Detail Modal**: full-size photo/video lightbox with metadata (dimensions, file size, duration, upload date), delete with confirmation, keyboard/backdrop dismiss
- **Upload**: drag-and-drop + file picker, progress bar, success state with navigation
- **Settings**: interval slider (3-60s), transition type segmented control, instant save
- **Slideshow**: fullscreen with blur background effect, crossfade/slide/none transitions, auto-advance timer
- **Navigation**: tap right/left halves, arrow keys, long press for overlay, space to pause, escape to close overlay
- **Video**: autoplay muted, waits for long videos to finish, shows first frame when ended with interval remaining
- **Live updates**: WebSocket-driven — add/delete/process events update gallery and slideshow in real-time without flash
- **Playlist state**: combined `{playlist, currentIndex}` state object for atomic updates (prevents flash on add/delete)

### Infrastructure
- Docker Compose: backend + frontend + e2e (test profile)
- Production config: `docker-compose.prod.yml` with nginx frontend, multi-worker uvicorn
- Test scripts: `test-all.sh` (fail-early: frontend → backend unit → backend integration → e2e)

---

## Architecture Decisions

- **Sync SQLAlchemy** — no async overhead for 2-3 concurrent users
- **Background thread for ffmpeg** — upload returns immediately, transcode happens async
- **Combined slide state** — `{playlist, currentIndex}` in single useState to prevent flash when playlist changes
- **Tap zones over swipe gestures** — simpler, more reliable on touch screens
- **VP8/WebM for E2E video tests** — H.264 doesn't play in headless Chromium (Playwright Docker)
- **Thumbnail for video blur background** — uses `<img>` instead of second `<video>` to halve resource usage

---

## Recent Changes

### HEIC Photo Support (2026-03-04)

Added real HEIC/HEIF photo support for iPhone uploads:

- **Dependency**: `pillow-heif==0.21.0` + `libheif-dev` system library in Docker
- **Backend**: `pillow_heif.register_heif_opener()` in `image.py` — Pillow natively opens HEIC files, existing `.heic` → `.jpg` conversion and RGB mode handling do the rest
- **Tests**: 10 new tests (5 unit, 5 integration) — failure paths first (corrupt, empty, truncated HEIC), then happy paths (real HEIC processing, RGBA conversion, duplicate detection, no orphaned files). Fixed false-positive test that passed JPEG bytes with `.heic` filename.

### UI Redesign — "Gallery After Dark" (2026-03-04)

Complete frontend overhaul with dark editorial theme:

- **Design system**: warm navy (#303548) background, copper (#D4956A) accent, DM Serif Display + Karla typography, ambient gradient mesh + film grain overlay
- **Slideshow overlay redesign**: removed "Manage Photos" link, new bottom sheet with drag handle, large centered play/pause button (56px copper circle), debounced interval slider, iOS-style segmented control for transitions
- **Slideshow bug fixes**: overlay auto-hide timer now resets on WS settings changes, video pauses when slideshow is paused, slider debounced (400ms)
- **Component styling**: frosted glass navbar, floating photo cards with warm shadows, copper accents throughout
- **Test updates**: all 9 test files updated for new UI text ("Your gallery awaits", "Drop your memories here"), overlay uses `data-testid="slideshow-overlay"`, removed duplicate "no photo order" e2e test

### QA Breaker Bug Fixes (2026-03-02)

Adversarial QA testing found 5 bugs that the full test suite missed. All fixed:

1. **BUG-1: Settings validation bypass** — `SettingsUpdate` schema now enforces `slideshow_interval: Field(ge=3, le=3600)` and `transition_type: Literal["crossfade", "slide", "none"]`. Backend rejects 0, -1, 999999, "explode", "".
2. **BUG-2: Corrupt file upload → 500** — `process_image()` and `save_video_original()` now catch Pillow/ffprobe errors, return 400. Empty file check in Phase 0. Orphaned files cleaned up on failure.
3. **BUG-3: Silent delete failures** — `deletePhoto()` and `bulkDeletePhotos()` now have try/catch. Modal stays open on delete failure. Error banners shown in gallery and modal. Selection mode preserved on bulk delete failure.
4. **BUG-4: Settings slider spam** — Added 400ms debounce with local state on interval slider. Dragging fires 1-3 API requests instead of 28.
5. **BUG-5: Path traversal** — `_serve_file()` now validates `path.resolve().is_relative_to(directory.resolve())` before serving.

Documentation updated: CLAUDE.md test rules now include "Never swallow errors silently" and "Backend must reject, not just frontend" sections. Lessons learned table added.

### Multi-Select Bulk Deletion (2026-03-02)

Added long-press-to-select pattern for bulk deleting photos/videos from the gallery.

- **Backend**: `DELETE /api/media/bulk` endpoint — accepts `{ids: []}`, returns `{deleted: [], not_found: []}`. Lenient design: partial success if some IDs already gone. Broadcasts individual `media_deleted` WS events per item.
- **Frontend — PhotoCard**: Long-press detection (500ms timer via `onPointerDown`/`onPointerUp`), selection mode visuals (blue ring + checkmark circle), conditional click behavior (toggle select vs open modal).
- **Frontend — SelectionActionBar**: New floating bottom bar with frosted glass style matching navbar. Cancel, count display, "Select all" / "Deselect all" link, red Delete button with confirmation dialog.
- **Frontend — GalleryPage**: Selection state management (`selectionMode` + `selectedIds` Set), Escape key exits, stale ID pruning on WS deletions, auto-exit when gallery empties.
- **Tests**: 8 backend integration, 10 PhotoCard unit, 9 SelectionActionBar unit, 7 GalleryPage unit, 12 E2E (6 scenarios × desktop + mobile)

### Media Detail Modal (2026-02-28)

Added lightbox modal for gallery — click any thumbnail to view full-size photo/video with metadata.

- **New component**: `MediaDetailModal.tsx` — backdrop blur, header with filename + delete/close, full-size media display, metadata bar (dimensions, file size, duration, upload date)
- **PhotoCard simplified**: removed hover overlay (filename + delete button); clicking now opens the modal directly. Delete only available from modal.
- **GalleryPage**: `selectedMedia` state wired to PhotoCard `onClick` and modal. Auto-clears selection when media is deleted via WebSocket.
- **Tests**: 13 unit tests for modal, 5 PhotoCard tests, 6 GalleryPage tests, 5 E2E tests (×2 viewports)

### Auto-Advance Timer Fix (2026-02-27)

Fixed slideshow timer never firing or resetting endlessly:
- **Root cause 1**: `goNext` function reference in timer effect deps caused 1000+ timer resets per page load — replaced with stable `goNextRef` and primitive deps
- **Root cause 2**: With 1-item playlist, timer fired but `currentMedia?.id` didn't change, so no new timer was scheduled — added `playlist.length` to deps so timer restarts when photos are added
- Timer now fires exactly once per interval, and restarts correctly when playlist grows

### Test Hardening — Slideshow Identity Assertions (2026-02-27)

Added `data-media-id` attribute to foreground `<img>` and `<video>` in the `Slide` component to enable tests to verify _which_ media is displayed, not just _that something_ rendered.

**Unit tests (SlideshowPage.test.tsx):**
- Rewrote 8 weak assertions that used `toBeGreaterThan(0)` to verify specific media IDs
- Added 5 new tests targeting 3 bug classes: empty→first-photo index error, add-during-playback flash, delete-current-photo index calculation
- Added `getCurrentMediaId()` and `collectAllMediaIds()` helpers scoped to the z-10 current slide layer

**E2E tests (slideshow.spec.ts):**
- Strengthened 3 existing tests (blur background, video wait, delete video) with media identity verification
- Added 2 new critical tests: first-photo-to-empty-slideshow and add-during-video-playback
- Added `currentSlideMediaId()` helper

### Display-Optimized Media + Download Button (2026-03-04)

Slideshow now serves display-optimized media (1920px max) instead of full originals, reducing bandwidth for RPi kiosk.

- **Backend config**: `DISPLAY_DIR` (`data/display/`), `DISPLAY_MAX_SIZE = 1920`
- **DB**: `display_filename` column on media table (nullable, idempotent migration)
- **Image processing**: `process_image()` generates display JPEG (Q90, LANCZOS) when `max(w,h) > 1920`
- **Video processing**: `transcode_to_h264()` now includes scale filter capping at 1920px. New `scale_video_for_display()` for browser-compatible oversized videos. Background thread pattern matches existing transcode flow.
- **Upload router**: Photos set `display_filename` from `process_image()`. Videos: transcoded ones get `display_filename = transcoded_filename` (already scaled). Browser-compatible oversized videos get background scaling via `_scale_display_in_background()`.
- **Delete handlers**: Clean up display files on single and bulk delete
- **Serve display files**: `GET /uploads/display/{filename}` route
- **Frontend**: `displayUrl(media)` helper — returns display file URL if available, falls back to `originalUrl()`. Slideshow `Slide` component + preloader use `displayUrl()`. Gallery modal keeps `originalUrl()` for full-res viewing.
- **Download button**: Added to `MediaDetailModal` header bar (before delete), downloads original via `<a download>`.

### Deployment Topology

- **Prod containers**: Windows PC (`home@home-pc`), runs `docker-compose.prod.yml` — nginx on port 80, backend on 8000 (internal)
- **Slideshow kiosk**: Raspberry Pi (`pi@photoframe`), 1024x600 touchscreen display
- **Kiosk browser**: Chromium in kiosk mode, launched via labwc autostart (`~/.config/labwc/autostart`), pointing to `http://home-pc/slideshow`
- **Auto-start on boot**: labwc desktop session auto-launches Chromium with `--kiosk --start-fullscreen --enable-features=VaapiVideoDecoder --enable-gpu-rasterization`
- **Redeploy process**: Create tarball on dev machine (no git on home-pc), SCP to `home@home-pc`, extract over `C:\Users\Home\photo-frame`, run `docker compose -f docker-compose.prod.yml up --build -d`, then reboot Pi

---

## Next Up

### 1. Create deploy playbook for fresh RPi
Write an Ansible playbook from scratch to provision a fresh Raspberry Pi 4. Should install Docker, copy project files, build and start containers, health check, and set up Chromium kiosk mode for slideshow auto-launch. Rewrite the `deploy/` directory after environment consolidation is done.

---

## Known Limitations / Future Work

- **No user auth** — single-user photo frame, no login needed
- **No image editing** — crop, rotate, filters not implemented
- **1000 media limit** — slideshow fetches all media in one call; pagination needed at scale
- **No offline mode** — requires network connection to backend
