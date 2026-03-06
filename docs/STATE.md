# Photo Frame — Project State

## Current Status: Feature-Complete MVP

All core features implemented and tested. Ready for manual QA and RPi deployment.

## Test Counts

| Suite | Tests | Status |
|-------|-------|--------|
| Backend (pytest) | 142 | All passing |
| Frontend (vitest) | 142 | All passing |
| E2E (playwright) | ~200 (100 tests × 2 viewports, 3 skipped) | Passing |
| **Total** | **~465** | **Green** |

E2E skips: 3 responsive tests that intentionally skip on wrong viewport.

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
- **WebSocket**: real-time events for media_added, media_deleted, media_processing_complete, media_processing_progress, settings_changed, slideshow_jump
- **File serving**: originals, thumbnails, transcoded videos via FileResponse

### Frontend
- **Gallery**: responsive grid, click-to-open detail modal (lightbox), processing overlay (iPhone-style circular progress), error state, multi-select bulk deletion (long-press to select)
- **Media Detail Modal**: full-size photo/video lightbox with metadata (dimensions, file size, duration, upload date), show-in-slideshow (cross-device jump via WS), download, delete with confirmation, keyboard/backdrop dismiss
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
- **CSS blur for slideshow backgrounds** — real-time CSS blur on both photos and videos (experiment branch). Backend still generates pre-rendered blur images but frontend doesn't use them.

---

## Experiment Branch: `experiment/smaller-display-css-blur`

**Not merged to main.** Two changes being tested:

### 1. Display size reduced: 1920 → 1024x600
- `DISPLAY_MAX_SIZE = 1920` replaced with `DISPLAY_MAX_WIDTH = 1024` / `DISPLAY_MAX_HEIGHT = 600`
- Images/videos now fit within a 1024x600 bounding box (matching RPi touchscreen resolution)
- Affects: `config.py`, `image.py`, `video.py`, `media.py` router

### 2. CSS blur instead of pre-rendered blur images
- Slideshow now uses real-time CSS `blur(30px)` for both photos and videos
- Photos: background `<img>` with same src as foreground, CSS blurred
- Videos: background `<video>` element plays in sync, CSS blurred (dynamic blur that moves with the video)
- **Backend still generates blur images** — `blur_filename` is still set on upload, `/uploads/blur/` endpoint still works. Frontend just doesn't use them. If this experiment is reverted, re-importing `blurUrl` in `SlideshowPage.tsx` and restoring the `Slide` component restores pre-rendered blur.
- To fully remove backend blur generation later: delete blur logic from `image.py` and `video.py`, remove `blur_filename` from model/schema, remove `/uploads/blur/` route, drop `BLUR_DIR`/`BLUR_SIZE` from config.

---

## Recent Changes

### Live Modal Updates + Jump Button Fixes (2026-03-06)

Modal now receives live WebSocket updates during video processing — progress animation updates in real-time instead of staying frozen at the state when the modal was opened. Jump-to-slideshow button auto-enables when processing completes while modal is open. Removed sticky focus highlight on jump button.

- **GalleryPage**: `selectedMedia` now syncs with `photos` array (not just cleared on removal)
- **MediaDetailModal**: Added `focus:outline-none` to jump button
- **CLAUDE.md**: Added "update tests before running them" rule
- **Tests**: 3 new (live progress update, processing→ready transition, focus class)

### Processing/Error Media Interactions (2026-03-06)

Allow full user interaction with media in any processing state. Previously, processing/error items blocked click, long press, and selection.

- **PhotoCard**: Removed processing/error guards from `handlePointerDown` and `handleClick`
- **MediaDetailModal**: Processing overlay (circular progress) and error overlay shown instead of video player for non-ready media
- **Jump button**: Disabled with tooltip for processing/error media, enabled for ready
- **Backend**: `POST /api/media/slideshow/jump` rejects non-ready media with 400
- **Tests**: 19 new tests (frontend + backend)

### Blur Background Size Increase (2026-03-06)

Pre-rendered blur backgrounds were 64px — too small, all looked identical (vague color blobs). Increased to 320px with proportionally scaled blur radius (10→30) so each photo has a visually distinct background.

- **Config**: `BLUR_SIZE` 64→320, blur radius 10→30 in both `image.py` and `video.py`
- **Migration**: `scripts/regenerate-blur.py` regenerates blur images for existing media
- **File size impact**: Minimal — 320px blurred JPEGs at quality 60 are still ~10-30KB

### WebSocket Robustness + Kiosk Debugging (2026-03-06)

Slideshow page froze on Pi after using jump feature. Root cause unconfirmed (likely Chromium renderer-level GPU issue), but backend WS had reliability bugs.

- **Backend**: WS handler catches all exceptions (not just `WebSocketDisconnect`), `broadcast()` removes stale connections, `disconnect()` handles double-remove
- **Pi kiosk**: Chromium now launches with `--remote-debugging-port=9222` for future diagnosis

