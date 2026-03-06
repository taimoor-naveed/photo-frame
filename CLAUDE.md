# Photo Frame

Raspberry Pi 4 (4GB RAM) photo frame with web management UI. Touchscreen display, supports photos + videos (motion pictures). Developed on Mac with Docker, deployed to RPi 4 later. Low traffic (2-3 concurrent users, 50 max).

## Stack

Backend: Python 3.12 + FastAPI + SQLite (sync SQLAlchemy) + Pillow + ffmpeg
Frontend: React 19 + TypeScript + Vite 6 + Tailwind CSS 3.4
Real-time: FastAPI WebSocket | Touch: tap zones + long press
Tests: pytest + httpx | Vitest + RTL | Playwright
Deploy: Docker Compose

## Architecture

```
Browser ──→ Vite Dev Server (:5173)
              ├── /api/*     ──proxy──→ FastAPI (:8000)
              ├── /uploads/* ──proxy──→ FastAPI (static files)
              └── /ws        ──proxy──→ FastAPI WebSocket
```

## Repo Map

```
backend/app/       # FastAPI app: main, config, database, models, schemas, websocket
  routers/         # media.py, settings.py
  services/        # image.py (Pillow), video.py (ffmpeg)
backend/tests/     # unit/ + integration/
frontend/src/      # React app: pages, components, hooks, api
scripts/           # test-all.sh, test-backend.sh, test-frontend.sh, test-e2e.sh
docs/              # SPEC.md (contract), STATE.md (progress)
```

## Source of Truth

| What              | Where                        |
|-------------------|------------------------------|
| Spec & contracts  | `docs/SPEC.md`               |
| Progress & state  | `docs/STATE.md`              |
| Runtime config    | `backend/app/config.py`      |
| DB schema         | `backend/app/models.py`      |
| API routes        | `backend/app/routers/*.py`   |
| Migrations        | None — auto-create + idempotent ALTER TABLE in `database.py` |

## Non-Negotiables

- **Branch per feature**: Always create a new git branch before implementing any new feature or change. Branch from `main` with a descriptive name (e.g., `feature/heic-support`, `fix/upload-validation`). Never commit directly to `main`.

- **Docker is the runtime**: Never install app dependencies on the host or use host-installed tools (node, npm, python, pip, etc.) for app tasks. The host environment is irrelevant — different versions can cause false errors. Always use `docker compose exec` or `docker compose run` for package management, lockfile generation, builds, and any command that touches app code or dependencies.

- **No black borders, no cropping**: CSS blur background effect for aspect ratio mismatch
- **"Gallery After Dark" design**: dark editorial theme, frosted glass, min 44px touch targets (see SPEC.md UX section)
- **Photo-first**: UI fades into background, photos are the star
- **Sync SQLAlchemy**: no async overhead for this traffic level
- **Videos auto-play muted**, show first frame when ended with interval remaining
- **No flash on add/delete**: playlist + currentIndex update atomically via combined state object

## Test Rules

### Update tests before running them
- **Every code change requires test updates before tests are run.** After modifying code, first update existing tests that are now stale (assertions that no longer match behavior), then add new tests for the new/changed behavior. Only then run the test suite. Never run tests against stale expectations — fix the tests first.

### Failure paths first, happy paths second
- **Test failure cases before success cases.** Invalid input, corrupt data, network errors, and API failures catch more real bugs than happy paths. Every endpoint and user action must have at least one failure-path test.
- **Backend validation tests are mandatory.** For every API endpoint, test: invalid input types, boundary values (0, -1, empty string, max+1), missing required fields, and malformed payloads. Use direct API calls — never rely solely on frontend constraints (HTML `min`/`max`, dropdown options) to enforce rules.
- **Frontend error handling tests are mandatory.** For every API call in the frontend, test: what happens when the API returns 400, 500, or times out? Mock/intercept the API and verify the user sees feedback. Silent failures are bugs.
- **Corrupt/malformed input tests for file uploads.** Test: zero-byte files, random bytes with valid extensions, files with wrong extensions, oversized files. Verify proper 400 responses (not 500) and no orphaned files on disk.

