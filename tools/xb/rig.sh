#!/bin/bash
# Runs one script in the cross-browser real-GPU rig (tools/gpu-rig/Dockerfile.xb) on the host's GPU, one container at a
# time: waits for free memory (tools/assets/memguard.sh) and holds a lock file while it runs.
#   tools/xb/rig.sh <script.mjs> [args...]
# XB_DISPLAY=weston|xvfb runs it under a display server (tools/xb/display.sh) for headful browsers; the scripts
# read XB_HEADFUL=1 then. Environment: XB_OUT (output directory, mounted at /out; default /tmp/rh-xb/out), XB_LOCK (lock file; default
# /tmp/rh-xb/heavy.lock), XB_MEM (container memory limit; default 3g), XB_NEED_MB (memguard; default 6000),
# XB_IMAGE (default red-horizon-gpu-rig-xb), and RIG_ENGINE / RIG_BACKEND / anything in XB_ENV (space-separated
# NAME=value pairs), which are passed into the container.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${XB_OUT:-/tmp/rh-xb/out}
LOCK=${XB_LOCK:-/tmp/rh-xb/heavy.lock}
mkdir -p "$OUT" "$(dirname "$LOCK")"
chmod 777 "$OUT" 2>/dev/null || true
ENVS=()
for v in RIG_ENGINE RIG_BACKEND W H HD MASK TAG SHOTS CLIMATES WX SECS EXTRA DYN VSYNC; do
  [ -n "${!v:-}" ] && ENVS+=(-e "$v=${!v}")
done
for kv in ${XB_ENV:-}; do ENVS+=(-e "$kv"); done
NAME="rh-xb-rig-$$"
ENTRY=()
if [ -n "${XB_DISPLAY:-}" ]; then ENTRY=(--entrypoint /game/tools/xb/display.sh); set -- "$XB_DISPLAY" node "$@"; ENVS+=(-e XB_HEADFUL=1); fi
"$ROOT/tools/assets/memguard.sh" "${XB_NEED_MB:-6000}"
# killing this script (timeout, Ctrl-C) also stops the container, which would otherwise keep running
trap 'docker kill "$NAME" >/dev/null 2>&1 || true' INT TERM HUP
flock "$LOCK" docker run --rm --init --name "$NAME" --device /dev/dri --network host \
  --memory "${XB_MEM:-3g}" --memory-swap "${XB_MEM:-3g}" --shm-size 1g "${ENVS[@]}" "${ENTRY[@]}" \
  -v "$ROOT:/game:ro" -v "$OUT:/out" "${XB_IMAGE:-red-horizon-gpu-rig-xb}" "$@" &
wait $! || exit $?
