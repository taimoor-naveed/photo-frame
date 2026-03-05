#!/usr/bin/env bash
set -euo pipefail

# ─── Config ─────────────────────────────────────────────────
HOMEPC_HOST="home@home-pc"
HOMEPC_PROJECT_DIR="C:\\Users\\Home\\photo-frame"
HOMEPC_BACKUP_DIR="C:\\Users\\Home\\photo-frame-backup"
HOMEPC_TARBALL="C:\\Users\\Home\\photo-frame-deploy.tar.gz"

LOCAL_TARBALL="/tmp/photo-frame-deploy.tar.gz"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

HEALTH_CHECK_URL="http://localhost/api/settings"
HEALTH_CHECK_TIMEOUT=120
UPLOAD_BATCH_SIZE=10
UPLOAD_URL="http://localhost/api/media"

# ─── Helpers ────────────────────────────────────────────────
info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m==>\033[0m %s\n" "$1"; }
err()   { printf "\033[1;31m==>\033[0m %s\n" "$1" >&2; }

ssh_homepc() { ssh "$HOMEPC_HOST" "$1" 2>&1; }

count_files() {
    # Count files in a Windows directory, returns 0 for empty/missing
    local count
    count=$(ssh_homepc "dir /b $1 2>nul" | tr -d '\r' | grep -c '.' || true)
    echo "${count:-0}"
}

# ─── Prerequisite checks ───────────────────────────────────
info "Checking prerequisites..."

if ! ssh "$HOMEPC_HOST" "echo ok" &>/dev/null; then
    err "Cannot SSH into $HOMEPC_HOST. Check key-based auth."
    exit 1
fi

ok "Prerequisites passed"

# ─── Step 1: Create tarball ────────────────────────────────
info "Creating tarball from $REPO_ROOT..."
tar czf "$LOCAL_TARBALL" \
    --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='data' --exclude='.DS_Store' \
    --exclude='e2e' --exclude='test_data' --exclude='docs/plans' \
    --exclude='.worktrees' \
    -C "$REPO_ROOT" .
ok "Tarball created: $(du -h "$LOCAL_TARBALL" | cut -f1)"

# ─── Step 2: SCP tarball to home-pc ────────────────────────
info "Copying tarball to $HOMEPC_HOST..."
scp "$LOCAL_TARBALL" "$HOMEPC_HOST:$HOMEPC_TARBALL"
ok "Tarball uploaded"

# ─── Step 3: Backup originals from running container ───────
# docker cp copies the directory INTO the target, so we get
# photo-frame-backup/originals/<files>
HOMEPC_ORIGINALS_DIR="$HOMEPC_BACKUP_DIR\\originals"
BACKUP_COUNT=0
info "Backing up originals from container..."
if ssh_homepc "docker ps --format {{.Names}}" 2>/dev/null | grep -q "photo-frame-backend"; then
    ssh_homepc "docker cp photo-frame-backend-1:/app/data/originals $HOMEPC_BACKUP_DIR"
    BACKUP_COUNT=$(count_files "$HOMEPC_ORIGINALS_DIR")
    if [ "$BACKUP_COUNT" -gt 0 ]; then
        ok "Backed up $BACKUP_COUNT files"
    else
        info "Container running but no originals to back up"
    fi
else
    info "No running container found — skipping backup (first deploy?)"
fi

# ─── Step 4: Tear down containers + volume ─────────────────
info "Tearing down containers and volume..."
ssh_homepc "cd $HOMEPC_PROJECT_DIR && docker compose -f docker-compose.prod.yml down -v" || true
ok "Containers and volume removed"

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
while [ "$ELAPSED" -lt "$HEALTH_CHECK_TIMEOUT" ]; do
    if ssh_homepc "curl -s -o nul -w %{http_code} $HEALTH_CHECK_URL" | grep -q "200"; then
        break
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    printf "."
done
echo ""

if [ "$ELAPSED" -ge "$HEALTH_CHECK_TIMEOUT" ]; then
    err "Backend did not become healthy within ${HEALTH_CHECK_TIMEOUT}s"
    err "Check logs: ssh $HOMEPC_HOST \"cd $HOMEPC_PROJECT_DIR && docker compose -f docker-compose.prod.yml logs backend\""
    exit 1
fi
ok "Backend is healthy"

# ─── Step 8: Re-upload originals via API ───────────────────
FAILED=0
if [ "$BACKUP_COUNT" -gt 0 ]; then
    info "Re-uploading $BACKUP_COUNT originals in batches of $UPLOAD_BATCH_SIZE..."

    # Get file list from the originals subfolder
    FILE_LIST=$(ssh_homepc "dir /b $HOMEPC_ORIGINALS_DIR")

    # Build array of filenames
    FILES=()
    while IFS= read -r line; do
        line=$(echo "$line" | tr -d '\r')
        [ -n "$line" ] && FILES+=("$line")
    done <<< "$FILE_LIST"

    TOTAL=${#FILES[@]}
    UPLOADED=0

    # Upload in batches
    for ((i=0; i<TOTAL; i+=UPLOAD_BATCH_SIZE)); do
        BATCH=("${FILES[@]:i:UPLOAD_BATCH_SIZE}")
        BATCH_NUM=$(( (i / UPLOAD_BATCH_SIZE) + 1 ))
        BATCH_END=$((i + ${#BATCH[@]}))
        info "  Batch $BATCH_NUM: files $((i+1))-$BATCH_END of $TOTAL"

        # Build curl -F flags
        CURL_ARGS=""
        for f in "${BATCH[@]}"; do
            CURL_ARGS="$CURL_ARGS -F \"files=@$HOMEPC_ORIGINALS_DIR\\$f\""
        done

        RESPONSE=$(ssh_homepc "curl -s -w \"\\n%{http_code}\" -X POST $UPLOAD_URL $CURL_ARGS")
        HTTP_CODE=$(echo "$RESPONSE" | tail -1 | tr -d '\r')

        if [ "$HTTP_CODE" = "200" ]; then
            UPLOADED=$((UPLOADED + ${#BATCH[@]}))
            ok "  Batch $BATCH_NUM: OK"
        else
            FAILED=$((FAILED + ${#BATCH[@]}))
            err "  Batch $BATCH_NUM: FAILED (HTTP $HTTP_CODE)"
            echo "$RESPONSE" | head -5
        fi
    done

    ok "Upload complete: $UPLOADED succeeded, $FAILED failed out of $TOTAL"

    if [ "$FAILED" -gt 0 ]; then
        err "Some uploads failed — backup preserved at $HOMEPC_BACKUP_DIR"
    fi
else
    info "No originals to re-upload"
fi

# ─── Step 9: Clean up on home-pc ──────────────────────────
info "Cleaning up..."
if [ "$BACKUP_COUNT" -gt 0 ] && [ "$FAILED" -eq 0 ]; then
    ssh_homepc "rmdir /s /q $HOMEPC_BACKUP_DIR"
    ok "Backup folder removed"
elif [ "$BACKUP_COUNT" -gt 0 ]; then
    info "Keeping backup folder due to upload failures: $HOMEPC_BACKUP_DIR"
fi
ssh_homepc "del $HOMEPC_TARBALL"
ok "Tarball removed from home-pc"
rm -f "$LOCAL_TARBALL"

# ─── Done ─────────────────────────────────────────────────
echo ""
ok "Deploy complete! Remember to manually refresh Chromium on the Pi."