### Never swallow errors silently
- **Every `await` on an API call MUST have error handling.** No bare `await api.foo()` without try/catch. If the catch block is empty or just logs, that's a bug — the user must see feedback.
- **Optimistic UI is banned for destructive actions.** Don't close modals, exit selection mode, or remove items from UI before the API confirms success. If the API fails, the user sees the item vanish then reappear — or worse, sees nothing at all.
- **Frontend must show errors for every API failure.** Use inline error banners, error props on modals, or toast notifications. "No feedback" on failure = silent data loss = bug.
- **Test API failures in E2E.** For every user action that calls the backend (delete, upload, settings save), write at least one Playwright test that intercepts the API with a 500 response and asserts an error message is visible to the user.

### Backend must reject, not just frontend
- **Backend validation is the source of truth.** Frontend constraints (slider min/max, dropdown options, file type filters) are UX hints. Backend must independently validate all inputs with Pydantic validators, and return 400/422 for invalid data.
- **Pydantic schemas must constrain values.** Use `Field(ge=..., le=...)` for numeric ranges, `Literal[...]` for enum-like strings. Never accept `str` or `int` without bounds when the domain has limits.
- **Wrap external tool calls in try/except.** Pillow `Image.open()`, ffprobe, ffmpeg — any call to an external library/process that handles user data must be wrapped. Unhandled exceptions from corrupt input = 500 = bug.
- **Clean up on failure.** If a file is written to disk before validation fails, delete it. Orphaned files with no DB record waste disk and confuse debugging.

### Test quality standards
- **Assert identity, not existence.** Never write `expect(items.length).toBeGreaterThan(0)`. Always verify *which* item is shown, not just *that something* rendered. Use `data-media-id`, `data-testid`, or specific field values.
- **Cross-boundary integration tests are mandatory.** When adding a backend event or API change, write at least one test that sends a real message from the backend and asserts the frontend receives it with correct field names. TypeScript `as` casts hide mismatches — don't rely on them at system boundaries.
- **Convert spec bullets to test stubs first.** Before building a feature, read the spec, write failing test stubs for each behavior, then implement. This prevents "tests that pass with bugs."
- **E2E for complex stateful UI.** Unit tests with mocked timers and `act()` don't catch re-render cascades or unstable refs. For slideshow-like features, write E2E tests first.
- **API-bypass tests are required.** If the frontend constrains input (slider range, dropdown options), write a test that sends the unconstrained value directly to the API. Frontend constraints are UX — backend validation is security.
- **Debounce tests for rapid-fire UI.** If a control (slider, text input) can fire many events in quick succession, test that the number of API requests is bounded. Unbounced controls waste bandwidth and spam WS broadcasts.
- **Security tests for file serving.** Test path traversal (`../../../etc/passwd`), URL-encoded variants, null bytes (`\x00`), and filenames with special characters against every file-serving endpoint.
- **Null/None tests for every Optional field.** If a Pydantic schema uses `Optional` or `| None`, test explicit `null` in the JSON payload. Pydantic `None` default for "field not sent" still accepts explicit `null` unless validated.
- **Integer overflow tests for IDs.** Test integers beyond SQLite's int64 range (~9.2×10¹⁸) on any endpoint that accepts IDs. Python `int` has no limit but SQLite does.
- **Background thread cleanup tests.** If an operation spawns a background thread (ffmpeg transcode, display scaling), test: what happens when the parent record is deleted before the thread finishes? Assert no orphaned files on disk.

## React Patterns

