# Photo Frame — Project State

## Current Status: Feature-Complete MVP

All core features implemented and tested. Ready for manual QA and RPi deployment.

## Test Counts

| Suite | Tests | Status |
|-------|-------|--------|
| Backend (pytest) | 43 | All passing |
| Frontend (vitest) | 57 | All passing |
| E2E (playwright) | 57 (3 skipped) | All passing |
| **Total** | **~157** | **Green** |

E2E skips: 3 responsive tests that intentionally skip on wrong viewport (mobile-only / desktop-only).

---

## What's Built

### Backend
- **Media API**: upload (multi-file), list (paginated), get, delete with file cleanup
- **Settings API**: get with auto-create defaults, partial update
- **Video processing**: two-phase upload — fast save + background ffmpeg transcode in thread
- **Smart transcoding**: only non-browser codecs (HEVC, ProRes) get transcoded; H.264/VP8/VP9/AV1 kept as-is
- **Progress tracking**: ffmpeg `-progress pipe:1` parsed in real-time, broadcast via WebSocket
- **Duplicate detection**: SHA-256 content hash, returns existing item if duplicate
- **WebSocket**: real-time events for media_added, media_deleted, media_processing_complete, media_processing_progress, settings_changed
- **File serving**: originals, thumbnails, transcoded videos via FileResponse

### Frontend
- **Gallery**: responsive grid, photo cards with hover delete, processing overlay (iPhone-style circular progress), error state
- **Upload**: drag-and-drop + file picker, progress bar, success state with navigation
- **Settings**: interval slider (3-60s), transition type toggle, instant save
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

### Test Hardening — Slideshow Identity Assertions (2026-02-27)

Added `data-media-id` attribute to foreground `<img>` and `<video>` in the `Slide` component (2 lines of production code) to enable tests to verify _which_ media is displayed, not just _that something_ rendered.

**Unit tests (SlideshowPage.test.tsx):**
- Rewrote 8 weak assertions that used `toBeGreaterThan(0)` to verify specific media IDs
- Added 5 new tests targeting 3 bug classes: empty→first-photo index error, add-during-playback flash, delete-current-photo index calculation
- Added `getCurrentMediaId()` and `collectAllMediaIds()` helpers scoped to the z-10 current slide layer

**E2E tests (slideshow.spec.ts):**
- Strengthened 3 existing tests (blur background, video wait, delete video) with media identity verification
- Added 2 new critical tests: first-photo-to-empty-slideshow and add-during-video-playback
- Added `currentSlideMediaId()` helper

---

## Known Limitations / Future Work

- **No user auth** — single-user photo frame, no login needed
- **No image editing** — crop, rotate, filters not implemented
- **1000 media limit** — slideshow fetches all media in one call; pagination needed at scale
- **No HEIC photo support** — backend allows .heic extension but Pillow needs pillow-heif plugin
- **RPi 3B performance** — blur(30px) effect may be heavy on old ARM GPU; consider reducing or disabling
- **No offline mode** — requires network connection to backend
