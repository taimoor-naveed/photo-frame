# Deploy Script Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Single bash script run from Mac that redeploys photo-frame to home-pc with full media reprocessing, then refreshes the Pi kiosk.

**Architecture:** Bash script using SSH (key auth to Windows home-pc, sshpass to Pi). Creates tarball locally, SCPs to home-pc, backs up originals from Docker container, tears down + redeploys, re-uploads originals via API, then kills/relaunches Chromium on Pi.

**Tech Stack:** Bash, SSH, SCP, sshpass, Docker, curl, Windows cmd.exe (remote)

---

### Task 1: Create the deploy script with prerequisite checks

**Files:**
- Create: `scripts/deploy.sh`

**Step 1: Write the script skeleton with config and prerequisite checks**

```bash
#!/usr/bin/env bash
set -euo pipefail

# ─── Config ─────────────────────────────────────────────────
HOMEPC_HOST="home@home-pc"
HOMEPC_PROJECT_DIR="C:\\Users\\Home\\photo-frame"
HOMEPC_BACKUP_DIR="C:\\Users\\Home\\photo-frame-backup"
HOMEPC_TARBALL="C:\\Users\\Home\\photo-frame-deploy.tar.gz"

PI_HOST="pi@photoframe"
PI_PASSWORD="photoframe"

LOCAL_TARBALL="/tmp/photo-frame-deploy.tar.gz"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

HEALTH_CHECK_URL="http://localhost:8000/api/settings"
HEALTH_CHECK_TIMEOUT=120
UPLOAD_BATCH_SIZE=10
UPLOAD_URL="http://localhost:8000/api/media"

CHROMIUM_CMD="chromium --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-translate --no-first-run --start-fullscreen --enable-features=VaapiVideoDecoder --enable-gpu-rasterization http://home-pc/slideshow"

# ─── Helpers ────────────────────────────────────────────────
info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m==>\033[0m %s\n" "$1"; }
err()   { printf "\033[1;31m==>\033[0m %s\n" "$1" >&2; }

ssh_homepc() { ssh "$HOMEPC_HOST" "$1" 2>&1; }

# ─── Prerequisite checks ───────────────────────────────────
info "Checking prerequisites..."

if ! command -v sshpass &>/dev/null; then
    err "sshpass not found. Install with: brew install esolitos/ipa/sshpass"
    exit 1
fi

if ! ssh "$HOMEPC_HOST" "echo ok" &>/dev/null; then
    err "Cannot SSH into $HOMEPC_HOST. Check key-based auth."
    exit 1
fi

if ! sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no "$PI_HOST" "echo ok" &>/dev/null; then
    err "Cannot SSH into $PI_HOST. Check connection."
    exit 1
fi

ok "Prerequisites passed"
```

**Step 2: Make it executable and verify it runs**

Run: `chmod +x scripts/deploy.sh && bash scripts/deploy.sh`
Expected: "Prerequisites passed" (then exits because no further steps yet)

**Step 3: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat: deploy script skeleton with prerequisite checks"
```

---

### Task 2: Add tarball creation and SCP

**Files:**
- Modify: `scripts/deploy.sh`

**Step 1: Add tarball + SCP steps after prerequisite checks**

Append after the prerequisites block:

```bash
# ─── Step 1: Create tarball ────────────────────────────────
info "Creating tarball from $REPO_ROOT..."
tar czf "$LOCAL_TARBALL" \
    --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='data' --exclude='.DS_Store' \
    --exclude='e2e' --exclude='test_data' --exclude='docs/plans' \
    -C "$REPO_ROOT" .
ok "Tarball created: $(du -h "$LOCAL_TARBALL" | cut -f1)"

# ─── Step 2: SCP tarball to home-pc ────────────────────────
info "Copying tarball to $HOMEPC_HOST..."
scp "$LOCAL_TARBALL" "$HOMEPC_HOST:$HOMEPC_TARBALL"
ok "Tarball uploaded"
```

**Step 2: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat: deploy script tarball creation and SCP"
```