- **Never put function references in `useEffect` deps.** Use `useRef` for callbacks (the `goNextRef` pattern). Function references are recreated on re-render and cause effect cascades.
- **Atomic state for coupled values.** Values that must update together (e.g. `playlist` + `currentIndex`) go in a single `useState` object. Separate `useState` calls can render independently and cause flash/glitch.
- **Primitive deps over object deps.** Use `settings?.slideshow_interval` (number) instead of `settings` (object) in effect deps. New object references trigger effects even when values haven't changed.
- **No third-party gesture libraries.** Raw `onPointerDown`/`onPointerUp` for tap zones and long press. Libraries add indirection that conflicts with simple interaction models.
- **Design async from day one.** If any operation can take >1s (ffmpeg, large upload, external API), architect it as background + status tracking from the start. Retrofitting async is always a multi-file rework.
- **Never add deps to `handleWsEvent`'s `useCallback`.** Adding deps causes WS reconnects. Use the ref pattern (`goToSlideRef`, `playlistRef`) to access fresh values inside the handler without new deps.
- **CSS `@keyframes` > boolean state flips for animations.** Don't use `requestAnimationFrame` or `setTimeout` to trigger CSS transitions — the browser may not paint the initial state. Use `@keyframes` animations with CSS classes; they're declarative and reliable.
- **Use `key` to force fresh CSS animations.** CSS won't restart an animation already on a DOM element. Use React `key={media.id}` to force a new element on content change, guaranteeing a fresh animation start.

## Known Gotchas

- **Router prefix**: `media.router` has `prefix="/api/media"` — new endpoints there become `/api/media/...`, not `/api/...`. Plan URLs accordingly.
- **No DB record fixtures**: `conftest.py` has `sample_jpeg`/`sample_video` (raw bytes) but no `sample_photo` (DB record). Upload via API in tests to create records.
- **Playwright `toBeVisible()` vs `toBeInViewport()`**: CSS `translate-y-full` hides elements off-screen but they're still "visible" to Playwright. Use `not.toBeInViewport()` for overlay hide assertions.
- **H.264 in headless Chromium**: Does not play. Use VP8/WebM (`ffmpeg -c:v libvpx`) for test videos.
- **WebSocket event format**: Backend sends `{"type": ..., "payload": ...}` to match frontend `WsEvent` interface. Any mismatch is silent (TypeScript `as` cast swallows it).
- **File input clearing**: Some browsers invalidate `File` objects when `input.value = ""` — copy files to array first.
- **StrictMode double-fetch**: React 19 StrictMode double-invokes effects, causing duplicate fetches. Use refs (e.g. `initialBuildDone`) to guard one-time operations.
- **Hooks before early returns**: Never place `useEffect` after `if (loading) return` or `if (!data) return`. React requires hooks in the same order every render — conditional early returns that skip hooks cause a crash.
- **Scripts not in container**: `scripts/` is at repo root, not inside `backend/`. To run a script in prod: `cat script.py | ssh home@home-pc "... docker compose exec -T backend python -"` (pipe via stdin).
- **Deploy is clean-slate**: `deploy.sh` uses `docker compose down -v`, backs up originals, rebuilds from scratch, then re-uploads originals through the API (so they get reprocessed with new code). The backup is verified and removed on success.
- **Deployment procedure**: Use the `deploy` skill (`.claude/skills/deploy.md`) — it has the full step-by-step procedure including Pi Chromium restart.
- **Use Playwright for frontend debugging**: When debugging visual/animation/state issues, use Playwright automatically via `docker compose --profile test run --rm e2e node -e "..."` to inspect DOM, check computed styles, and verify behavior — don't ask the user to check the browser console.

## Lessons Learned (QA Breaker — 2026-03-02)

Five bugs found by adversarial QA testing that the full test suite missed. Root cause: tests only covered happy paths.

| Bug | Root Cause | Fix | Lesson |
|-----|-----------|-----|--------|
| Settings accepts 0/-1/999999 interval | No Pydantic validators on `SettingsUpdate` | `Field(ge=3, le=3600)` + `Literal["crossfade","slide","none"]` | Frontend constraints are UX. Backend validation is security. |
| Corrupt file upload → 500 | No try/except around `Image.open()` / ffprobe | Wrap in try/except, return 400, clean up orphaned files | Every external tool call on user data needs error handling. |
| Delete errors silently swallowed | No try/catch on `deletePhoto()` / `bulkDeletePhotos()` | Add try/catch, show error banners, don't close modal on failure | Every `await api.foo()` needs error handling. Silent failure = bug. |
| Slider sends 28 PUT requests | No debounce on `onChange` | Local state + 400ms debounce timer | Rapid-fire inputs need debounce before API calls. |
| Path traversal (latent) | No `is_relative_to()` check in `_serve_file()` | `path.resolve().is_relative_to(directory.resolve())` | Defense in depth — validate even if the framework protects you. |

