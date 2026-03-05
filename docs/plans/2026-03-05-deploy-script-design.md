# Deploy Script Design

## Purpose

Single bash script (`scripts/deploy.sh`) run from the dev Mac that redeploys the photo-frame app to home-pc with full media reprocessing. Handles the case where backend processing logic changes and existing derived media needs regeneration.

## Target Environment

- **Dev machine**: Mac (where script runs)
- **home-pc**: Windows (cmd.exe over SSH, key-based auth), project at `C:\Users\Home\photo-frame`, Docker volume `photo-frame_backend-data`
- **Pi**: `pi@photoframe` (password auth), Chromium kiosk on DISPLAY=:0

## What the Script Does

1. Create tarball on Mac (excludes .git, node_modules, data, etc.)
2. SCP tarball to home-pc
3. Backup originals from running container via `docker cp`
4. Tear down containers + delete volume (`docker compose down -v`)
5. Extract new code via `tar xzf`
6. Build and start containers (`docker compose up --build -d`)
7. Poll health check until backend responds 200
8. Bulk upload backed-up originals via `POST /api/media` in batches of 10
9. Clean up backup folder + tarball

## Bugs Found During First Run

- **Health check URL**: Must use `http://localhost/api/settings` (port 80 via nginx), NOT `http://localhost:8000`. Port 8000 is internal to Docker and not exposed to the Windows host.

## Manual Step: Refresh Pi After Deploy

The deploy script does NOT touch the Pi. After deploy completes, manually refresh Chromium:

```bash
# SSH into Pi (password: photoframe)
ssh pi@photoframe

# Kill and relaunch Chromium
pkill -f chromium
sleep 2
DISPLAY=:0 chromium --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-translate --no-first-run --start-fullscreen --enable-features=VaapiVideoDecoder --enable-gpu-rasterization http://home-pc/slideshow &
```

Note: `sshpass` with Pi requires `-o PubkeyAuthentication=no` to force password auth. xdotool is not installed on the Pi, so F5 refresh doesn't work — kill and relaunch instead.

## Prerequisites

- Key-based SSH to home-pc already configured
- Docker running on home-pc

## Error Handling

- Script exits on first error (`set -e`)
- If backup step fails (no container running), skip it gracefully (first deploy scenario)
- If health check times out, abort and print diagnostic info
- If upload fails partway, print which files failed but continue with remaining files
- Backup folder preserved on home-pc if any uploads fail

## Windows cmd.exe Considerations

All SSH commands use Windows cmd syntax: backslash paths, `rmdir /s /q`, `del`. The `tar` and `curl` commands are available natively on Windows 10+.
