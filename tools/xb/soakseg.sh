#!/bin/bash
# Driver for tools/xb/soakseg.mjs in the cross-browser rig on a machine shared with other heavy jobs: the rig's
# container starts once and idles (page idle, no GPU work) except while this driver holds the shared lock file for one
# segment; between segments it releases the lock and pauses, so other jobs take turns.
#   tools/xb/soakseg.sh <chromium|firefox|webkit> [activeMinutes=60] [cycles=3] [segmentMinutes=12.5] [q=low]
# Environment: SOAK_URL (the game, default http://127.0.0.1:8815/), SOAK_LOCK (the shared lock file, default
# /tmp/rh-lab/heavy.lock), SOAK_PAUSE (seconds between segments, default 45), XB_OUT (rig output folder), XB_MEM.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
ENGINE=${1:?engine}; MIN=${2:-60}; CYC=${3:-3}; SEG=${4:-12.5}; Q=${5:-low}
OUT=${XB_OUT:-/tmp/rh-xb/out}
LOCK=${SOAK_LOCK:-/tmp/rh-lab/heavy.lock}
dir="$OUT/soakseg-$ENGINE${TAG:-}"
mkdir -p "$dir/ctl"; rm -f "$dir/ctl/"*
chmod -R 777 "$dir" 2>/dev/null || true
log() { echo "soakseg $(date +%H:%M:%S): $*"; }
# the container: its own private lock (the shared one is taken per segment below), headful on Weston for Firefox/WebKit
XB_LOCK="$(mktemp -u /tmp/rh-xb-soakseg-XXXX.lock)" XB_DISPLAY=weston XB_MEM=${XB_MEM:-3g} \
  XB_ENV="OUT_DIR=/out/soakseg-$ENGINE${TAG:-} GAME_URL=${SOAK_URL:-http://127.0.0.1:8815/} HEADED=1 ${XB_ENV:-}" \
  "$here/rig.sh" tools/xb/soakseg.mjs "$ENGINE" "$MIN" "$CYC" "$SEG" "$Q" > "$dir/container.log" 2>&1 &
rig=$!
trap 'kill $rig 2>/dev/null' INT TERM HUP
n=0
while kill -0 $rig 2>/dev/null && [ ! -e "$dir/ctl/end" ]; do
  "$repo/tools/assets/memguard.sh" 6000
  mkdir -p "$(dirname "$LOCK")"
  # one segment under the shared lock (capped: a segment that overruns is ended by the cap, the script idles at its next gate)
  flock "$LOCK" timeout 900 bash -c "touch '$dir/ctl/go-$n'; until [ -e '$dir/ctl/done-$n' ] || [ -e '$dir/ctl/end' ] || ! kill -0 $rig 2>/dev/null; do sleep 5; done"
  log "segment $n over"
  n=$((n + 1))
  [ -e "$dir/ctl/end" ] && break
  sleep "${SOAK_PAUSE:-45}"
done
wait $rig; rc=$?
log "done (exit $rc): $dir"
exit $rc