**Key takeaway:** A test suite with only happy-path tests gives false confidence. The five bugs above were each one curl/fetch command away from discovery, but 229 existing tests missed all of them.

## Lessons Learned (Slideshow Freeze — 2026-03-06)

Pi kiosk slideshow page froze completely after using the "Show in slideshow" jump feature. Page stayed visible but was entirely unresponsive — no auto-advance, no touch, no WS events received. Backend was healthy (gallery worked on phone simultaneously). Chromium process was alive but renderer was frozen.

**Root cause: unconfirmed** — no browser console logs were available. Most likely Chromium renderer-level freeze (GPU issues on RPi 4 — earlier logs showed repeated GPU process crashes). The WS handler also had bugs that could accumulate stale connections.

**What was fixed:**
- Backend WS handler now catches all exceptions (not just `WebSocketDisconnect`) via `finally` block
- `broadcast()` removes stale connections instead of silently ignoring send errors
- `disconnect()` handles double-remove safely
- Chromium on Pi now launches with `--remote-debugging-port=9222` so next time console logs are available at `http://localhost:9222`

**If this happens again:** SSH into Pi, run `curl -s http://localhost:9222/json` to check if page is alive, then use Chrome DevTools Protocol to get console logs before killing the browser.

**Additional discovery:** When restarting Chromium from SSH, the process MUST be detached with `nohup`+`disown` or it dies when the SSH session ends (SIGHUP). GPU acceleration works fine when launched by labwc autostart but may crash when launched from SSH (different environment). Preferred restart method: `sudo reboot`.

## Lessons Learned (QA Breaker Round 2 — 2026-03-05)

Four more bugs found despite 114 passing tests. Root cause: tests didn't probe poison inputs or async race conditions.

| Bug | Root Cause | Fix | Lesson |
|-----|-----------|-----|--------|
| Null byte in filename → 500 | `pathlib.resolve()` raises `ValueError` on `\x00` | Check for `\x00` + try/except `ValueError` in `_serve_file()` | Every path operation on user input needs null byte defense. |
| Settings explicit `null` → 500 | `Optional` field accepts `null`, hits SQLite `NOT NULL` | Pydantic `model_validator` rejects explicit `None` in `model_fields_set` | `Optional` in Pydantic means "can be omitted", not "can be null". Test both. |
| Huge int in bulk delete → 500 | Python `int` is arbitrary-precision but SQLite is int64 | `Field(ge=1, le=2**63-1)` on list items | Always constrain integer ranges at the schema layer, even for IDs. |
| Delete during processing → orphaned files | Background thread writes output before checking if DB record exists | Clean up output file when record is gone post-processing | Background threads must verify preconditions after long operations, not just before. |

## Run & Test

```bash
docker compose up                  # Start both services
docker compose up --build          # Rebuild + start
docker compose down                # Stop

./scripts/test-backend.sh          # pytest (integration + unit)
./scripts/test-frontend.sh         # vitest
./scripts/test-e2e.sh              # playwright
./scripts/test-all.sh              # all, fail-early order

docker compose exec backend bash   # Shell into backend
docker compose exec frontend sh    # Shell into frontend
```

Ports: backend=8000, frontend=5173

## RPi Deployment

- Target: Raspberry Pi, hostname `photoframe`, user `pi`
- Use the `term-cli` skill for interactive terminal sessions (SSH, ansible-playbook, etc.)
- term-cli runs commands in background tmux sessions — use it for SSH into the Pi, running playbooks, checking logs
- For SSH passwords: ask the user, then use `send-text` to type it

## Resume Protocol

**On startup:**
1. Read `docs/STATE.md` — identify current phase and next tasks
2. Summarize: what's done, what's next (first 5 tasks)
3. Before coding: confirm assumptions, identify files to touch

**End of session:**
1. Update `docs/STATE.md` with completed items
2. Note verification commands that were run
3. List concrete next steps