### Jump to Slideshow (2026-03-05)

Cross-device "Show in slideshow" feature. From any device's gallery modal, press the play-circle button to jump all connected slideshows to that media item.

- **Backend**: `POST /api/media/slideshow/jump` — validates media exists, broadcasts `slideshow_jump` WS event. Pydantic `SlideshowJumpRequest` with `media_id: Field(ge=1, le=2**63-1)`.
- **Frontend**: `api.slideshow.jump()` client function, `"slideshow_jump"` WS event type. SlideshowPage handles event via ref pattern (`playlistRef`, `currentIndexRef`, `goToSlideRef`) — finds media in playlist and calls `goToSlide()` for a normal transition with animation.
- **Modal button**: Play-circle icon in MediaDetailModal header, with loading/error state and error banner on failure.
- **Tests**: 5 backend integration tests (valid, 404, 422 edge cases), 4 frontend unit tests (renders, API call, error display, error clear on media change).

### Slideshow Performance Optimization (2026-03-05)

Four universal improvements to eliminate slideshow sluggishness on all clients:

1. **Blur backgrounds**: Pre-blurred JPEGs (320px, radius 30) still generated at upload (`blur_filename` field, `/uploads/blur/` route). However, slideshow now uses real-time CSS `blur(30px)` instead — for videos this gives dynamic blur that moves with the content. Backend blur generation retained for potential future use.
2. **H.264 Main profile + level 4.0**: All ffmpeg encode commands now use `-profile:v main -level 4.0` instead of defaulting to High profile. Main profile is universally supported and hardware-decoded efficiently by RPi VideoCore VI.
3. **Cache headers**: All `/uploads/*` routes now return `Cache-Control: public, max-age=31536000, immutable`. Filenames contain UUIDs so this is safe. Second loop through playlist loads from browser disk cache.
4. **Video preloading**: Next video is preloaded via hidden `<video preload="auto">` element alongside existing photo preloading. Blur images for the next slide are also preloaded. Discarded on manual skip.

Tests: 14 new backend tests, 4 new frontend tests.

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

Slideshow now serves display-optimized media (1024x600 bounding box) instead of full originals, reducing bandwidth for RPi kiosk.

- **Backend config**: `DISPLAY_DIR` (`data/display/`), `DISPLAY_MAX_WIDTH = 1024`, `DISPLAY_MAX_HEIGHT = 600`
- **DB**: `display_filename` column on media table (nullable, idempotent migration)
- **Image processing**: `process_image()` generates display JPEG (Q90, LANCZOS) when `width > 1024 or height > 600`
- **Video processing**: `transcode_to_h264()` now includes scale filter capping at 1024x600. New `scale_video_for_display()` for browser-compatible oversized videos. Background thread pattern matches existing transcode flow.
- **Upload router**: Photos set `display_filename` from `process_image()`. Videos: transcoded ones get `display_filename = transcoded_filename` (already scaled). Browser-compatible oversized videos get background scaling via `_scale_display_in_background()`.
- **Delete handlers**: Clean up display files on single and bulk delete
- **Serve display files**: `GET /uploads/display/{filename}` route
- **Frontend**: `displayUrl(media)` helper — returns display file URL if available, falls back to `originalUrl()`. Slideshow `Slide` component + preloader use `displayUrl()`. Gallery modal keeps `originalUrl()` for full-res viewing.
- **Download button**: Added to `MediaDetailModal` header bar (before delete), downloads original via `<a download>`.

### Deployment Topology

- **Prod containers**: Windows PC (`home@home-pc`), runs `docker-compose.prod.yml` — nginx on port 80, backend on 8000 (internal)
- **Slideshow kiosk**: Raspberry Pi (`pi@photoframe`), 1024x600 touchscreen display
- **Kiosk browser**: Chromium in kiosk mode, launched via labwc autostart (`~/.config/labwc/autostart`), pointing to `http://home-pc/slideshow`
- **Auto-start on boot**: labwc desktop session auto-launches Chromium with `--kiosk --start-fullscreen --enable-features=VaapiVideoDecoder --enable-gpu-rasterization --remote-debugging-port=9222`
- **Remote debugging**: Chromium exposes DevTools on port 9222 — `curl http://localhost:9222/json` from Pi, or `http://photoframe:9222` from network
- **Redeploy process**: (1) Kill Chromium on Pi (`pkill -9 chromium`), (2) run `scripts/deploy.sh` from dev machine (tarball + SCP + rebuild on home-pc), (3) run any migration scripts, (4) reboot Pi (`sudo reboot`) to restart slideshow via labwc autostart

---

---

## Known Limitations / Future Work

- **No user auth** — single-user photo frame, no login needed
- **No image editing** — crop, rotate, filters not implemented
- **1000 media limit** — slideshow fetches all media in one call; pagination needed at scale
- **No offline mode** — requires network connection to backend