---

### Task 3: Add backup originals and teardown

**Files:**
- Modify: `scripts/deploy.sh`

**Step 1: Add backup + teardown steps**

Append:

```bash
# ─── Step 3: Backup originals from running container ───────
info "Backing up originals from container..."
if ssh_homepc "docker ps --format {{.Names}}" 2>/dev/null | grep -q "photo-frame-backend"; then
    ssh_homepc "docker cp photo-frame-backend-1:/app/data/originals $HOMEPC_BACKUP_DIR"
    BACKUP_COUNT=$(ssh_homepc "dir /b $HOMEPC_BACKUP_DIR" | wc -l | tr -d ' ')
    ok "Backed up $BACKUP_COUNT files"
else
    info "No running container found — skipping backup (first deploy?)"
    BACKUP_COUNT=0
fi

# ─── Step 4: Tear down containers + volume ─────────────────
info "Tearing down containers and volume..."
ssh_homepc "cd $HOMEPC_PROJECT_DIR && docker compose -f docker-compose.prod.yml down -v" || true
ok "Containers and volume removed"
```

**Step 2: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat: deploy script backup originals and teardown"
```

---

### Task 4: Add extract, build, and health check

**Files:**
- Modify: `scripts/deploy.sh`

**Step 1: Add extract + build + health check steps**

Append:

```bash
# ─── Step 5: Extract new code ──────────────────────────────
info "Extracting new code on home-pc..."
ssh_homepc "cd $HOMEPC_PROJECT_DIR && tar xzf $HOMEPC_TARBALL"
ok "Code extracted"

# ─── Step 6: Build and start containers ────────────────────
info "Building and starting containers (this may take a while)..."
ssh_homepc "cd $HOMEPC_PROJECT_DIR && docker compose -f docker-compose.prod.yml up --build -d"
ok "Containers started"

# ─── Step 7: Wait for backend to be healthy ────────────────
info "Waiting for backend to be healthy..."
ELAPSED=0
while [ $ELAPSED -lt $HEALTH_CHECK_TIMEOUT ]; do
    if ssh_homepc "curl -s -o nul -w %{http_code} $HEALTH_CHECK_URL" | grep -q "200"; then
        break
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    printf "."
done
echo ""

if [ $ELAPSED -ge $HEALTH_CHECK_TIMEOUT ]; then
    err "Backend did not become healthy within ${HEALTH_CHECK_TIMEOUT}s"
    err "Check logs: ssh $HOMEPC_HOST \"cd $HOMEPC_PROJECT_DIR && docker compose -f docker-compose.prod.yml logs backend\""
    exit 1
fi
ok "Backend is healthy"
```

Note: Windows curl uses `-o nul` (not `/dev/null`), and `%{http_code}` works the same.

**Step 2: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat: deploy script extract, build, and health check"
```

---

### Task 5: Add bulk upload of originals

**Files:**
- Modify: `scripts/deploy.sh`

**Step 1: Add upload step**

This is the trickiest part — need to batch files in groups and build curl `-F` flags on the Windows side. We'll use a `for` loop inside a cmd one-liner, batching via a counter.

Append:

```bash
# ─── Step 8: Re-upload originals via API ───────────────────
if [ "$BACKUP_COUNT" -gt 0 ]; then
    info "Re-uploading $BACKUP_COUNT originals in batches of $UPLOAD_BATCH_SIZE..."

    # Get file list from backup dir
    FILE_LIST=$(ssh_homepc "dir /b $HOMEPC_BACKUP_DIR")

    # Build array of filenames
    FILES=()
    while IFS= read -r line; do
        # Trim carriage return from Windows output
        line=$(echo "$line" | tr -d '\r')
        [ -n "$line" ] && FILES+=("$line")
    done <<< "$FILE_LIST"

    TOTAL=${#FILES[@]}
    UPLOADED=0
    FAILED=0

    # Upload in batches
    for ((i=0; i<TOTAL; i+=UPLOAD_BATCH_SIZE)); do
        BATCH=("${FILES[@]:i:UPLOAD_BATCH_SIZE}")
        BATCH_NUM=$(( (i / UPLOAD_BATCH_SIZE) + 1 ))
        BATCH_END=$((i + ${#BATCH[@]}))
        info "  Batch $BATCH_NUM: files $((i+1))-$BATCH_END of $TOTAL"

        # Build curl -F flags
        CURL_ARGS=""
        for f in "${BATCH[@]}"; do
            CURL_ARGS="$CURL_ARGS -F \"files=@$HOMEPC_BACKUP_DIR\\$f\""
        done

        RESPONSE=$(ssh_homepc "curl -s -w \"\\n%{http_code}\" -X POST $UPLOAD_URL $CURL_ARGS")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1 | tr -d '\r')

        if [ "$HTTP_CODE" = "200" ]; then
            UPLOADED=$((UPLOADED + ${#BATCH[@]}))
            ok "  Batch $BATCH_NUM: OK"
        else
            FAILED=$((FAILED + ${#BATCH[@]}))
            err "  Batch $BATCH_NUM: FAILED (HTTP $HTTP_CODE)"
            # Print response body for debugging
            echo "$RESPONSE" | head -5
        fi
    done

    ok "Upload complete: $UPLOADED succeeded, $FAILED failed out of $TOTAL"

    if [ "$FAILED" -gt 0 ]; then
        err "Some uploads failed — backup preserved at $HOMEPC_BACKUP_DIR"
    fi
else
    info "No originals to re-upload (first deploy)"
fi
```

**Step 2: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat: deploy script bulk upload originals"
```

---

### Task 6: Add cleanup and Pi refresh

**Files:**
- Modify: `scripts/deploy.sh`

**Step 1: Add cleanup + Pi refresh**

Append:

```bash
# ─── Step 9: Clean up on home-pc ──────────────────────────
info "Cleaning up..."
if [ "$BACKUP_COUNT" -gt 0 ] && [ "$FAILED" -eq 0 ]; then
    ssh_homepc "rmdir /s /q $HOMEPC_BACKUP_DIR"
    ok "Backup folder removed"
elif [ "$BACKUP_COUNT" -gt 0 ]; then
    info "Keeping backup folder due to upload failures: $HOMEPC_BACKUP_DIR"
fi
ssh_homepc "del $HOMEPC_TARBALL"
ok "Tarball removed"
rm -f "$LOCAL_TARBALL"

# ─── Step 10: Refresh Chromium on Pi ──────────────────────
info "Refreshing Chromium on Pi..."
sshpass -p "$PI_PASSWORD" ssh -o StrictHostKeyChecking=no "$PI_HOST" \
    "pkill -f chromium; sleep 2; DISPLAY=:0 $CHROMIUM_CMD &" 2>/dev/null || true
ok "Chromium restarted on Pi"

# ─── Done ─────────────────────────────────────────────────
echo ""
ok "Deploy complete!"
```

**Step 2: Run the full script end-to-end to verify**

Run: `bash scripts/deploy.sh`
Expected: Full deploy cycle completes, media reprocessed, Pi refreshes.

**Step 3: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat: deploy script cleanup and Pi refresh"
```

---

### Task 7: Final review and squash into single commit

**Step 1: Review the complete script**

Read `scripts/deploy.sh` end-to-end, verify:
- All Windows cmd syntax is correct (backslash paths, `nul`, `dir /b`, `rmdir /s /q`, `del`)
- Error handling: backup skip on first deploy, health check timeout, upload failure tracking
- Cleanup preserves backup if uploads failed
- CR/LF handling on Windows output (`tr -d '\r'`)

**Step 2: Squash commits into one**

```bash
git rebase -i main  # squash all deploy script commits into one
# Final message: "feat: add deploy script for home-pc redeployment with media reprocessing"
```
