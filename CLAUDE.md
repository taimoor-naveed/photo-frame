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
