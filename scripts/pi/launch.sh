#!/bin/bash
# Desktop launcher (scripts/pi/organoid-analysis.desktop): starts the organoid-analysis user
# service if it isn't running (the OSC + serial bridges and the page), waits for the page on
# :5173, then opens it in its own Chromium window. The service keeps running after the
# window closes; stop it with: systemctl --user stop organoid-analysis
URL=http://localhost:5173
LOG="$HOME/.cache/organoid-analysis-launch.log"
mkdir -p "$(dirname "$LOG")"

say() {
    echo "$(date '+%F %T') $1" >> "$LOG"
    command -v notify-send >/dev/null && notify-send "Organoid Analysis" "$1"
}

systemctl --user start organoid-analysis.service || { say "Could not start the service; see $LOG"; exit 1; }

for _ in $(seq 60); do
    curl -s -o /dev/null "$URL" && break
    sleep 1
done
curl -s -o /dev/null "$URL" || { say "The page did not come up within 60 s (journalctl --user -u organoid-analysis)"; exit 1; }

exec chromium --app="$URL" --start-maximized --password-store=basic --ozone-platform-hint=auto >> "$LOG" 2>&1
