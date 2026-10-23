#!/bin/bash
# Runs a script that needs the E2E bot (tools/e2e) inside a test VM: copies tools/e2e and tools/xb into the VM's
# Playwright folder (~/pw/tools or C:\lab\pw\tools, so `playwright` and the relative imports resolve), runs the script
# there and copies its output back. Holds the VM's lock file for the run (other lab jobs take turns per job).
#
#   tools/xb/vme2e.sh <ubuntu|win11> <tag> <script under tools/, e.g. xb/vmplay.mjs or e2e/run.mjs> [args...]
#
# Environment: VM_GAME_URL (default http://192.168.122.1:8813/), VM_OUT (default $LAB_OUT/<vm>), VM_LOCK_DIR (default
# /tmp/rh-lab; lock file lab4-vm-<vm>.lock), and E2E_CHROME_ARGS / E2E_FIREFOX_PREFS / E2E_CHANNEL / E2E_EXECUTABLE,
# which are passed to the script in the VM. Linux runs under xvfb-run, so headed browsers work too.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
lab="$repo/tools/lab/lab.sh"
VM=${1:?vm}; TAG=${2:?tag}; SCRIPT=${3:?script}; shift 3
URL=${VM_GAME_URL:-http://192.168.122.1:8813/}
LOCK="${VM_LOCK_DIR:-/tmp/rh-lab}/lab4-vm-$VM.lock"
[ -f "$repo/tools/lab/.env" ] && . "$repo/tools/lab/.env"
OUTROOT=${VM_OUT:-${LAB_OUT:-/tmp/rh-lab/lab-out}/$VM}
mkdir -p "$OUTROOT" "$(dirname "$LOCK")"
job="$TAG-$(date +%Y%m%d-%H%M%S)"
q="'"
args=""
for a in "$@"; do
  if [ "$VM" = win11 ]; then args+=" '${a//$q/$q$q}'"; else args+=" '${a//$q/$q\\$q$q}'"; fi
done
envs=()
for v in E2E_CHROME_ARGS E2E_FIREFOX_PREFS E2E_CHANNEL E2E_EXECUTABLE E2E_JOURNEY_MINUTES E2E_FF_BATCH; do
  [ -n "${!v+x}" ] && envs+=("$v=${!v}")
done
exec 9>"$LOCK"; flock 9
stage=$(mktemp -d)
mkdir -p "$stage/tools"
cp -r "$repo/tools/e2e" "$stage/tools/e2e"; cp -r "$repo/tools/xb" "$stage/tools/xb"
rm -rf "$stage/tools/e2e/out" "$stage/tools/xb/out"
if [ "$VM" = win11 ]; then
  "$lab" ssh win11 "Remove-Item -Recurse -Force C:/lab/pw/tools -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force C:/lab/pw/tools,C:/lab/pw/out/$job | Out-Null" >/dev/null
  "$lab" copy win11 "$stage/tools/e2e" ":C:/lab/pw/tools/" && "$lab" copy win11 "$stage/tools/xb" ":C:/lab/pw/tools/"
  ps="cd C:/lab/pw/tools/${SCRIPT%/*}; \$env:GAME_URL='$URL'; \$env:OUT_DIR='C:/lab/pw/out/$job'; \$env:E2E_OUT='C:/lab/pw/out/$job';"
  for kv in "${envs[@]}"; do ps+=" \$env:${kv%%=*}='${kv#*=}';"; done
  ps+=" node ${SCRIPT##*/}$args; exit \$LASTEXITCODE"
  rc=0; "$lab" ssh win11 "$ps" || rc=$?
  "$lab" copy win11 ":C:/lab/pw/out/$job" "$OUTROOT/" || true
  "$lab" ssh win11 "Remove-Item -Recurse -Force C:/lab/pw/out/$job -ErrorAction SilentlyContinue" >/dev/null 2>&1 || true
else
  "$lab" ssh ubuntu "rm -rf ~/pw/tools && mkdir -p ~/pw/tools ~/pw/out/$job" >/dev/null
  "$lab" copy ubuntu "$stage/tools/e2e" ":pw/tools/" && "$lab" copy ubuntu "$stage/tools/xb" ":pw/tools/"
  ev=""; for kv in "${envs[@]}"; do ev+=" ${kv%%=*}='${kv#*=}'"; done
  rc=0; "$lab" ssh ubuntu "cd ~/pw/tools/${SCRIPT%/*} && env GAME_URL='$URL' OUT_DIR=\$HOME/pw/out/$job E2E_OUT=\$HOME/pw/out/$job$ev xvfb-run -a -s '-screen 0 1920x1080x24' node ${SCRIPT##*/}$args" || rc=$?
  "$lab" copy ubuntu ":pw/out/$job" "$OUTROOT/" || true
  "$lab" ssh ubuntu "rm -rf ~/pw/out/$job" >/dev/null 2>&1 || true
fi
rm -rf "$stage"
echo "vme2e: results in $OUTROOT/$job (exit $rc)" >&2
exit $rc
