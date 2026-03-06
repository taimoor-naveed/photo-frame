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

# Abort if stale backup exists from a previous failed deploy
STALE_COUNT=$(count_files "$HOMEPC_BACKUP_DIR")
if [ "$STALE_COUNT" -gt 0 ]; then
    err "Stale backup found at $HOMEPC_BACKUP_DIR ($STALE_COUNT files)"
    err "Investigate and remove it manually before deploying."
    exit 1
fi
# Clean up empty stale backup dir if it exists
ssh_homepc "rmdir $HOMEPC_BACKUP_DIR 2>nul & echo ok" > /dev/null

ok "Prerequisites passed"

# ─── Step 1: Create tarball + upload ────────────────────────
info "Creating tarball from $REPO_ROOT..."
tar czf "$LOCAL_TARBALL" \
    --exclude='.git' --exclude='node_modules' --exclude='__pycache__' \
    --exclude='*.pyc' --exclude='data' --exclude='.DS_Store' \
    --exclude='e2e' --exclude='test_data' --exclude='docs/plans' \
    --exclude='.worktrees' \
    -C "$REPO_ROOT" .
ok "Tarball created: $(du -h "$LOCAL_TARBALL" | cut -f1)"

info "Copying tarball to $HOMEPC_HOST..."
scp "$LOCAL_TARBALL" "$HOMEPC_HOST:$HOMEPC_TARBALL"
ok "Tarball uploaded"

# ─── Step 2: Stop containers ───────────────────────────────
# Check if containers exist before trying to stop/backup
CONTAINER_EXISTS=false
if ssh_homepc "docker ps -a --format {{.Names}}" 2>/dev/null | grep -q "photo-frame-backend"; then
    CONTAINER_EXISTS=true
    info "Stopping containers..."
    ssh_homepc "cd $HOMEPC_PROJECT_DIR && docker compose -f docker-compose.prod.yml stop" || true
    ok "Containers stopped"
else
    info "No existing containers found (first deploy)"
fi

# ─── Step 3: Backup originals from stopped container ───────
HOMEPC_ORIGINALS_DIR="$HOMEPC_BACKUP_DIR\\originals"
BACKUP_COUNT=0

if [ "$CONTAINER_EXISTS" = true ]; then
    info "Backing up originals from container..."
    # Pre-create backup dir so docker cp creates originals/ subdirectory inside it
    ssh_homepc "mkdir $HOMEPC_BACKUP_DIR"
    ssh_homepc "docker cp photo-frame-backend-1:/app/data/originals $HOMEPC_BACKUP_DIR"
    BACKUP_COUNT=$(count_files "$HOMEPC_ORIGINALS_DIR")

    if [ "$BACKUP_COUNT" -gt 0 ]; then
        ok "Backed up $BACKUP_COUNT originals"
    else
        info "No originals in container (empty gallery)"
    fi
fi

# ─── Step 4: Tear down everything (clean slate) ────────────
if [ "$CONTAINER_EXISTS" = true ]; then
    info "Removing containers + volume (clean slate)..."
    ssh_homepc "cd $HOMEPC_PROJECT_DIR && docker compose -f docker-compose.prod.yml down -v" || true
    ok "Clean slate — containers and volume removed"
fi

# ─── Step 5: Extract fresh code ────────────────────────────
info "Extracting new code..."
ssh_homepc "cd $HOMEPC_PROJECT_DIR && tar xzf $HOMEPC_TARBALL"
ok "Fresh code extracted"

# ─── Step 6: Start fresh containers ────────────────────────
info "Building and starting fresh containers..."
ssh_homepc "cd $HOMEPC_PROJECT_DIR && docker compose -f docker-compose.prod.yml up --build -d"
ok "Fresh containers started"

# ─── Step 7: Health check ──────────────────────────────────
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
    if [ "$BACKUP_COUNT" -gt 0 ]; then
        err "Backup preserved at: $HOMEPC_BACKUP_DIR"
    fi
    exit 1
fi
ok "Backend is healthy (empty database)"

# ─── Step 8: Re-upload originals via API ───────────────────
FAILED=0
if [ "$BACKUP_COUNT" -gt 0 ]; then
    info "Re-uploading $BACKUP_COUNT originals (full reprocessing with new code)..."

    FILE_LIST=$(ssh_homepc "dir /b $HOMEPC_ORIGINALS_DIR")
    FILES=()
    while IFS= read -r line; do
        line=$(echo "$line" | tr -d '\r')
        [ -n "$line" ] && FILES+=("$line")
    done <<< "$FILE_LIST"

    TOTAL=${#FILES[@]}
    UPLOADED=0

    for ((i=0; i<TOTAL; i+=UPLOAD_BATCH_SIZE)); do
        BATCH=("${FILES[@]:i:UPLOAD_BATCH_SIZE}")
        BATCH_NUM=$(( (i / UPLOAD_BATCH_SIZE) + 1 ))
        BATCH_END=$((i + ${#BATCH[@]}))
        info "  Batch $BATCH_NUM: files $((i+1))-$BATCH_END of $TOTAL"

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

    # ─── Step 9: Verify — new originals must match backup ──────
    info "Verifying: comparing new container vs backup..."
    NEW_COUNT=$(ssh_homepc "cd $HOMEPC_PROJECT_DIR && docker compose -f docker-compose.prod.yml exec -T backend ls /app/data/originals/" | tr -d '\r' | grep -c '.' || true)

    if [ "$NEW_COUNT" -eq "$BACKUP_COUNT" ] && [ "$FAILED" -eq 0 ]; then
        ok "Verified: $NEW_COUNT/$BACKUP_COUNT originals — all accounted for"
        info "Removing backup..."
        ssh_homepc "rmdir /s /q $HOMEPC_BACKUP_DIR"
        ok "Backup removed"
    else
        err "MISMATCH: $NEW_COUNT in container vs $BACKUP_COUNT in backup ($FAILED upload failures)"
        err "Backup preserved at: $HOMEPC_BACKUP_DIR — investigate before deleting!"
    fi
else
    info "No originals to re-upload"
    # Clean up empty backup dir if it was created
    ssh_homepc "rmdir /s /q $HOMEPC_BACKUP_DIR 2>nul & echo ok" > /dev/null
fi

# ─── Step 10: Clean up tarball ─────────────────────────────
ssh_homepc "del $HOMEPC_TARBALL"
rm -f "$LOCAL_TARBALL"

# ─── Done ─────────────────────────────────────────────────
echo ""
if [ "$FAILED" -gt 0 ]; then
    err "Deploy finished with upload errors — backup at $HOMEPC_BACKUP_DIR"
    exit 1
fi
ok "Deploy complete!"
