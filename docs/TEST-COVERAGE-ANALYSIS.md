# Test Coverage Analysis — 2026-03-08

## Current State

| Layer | Tests | Status |
|-------|-------|--------|
| Backend (pytest) | 145 | Good baseline, gaps in failure paths |
| Frontend (vitest) | 148 | Major gaps — 2 source files completely untested |
| E2E (playwright) | 99 | Strong happy paths, almost no API failure interception |
| **Total** | **392** | |

---

## Critical Gaps (Priority 1)

### 1. UploadPage has zero frontend tests

`frontend/src/pages/UploadPage.tsx` (162 lines) has no test file. Upload progress, error states, drag-drop, file validation — all untested.

**CLAUDE.md violation:** "Corrupt/malformed input tests for file uploads. Test: zero-byte files, random bytes with valid extensions, files with wrong extensions, oversized files."

**Proposed tests:**
- Upload success with progress indicator
- Upload API returns 400 (invalid file) → error banner visible
- Upload API returns 500 → error banner visible
- Upload API timeout → error feedback
- Drag-and-drop zone interaction
- "Upload more" button resets form state
- Multiple file upload with mixed success/failure

### 2. API failure interception in E2E is almost nonexistent

**CLAUDE.md requirement:** "For every user action that calls the backend, write at least one Playwright test that intercepts the API with a 500 response and asserts an error message is visible."

Only 2 out of 99 E2E tests use `page.route()` to intercept failures.

**Missing failure interception tests for:**
- `POST /api/media` (upload) → 400/500 → error banner
- `PUT /api/settings` → 500 → error feedback
- `DELETE /api/media/{id}` → 500 → modal stays open with error
- `DELETE /api/media/bulk` → 500 → selection mode preserved with error
- `POST /api/media/slideshow/jump` → 500 → error in modal

### 3. SettingsPage has only 2 frontend unit tests

No debounce verification, no boundary value tests, no error handling tests.

**CLAUDE.md violation:** "Debounce tests for rapid-fire UI. If a control can fire many events in quick succession, test that the number of API requests is bounded."

**Proposed tests:**
- Rapid slider changes → verify single API call (debounce)
- Slider at min/max bounds (3 and 60)
- Settings PUT returns 500 → error feedback visible
- Transition type change → API called with correct value
- Settings page loads with existing values from API

### 4. Blur backfill startup code untested

`main.py:_backfill_blur_images()` runs on every app startup but has zero tests. Could fail silently with corrupt media records or missing files.

