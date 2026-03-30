#!/bin/bash
# System health monitor for Pi slideshow diagnostics
# Lives on the Pi at /home/pi/scripts/health-check.sh
# Crontab: */5 * * * * /home/pi/scripts/health-check.sh

LOG="/home/pi/logs/system-health.log"
mkdir -p /home/pi/logs

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Memory stats
MEM_USED=$(free -m | awk '/Mem:/ {print $3}')
MEM_AVAIL=$(free -m | awk '/Mem:/ {print $7}')
SWAP_USED=$(free -m | awk '/Swap:/ {print $3}')

# Chromium process stats
CHROMIUM_PROCS=$(pgrep -c chromium 2>/dev/null || echo 0)
CHROMIUM_RSS=$(ps aux | grep '[c]hromium' | awk '{sum+=$6} END {printf "%.0f", sum/1024}')
[ -z "$CHROMIUM_RSS" ] && CHROMIUM_RSS=0

# Page alive check via Chrome DevTools Protocol
CDP_RESPONSE=$(curl -s --max-time 3 http://localhost:9222/json 2>/dev/null)
if [ -n "$CDP_RESPONSE" ]; then
    PAGE_URL=$(echo "$CDP_RESPONSE" | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["url"])' 2>/dev/null)
    PAGE_STATUS="alive url=$PAGE_URL"
else
    PAGE_STATUS="dead"
fi

# Backend reachable check
BACKEND_RESPONSE=$(curl -s --max-time 3 http://home-pc/api/health 2>/dev/null)
if echo "$BACKEND_RESPONSE" | grep -q '"ok"'; then
    BACKEND_STATUS="ok"
else
    BACKEND_STATUS="unreachable"
fi

echo "$TIMESTAMP | mem_used=${MEM_USED}M mem_avail=${MEM_AVAIL}M swap=${SWAP_USED}M | chromium_procs=$CHROMIUM_PROCS chromium_rss=${CHROMIUM_RSS}M | page=$PAGE_STATUS | backend=$BACKEND_STATUS" >> "$LOG"
