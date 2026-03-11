#!/bin/bash
# Slideshow on/off script for Raspberry Pi kiosk
# Lives on the Pi at /home/pi/slideshow.sh
# Crontab: 0 0 * * * /home/pi/slideshow.sh off
#          0 9 * * * /home/pi/slideshow.sh on

SLIDESHOW_URL="http://home-pc/slideshow"
LOG="/tmp/slideshow.log"
DISPLAY_OUTPUT="HDMI-A-1"
export WAYLAND_DISPLAY=wayland-0
export XDG_RUNTIME_DIR=/run/user/1000

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"
}

case "$1" in
    off)
        log "Turning OFF"
        pkill -9 chromium 2>/dev/null
        sleep 1
        wlr-randr --output "$DISPLAY_OUTPUT" --off
        log "Display off, chromium killed"
        ;;
    on)
        log "Turning ON"
        wlr-randr --output "$DISPLAY_OUTPUT" --on
        sleep 2
        # Kill any leftover chromium before starting fresh
        pkill -9 chromium 2>/dev/null
        sleep 1
        nohup chromium \
            --ozone-platform=wayland --kiosk --noerrdialogs --disable-infobars \
            --disable-session-crashed-bubble --disable-translate --no-first-run \
            --start-fullscreen --enable-features=VaapiVideoDecoder \
            --enable-gpu-rasterization --remote-debugging-port=9222 \
            "$SLIDESHOW_URL" > /tmp/chromium.log 2>&1 & disown
        log "Display on, chromium started"
        ;;
    *)
        echo "Usage: $0 {on|off}"
        exit 1
        ;;
esac
