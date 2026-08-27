#!/usr/bin/env bash
set -euo pipefail

# Deploy the photo frame to home-pc (Ubuntu).
#
#   ./scripts/deploy.sh                       # normal deploy: back up originals from the
#                                             #   running container, wipe, rebuild, re-upload
#   ./scripts/deploy.sh --seed-from <dir>     # first deploy on an empty host: upload originals
#                                             #   from a local directory on this machine
#
# The deploy is deliberately clean-slate: the data volume is destroyed and every original is
# re-uploaded through the API so it gets reprocessed by the new code.

# ─── Config ─────────────────────────────────────────────────
HOMEPC_HOST="home@home-pc"
HOMEPC_PROJECT_DIR="/home/home/photo-frame"
HOMEPC_BACKUP_DIR="/home/home/photo-frame-backup"
HOMEPC_ORIGINALS_DIR="$HOMEPC_BACKUP_DIR/originals"
HOMEPC_TARBALL="/home/home/photo-frame-deploy.tar.gz"

LOCAL_TARBALL="/tmp/photo-frame-deploy.tar.gz"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

COMPOSE="docker compose -f docker-compose.prod.yml"
BACKEND_CONTAINER="photo-frame-backend-1"
CONTAINER_ORIGINALS="/app/data/originals"

HEALTH_CHECK_URL="http://localhost/api/health"     # curl runs on home-pc
HEALTH_CHECK_TIMEOUT=120
UPLOAD_BATCH_SIZE=10
UPLOAD_URL_REMOTE="http://localhost/api/media"     # curl runs on home-pc
UPLOAD_URL_LOCAL="http://home-pc/api/media"        # curl runs here (--seed-from)

SEED_FROM=""

# ─── Args ───────────────────────────────────────────────────
usage() {
    cat <<USAGE
Usage: $(basename "$0") [--seed-from <local-dir>]

  --seed-from <dir>   Upload originals from a local directory instead of from the
                      host's own backup. Use for the first deploy to a fresh host,
                      or to restore from an off-host backup. The directory is only
                      ever read — never deleted by this script.
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --seed-from)   SEED_FROM="${2:-}"; shift 2 ;;
        --seed-from=*) SEED_FROM="${1#*=}"; shift ;;
        -h|--help)     usage; exit 0 ;;
        *)             printf "Unknown option: %s\n\n" "$1" >&2; usage >&2; exit 2 ;;
    esac
done

