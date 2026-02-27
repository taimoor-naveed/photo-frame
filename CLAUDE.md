# Photo Frame

Raspberry Pi 5 photo frame with web management UI. Touchscreen display, supports photos + videos (motion pictures). Developed on Mac with Docker, deployed to RPi5 later. Low traffic (2-3 concurrent users, 50 max).

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

- **No black borders, no cropping**: CSS blur background effect for aspect ratio mismatch
- **Apple-inspired UI**: white space, rounded corners, frosted glass, system fonts, min 44px touch targets
- **Photo-first**: UI fades into background, photos are the star
- **Sync SQLAlchemy**: no async overhead for this traffic level
- **Videos auto-play muted**, show first frame when ended with interval remaining
- **No flash on add/delete**: playlist + currentIndex update atomically via combined state object

## Test Rules

- **Assert identity, not existence.** Never write `expect(items.length).toBeGreaterThan(0)`. Always verify *which* item is shown, not just *that something* rendered. Use `data-media-id`, `data-testid`, or specific field values.
- **Cross-boundary integration tests are mandatory.** When adding a backend event or API change, write at least one test that sends a real message from the backend and asserts the frontend receives it with correct field names. TypeScript `as` casts hide mismatches — don't rely on them at system boundaries.
- **Convert spec bullets to test stubs first.** Before building a feature, read the spec, write failing test stubs for each behavior, then implement. This prevents "tests that pass with bugs."
- **E2E for complex stateful UI.** Unit tests with mocked timers and `act()` don't catch re-render cascades or unstable refs. For slideshow-like features, write E2E tests first.
- **Use `/test-writer` skill** when writing tests to enforce these patterns automatically.

## React Patterns

- **Never put function references in `useEffect` deps.** Use `useRef` for callbacks (the `goNextRef` pattern). Function references are recreated on re-render and cause effect cascades.
- **Atomic state for coupled values.** Values that must update together (e.g. `playlist` + `currentIndex`) go in a single `useState` object. Separate `useState` calls can render independently and cause flash/glitch.
- **Primitive deps over object deps.** Use `settings?.slideshow_interval` (number) instead of `settings` (object) in effect deps. New object references trigger effects even when values haven't changed.
- **No third-party gesture libraries.** Raw `onPointerDown`/`onPointerUp` for tap zones and long press. Libraries add indirection that conflicts with simple interaction models.
- **Design async from day one.** If any operation can take >1s (ffmpeg, large upload, external API), architect it as background + status tracking from the start. Retrofitting async is always a multi-file rework.

## Known Gotchas

- **Playwright `toBeVisible()` vs `toBeInViewport()`**: CSS `translate-y-full` hides elements off-screen but they're still "visible" to Playwright. Use `not.toBeInViewport()` for overlay hide assertions.
- **H.264 in headless Chromium**: Does not play. Use VP8/WebM (`ffmpeg -c:v libvpx`) for test videos.
- **WebSocket event format**: Backend sends `{"type": ..., "payload": ...}` to match frontend `WsEvent` interface. Any mismatch is silent (TypeScript `as` cast swallows it).
- **File input clearing**: Some browsers invalidate `File` objects when `input.value = ""` — copy files to array first.
- **StrictMode double-fetch**: React 19 StrictMode double-invokes effects, causing duplicate fetches. Use refs (e.g. `initialBuildDone`) to guard one-time operations.

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

## Resume Protocol

**On startup:**
1. Read `docs/STATE.md` — identify current phase and next tasks
2. Summarize: what's done, what's next (first 5 tasks)
3. Before coding: confirm assumptions, identify files to touch

**End of session:**
1. Update `docs/STATE.md` with completed items
2. Note verification commands that were run
3. List concrete next steps
