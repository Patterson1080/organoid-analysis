#!/bin/bash
# Desktop "Stop" icon (scripts/pi/organoid-analysis-stop.desktop): closes the app window that
# launch.sh opened and stops the organoid-analysis user service (OSC + serial bridges, page).
# The service still starts at the next boot; the start icon brings it back now.
LOG="$HOME/.cache/organoid-analysis-launch.log"
mkdir -p "$(dirname "$LOG")"

pkill -f -- "--app=http://localhost:5173"
if systemctl --user stop organoid-analysis.service; then
    msg="Stopped. Tap Organoid Analysis to start it again."
else
    msg="Could not stop the service; see $LOG"
fi
echo "$(date '+%F %T') $msg" >> "$LOG"
command -v notify-send >/dev/null && notify-send "Organoid Analysis" "$msg"