# ─── Helpers ────────────────────────────────────────────────
info()  { printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m==>\033[0m %s\n" "$1"; }
err()   { printf "\033[1;31m==>\033[0m %s\n" "$1" >&2; }

# stderr is deliberately NOT folded into stdout — callers parse this output.
ssh_homepc() { ssh "$HOMEPC_HOST" "$1"; }

count_files_remote() {
    local count
    count=$(ssh_homepc "find '$1' -maxdepth 1 -type f 2>/dev/null | wc -l" | tr -d '[:space:]')
    echo "${count:-0}"
}

count_files_local() {
    local count
    count=$(find "$1" -maxdepth 1 -type f ! -name '.*' 2>/dev/null | wc -l | tr -d '[:space:]')
    echo "${count:-0}"
}

count_originals_in_container() {
    local count
    count=$(ssh_homepc "cd '$HOMEPC_PROJECT_DIR' && $COMPOSE exec -T backend find $CONTAINER_ORIGINALS -maxdepth 1 -type f | wc -l" | tr -d '[:space:]')
    echo "${count:-0}"
}

# Upload files from a local directory to the API, in batches. Echoes counts via globals.
upload_local_dir() {
    local dir="$1" url="$2"
    local files=() f batch args http_code
    local total uploaded=0 failed=0 i

    while IFS= read -r f; do
        [ -n "$f" ] && files+=("$f")
    done < <(find "$dir" -maxdepth 1 -type f ! -name '.*')

    total=${#files[@]}
    for ((i = 0; i < total; i += UPLOAD_BATCH_SIZE)); do
        batch=("${files[@]:i:UPLOAD_BATCH_SIZE}")
        args=()
        for f in "${batch[@]}"; do
            args+=(-F "files=@$f")
        done
        info "  Batch $(( (i / UPLOAD_BATCH_SIZE) + 1 )): files $((i + 1))-$((i + ${#batch[@]})) of $total"
        http_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$url" "${args[@]}") || true
        http_code=${http_code:-000}
        if [ "$http_code" = "200" ]; then
            uploaded=$((uploaded + ${#batch[@]}))
            ok "  Batch OK"
        else
            failed=$((failed + ${#batch[@]}))
            err "  Batch FAILED (HTTP $http_code)"
        fi
    done

    UPLOAD_TOTAL=$total
    UPLOAD_OK=$uploaded
    UPLOAD_FAILED=$failed
}

# ─── Prerequisite checks ────────────────────────────────────
info "Checking prerequisites..."

if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOMEPC_HOST" "echo ok" >/dev/null 2>&1; then
    err "Cannot SSH into $HOMEPC_HOST. Check key-based auth."
    exit 1
fi

if ! ssh_homepc "docker info" >/dev/null 2>&1; then
    err "Docker is not usable as '$HOMEPC_HOST' (daemon down, or user not in the 'docker' group)."
    err "Fix on home-pc: sudo systemctl enable --now docker && sudo usermod -aG docker \$USER"
    exit 1
fi

if [ -n "$SEED_FROM" ]; then
    if [ ! -d "$SEED_FROM" ]; then
        err "--seed-from directory does not exist: $SEED_FROM"
        exit 1
    fi
    SEED_COUNT=$(count_files_local "$SEED_FROM")
    if [ "$SEED_COUNT" -eq 0 ]; then
        err "--seed-from directory is empty: $SEED_FROM"
        exit 1
    fi
    info "Seeding enabled: $SEED_COUNT files from $SEED_FROM"
fi

# Abort if a stale backup exists from a previous failed deploy. Counts every file anywhere
# under the backup dir — a stale backup may be the only copy of those originals.
STALE_COUNT=$(ssh_homepc "find '$HOMEPC_BACKUP_DIR' -type f 2>/dev/null | wc -l" | tr -d '[:space:]')
STALE_COUNT=${STALE_COUNT:-0}
if [ "$STALE_COUNT" -gt 0 ]; then
    err "Stale backup found at $HOMEPC_BACKUP_DIR ($STALE_COUNT files)"
    err "It may be the only copy of those originals. Verify before removing it — never delete blind."
    exit 1
fi
# Only an empty leftover dir can be removed here.
ssh_homepc "rm -rf '$HOMEPC_BACKUP_DIR' && mkdir -p '$HOMEPC_PROJECT_DIR'"

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
scp -q "$LOCAL_TARBALL" "$HOMEPC_HOST:$HOMEPC_TARBALL"
ok "Tarball uploaded"

# ─── Step 2: Stop containers ────────────────────────────────
CONTAINER_EXISTS=false
if ssh_homepc "docker ps -a --format '{{.Names}}'" 2>/dev/null | grep -q "^$BACKEND_CONTAINER$"; then
    CONTAINER_EXISTS=true
    info "Stopping containers..."
    ssh_homepc "cd '$HOMEPC_PROJECT_DIR' && $COMPOSE stop" || true
    ok "Containers stopped"
else
    info "No existing containers found (first deploy)"
fi

# ─── Step 3: Back up originals from the stopped container ───
BACKUP_COUNT=0
if [ "$CONTAINER_EXISTS" = true ]; then
    info "Backing up originals from container..."
    # Pre-create the backup dir so docker cp lands originals/ inside it.
    ssh_homepc "mkdir -p '$HOMEPC_BACKUP_DIR'"
    ssh_homepc "docker cp '$BACKEND_CONTAINER:$CONTAINER_ORIGINALS' '$HOMEPC_BACKUP_DIR'"
    BACKUP_COUNT=$(count_files_remote "$HOMEPC_ORIGINALS_DIR")

    if [ "$BACKUP_COUNT" -gt 0 ]; then
        ok "Backed up $BACKUP_COUNT originals"
    else
        info "No originals in container (empty gallery)"
    fi
fi

if [ -n "$SEED_FROM" ] && [ "$BACKUP_COUNT" -gt 0 ]; then
    err "Refusing to seed: $BACKUP_COUNT originals were backed up from the running container."
    err "Seeding on top of them would duplicate the gallery. Backup kept at $HOMEPC_BACKUP_DIR."
    err "Re-run without --seed-from, or clear the gallery first."
    exit 1
fi

# ─── Step 4: Tear down everything (clean slate) ─────────────
if [ "$CONTAINER_EXISTS" = true ]; then
    info "Removing containers + volume (clean slate)..."
    ssh_homepc "cd '$HOMEPC_PROJECT_DIR' && $COMPOSE down -v" || true
    ok "Clean slate — containers and volume removed"
fi

# ─── Step 5: Extract fresh code ─────────────────────────────
info "Extracting new code..."
ssh_homepc "cd '$HOMEPC_PROJECT_DIR' && tar xzf '$HOMEPC_TARBALL'"
ok "Fresh code extracted"

# ─── Step 6: Start fresh containers ─────────────────────────
info "Building and starting fresh containers..."
ssh_homepc "cd '$HOMEPC_PROJECT_DIR' && $COMPOSE up --build -d"
ok "Fresh containers started"

# ─── Step 7: Health check ───────────────────────────────────
info "Waiting for backend to be healthy..."
ELAPSED=0
HEALTHY=false
while [ "$ELAPSED" -lt "$HEALTH_CHECK_TIMEOUT" ]; do
    if ssh_homepc "curl -s -o /dev/null -w '%{http_code}' $HEALTH_CHECK_URL" 2>/dev/null | grep -q "200"; then
        HEALTHY=true
        break
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    printf "."
done
echo ""

if [ "$HEALTHY" != true ]; then
    err "Backend did not become healthy within ${HEALTH_CHECK_TIMEOUT}s"
    if [ "$BACKUP_COUNT" -gt 0 ]; then
        err "Backup preserved at: $HOMEPC_BACKUP_DIR"
    fi
    exit 1
fi
ok "Backend is healthy (empty database)"

# ─── Step 8: Re-upload originals via the API ────────────────
UPLOAD_TOTAL=0
UPLOAD_OK=0
UPLOAD_FAILED=0

if [ -n "$SEED_FROM" ]; then
    info "Seeding $SEED_COUNT originals from $SEED_FROM -> $UPLOAD_URL_LOCAL ..."
    upload_local_dir "$SEED_FROM" "$UPLOAD_URL_LOCAL"

elif [ "$BACKUP_COUNT" -gt 0 ]; then
    info "Re-uploading $BACKUP_COUNT originals (full reprocessing with new code)..."
    UPLOAD_RESULT=$(ssh "$HOMEPC_HOST" \
        "ORIGINALS_DIR='$HOMEPC_ORIGINALS_DIR' BATCH_SIZE=$UPLOAD_BATCH_SIZE UPLOAD_URL='$UPLOAD_URL_REMOTE' bash -s" <<'REMOTE_SCRIPT'
set -u
cd "$ORIGINALS_DIR" || exit 1

files=()
while IFS= read -r f; do
    [ -n "$f" ] && files+=("$f")
done < <(find . -maxdepth 1 -type f ! -name '.*' | sed 's|^\./||' | sort)

total=${#files[@]}
uploaded=0
failed=0

for ((i = 0; i < total; i += BATCH_SIZE)); do
    batch=("${files[@]:i:BATCH_SIZE}")
    args=()
    for f in "${batch[@]}"; do
        args+=(-F "files=@$f")
    done
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$UPLOAD_URL" "${args[@]}") || true
    code=${code:-000}
    if [ "$code" = "200" ]; then
        uploaded=$((uploaded + ${#batch[@]}))
        echo "BATCH_OK files $((i + 1))-$((i + ${#batch[@]})) of $total"
    else
        failed=$((failed + ${#batch[@]}))
        echo "BATCH_FAIL files $((i + 1))-$((i + ${#batch[@]})) of $total (HTTP $code)"
    fi
done

echo "RESULT total=$total uploaded=$uploaded failed=$failed"
REMOTE_SCRIPT
)
    echo "$UPLOAD_RESULT" | grep -E '^BATCH_(OK|FAIL)' || true
    UPLOAD_TOTAL=$(echo "$UPLOAD_RESULT"  | sed -n 's/.*RESULT total=\([0-9]*\).*/\1/p')
    UPLOAD_OK=$(echo "$UPLOAD_RESULT"     | sed -n 's/.*uploaded=\([0-9]*\).*/\1/p')
    UPLOAD_FAILED=$(echo "$UPLOAD_RESULT" | sed -n 's/.*failed=\([0-9]*\).*/\1/p')
    UPLOAD_TOTAL=${UPLOAD_TOTAL:-0}
    UPLOAD_OK=${UPLOAD_OK:-0}
    UPLOAD_FAILED=${UPLOAD_FAILED:-0}
else
    info "No originals to re-upload"
fi

if [ "$UPLOAD_TOTAL" -gt 0 ]; then
    ok "Upload complete: $UPLOAD_OK succeeded, $UPLOAD_FAILED failed out of $UPLOAD_TOTAL"
fi

# ─── Step 9: Verify — container contents must match source ──
if [ "$UPLOAD_TOTAL" -gt 0 ]; then
    info "Verifying: counting originals in the new container..."
    NEW_COUNT=$(count_originals_in_container)

    EXPECTED=$UPLOAD_TOTAL
    if [ -z "$SEED_FROM" ]; then
        EXPECTED=$BACKUP_COUNT   # every file that was backed up must come back
    fi

    if [ "$NEW_COUNT" -eq "$EXPECTED" ] && [ "$UPLOAD_TOTAL" -eq "$EXPECTED" ] && [ "$UPLOAD_FAILED" -eq 0 ]; then
        ok "Verified: $NEW_COUNT/$EXPECTED originals — all accounted for"
        if [ -n "$SEED_FROM" ]; then
            info "Seed source left untouched at $SEED_FROM — delete it yourself once the gallery looks right."
        else
            info "Removing backup..."
            ssh_homepc "rm -rf '$HOMEPC_BACKUP_DIR'"
            ok "Backup removed"
        fi
    else
        err "MISMATCH: $NEW_COUNT in container vs $EXPECTED expected, $UPLOAD_TOTAL attempted ($UPLOAD_FAILED failures)"
        if [ -n "$SEED_FROM" ]; then
            err "Seed source is intact at $SEED_FROM — investigate before deleting it!"
        else
            err "Backup preserved at: $HOMEPC_BACKUP_DIR — investigate before deleting!"
        fi
    fi
elif [ "$BACKUP_COUNT" -gt 0 ]; then
    # Upload step reported nothing despite a non-empty backup — parse failure or aborted run.
    err "No upload result, but $BACKUP_COUNT originals were backed up."
    err "Backup preserved at: $HOMEPC_BACKUP_DIR — investigate before deleting!"
    exit 1
else
    # Nothing was backed up and nothing uploaded: only an empty dir can be here.
    ssh_homepc "rmdir '$HOMEPC_BACKUP_DIR' 2>/dev/null" || true
fi

# ─── Step 10: Clean up tarball ──────────────────────────────
ssh_homepc "rm -f '$HOMEPC_TARBALL'"
rm -f "$LOCAL_TARBALL"

# ─── Done ───────────────────────────────────────────────────
echo ""
if [ "$UPLOAD_FAILED" -gt 0 ]; then
    err "Deploy finished with upload errors"
    exit 1
fi
ok "Deploy complete!"
