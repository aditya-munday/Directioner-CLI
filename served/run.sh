#!/usr/bin/env bash
# Keep the deliverables page up. Re-execs serve.py if it exits, so a crash or
# a stray kill does not leave the public URL on a 502. A full environment reset
# still stops this loop; run it again after one.
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG=/tmp/directioner-serve.log

until python3 "$DIR/serve.py" >>"$LOG" 2>&1; do
  echo "[$(date -Is)] serve.py exited; restarting in 1s" >>"$LOG"
  sleep 1
done