**Proposed tests:**
- Backfill creates blur for media missing blur_filename
- Backfill skips media that already has blur
- Backfill handles missing original file gracefully (skip, don't crash)
- Backfill handles corrupt image gracefully (skip, log, continue)

---

## High Priority Gaps (Priority 2)

### 5. Backend test gaps

| Gap | Module | Proposed Test |
|-----|--------|---------------|
| No direct unit test for `transcode_to_h264()` | `services/video.py` | Test with valid input, corrupt input, output file creation |
| No pagination boundary tests | `routers/media.py` | page=0, per_page=0, negative values |
| No bulk delete max constraint test | `schemas.py` | 101 IDs should fail (max_length=100) |
| No WebM/MOV video format tests | `services/video.py` | Upload and process allowed but untested formats |
| No BMP/WebP image format tests | `services/image.py` | Upload and process allowed but untested formats |
| EXIF orientations 1-5, 7-8 untested | `services/image.py` | Only orientation 6 is tested |
| No concurrent upload race condition test | `routers/media.py` | Same file uploaded simultaneously |
| No disk-full scenario tests | `services/image.py`, `video.py` | Write fails mid-processing |

### 6. Frontend error path tests (only 5 of 148 tests cover API errors)

| Hook/Component | Missing Tests |
|----------------|---------------|
| `usePhotos` | WS processing events, error recovery, refetch after WS |
| `useSettings` | Debounce behavior, rapid updates, update failure recovery |
| `GalleryPage` | Bulk delete API failure → selection preserved |
| `MediaDetailModal` | Delete API failure → modal stays open |
| `App.tsx` | No tests at all (routing) |

### 7. E2E security tests

Backend has security tests in `test_security_and_validation.py`, but E2E has none:
- Path traversal against `/uploads/` endpoints (`../../../etc/passwd`)
- Null bytes in filenames
- Integer overflow for media IDs (beyond SQLite int64)

### 8. Concurrent operation tests (backend)

- Same file uploaded simultaneously → race condition on hash check
- Simultaneous settings updates → last-write-wins behavior
- Display scaling interrupted by media deletion → orphaned files

---

## Medium Priority Gaps (Priority 3)

### 9. WebSocket edge cases

- Unknown event type sent from server → frontend should ignore gracefully
- Event with missing `type` or `payload` field
- Broadcast failures with multiple connected clients
- WS disconnect/reconnect behavior in components (not just hook)
- Binary frame reception (code expects text)

### 10. Schema/model layer

- Type coercion: `{"media_id": "1"}` — Pydantic may silently accept strings
- Extra fields in request body — should be rejected or ignored
- Unique constraint violation at model level (duplicate filename, content_hash)
- NULL insertion for non-nullable DB fields

### 11. Video service gaps

- Videos with no audio track
- Duration edge cases (0 duration, very long videos)
- Progress callback exception handling
- Fractional frame rates (23.976)

### 12. Frontend animation/state

- Animation timeout safety (what if `animationend` never fires?)
- Multiple rapid deletes during active animation
- Focus trap and focus restoration in modals

---

## Test Quality Issues

| Issue | Location | Recommendation |
|-------|----------|----------------|
| Existence check instead of identity | `GalleryPage.test.tsx` uses `.length > 0` | Assert specific element counts/IDs |
| Low-fidelity fetch mocks | Frontend test mocks | Add response headers, timeout simulation |
| No race condition tests in frontend | Hooks | Test delete + WS add arriving simultaneously |
| qa-breaker tests may not all pass | `e2e/tests/qa-breaker.spec.ts` | Audit which are passing vs still-failing |

---

## CLAUDE.md Compliance

| Rule | Backend | Frontend | E2E |
|------|---------|----------|-----|
| Failure paths before happy paths | Adequate | **Weak** (5 tests) | **Weak** (2 tests) |
| Corrupt/malformed input tests | Good | **Missing** | **Missing** |
| Frontend error handling tests | N/A | **Weak** | **Missing** |
| Debounce tests | N/A | **Missing** | **Missing** |
| API-bypass tests | Good | N/A | **Missing** |
| Security tests (traversal, null bytes) | Good | N/A | **Missing** |
| Integer overflow tests | Good | N/A | **Missing** |
| Background thread cleanup | Partial | N/A | **Missing** |

---

## Recommended Action Plan

### Phase 1 — Close critical gaps
1. Create `UploadPage.test.tsx` — upload success, progress, API errors (400/500), file validation
2. Expand `SettingsPage.test.tsx` — debounce verification, boundary values, error handling
3. Add E2E API failure interception tests — one per user action (upload, delete, bulk delete, settings, jump)
4. Add backend test for blur backfill startup code

### Phase 2 — Strengthen existing coverage
5. Add `transcode_to_h264()` direct unit tests
6. Add pagination boundary tests (page=0, per_page=0, negative)
7. Add bulk delete max_length=100 constraint test
8. Expand frontend hook tests — error recovery, WS event handling
9. Add E2E security tests — path traversal, null bytes, ID overflow

### Phase 3 — Harden edge cases
10. Add WebM/MOV/BMP/WebP format tests
11. Add EXIF orientation tests (all 8 values)
12. Add WebSocket edge case tests
13. Add concurrent operation tests
14. Add animation timeout safety tests
