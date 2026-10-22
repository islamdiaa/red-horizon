#!/bin/bash
# Cross-machine multiplayer over the REAL libvirt NAT: a browser in a test VM against a browser on the host (or in
# the other VM), both joining a room on the host's lab relay. Proves the lockstep and the portable maths hold across
# separate machines, OS network stacks and JavaScript engines (V8 / SpiderMonkey / JavaScriptCore) - the "known
# limit" in docs/MULTIPLAYER.md (mixed-browser matches only tested Chromium <-> Node so far).
#
# A Playwright browser server runs on each side (tools/net-lab/peer-server.mjs); the host drives both through
# tools/net-lab/match.mjs. The VM browser's game traffic is the real VM->host NAT; shaping on the Ubuntu side is real
# `tc netem` on enp1s0 (Windows has no netem). The game+relay are the rh-lab-net stack with the game published on the
# NAT gateway (netlab.sh: NETLAB_VM_BIND).
#
#   tools/net-lab/vm-match.sh <A> <B> [match.mjs args...]
#     peer: host | ubuntu[:chromium|firefox|webkit] | win11      (host = Chromium on the host GPU, localhost only)
#   NETEM_A / NETEM_B: a `tc netem` argument string for an ubuntu peer, e.g. 'delay 40ms 10ms loss 1%'
# Other agents use these VMs: processes are stopped by port only, snapshots are never reverted.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
lab="$repo/tools/lab/lab.sh"
URL="http://192.168.122.1:${NETLAB_VM_PORT:-8809}/"
log(){ echo "vm-match: $*" >&2; }
SPEC_A=${1:?A peer}; SPEC_B=${2:?B peer}; shift 2

vm_ip() { "$lab" status 2>/dev/null | awk -v v="rh-test-$1" '$1==v{for(i=1;i<=NF;i++) if($i ~ /^ip=/){sub(/ip=/,"",$i);print $i}}'; }
wait_port() { # <ip> <what>
  local k; for k in $(seq 1 60); do timeout 2 bash -c "echo > /dev/tcp/$1/3000" 2>/dev/null && { log "$2 up at $1:3000"; return 0; }; sleep 1; done
  log "$2 did not open $1:3000"; return 1
}
stop_ubuntu() { timeout 30 "$lab" ssh ubuntu 'fuser -k 3000/tcp >/dev/null 2>&1; sudo tc qdisc del dev enp1s0 root 2>/dev/null; rm -f ~/pw/peer-server.mjs ~/pw/peer.log; echo ok' >/dev/null 2>&1 || true; }
stop_win() { timeout 150 "$lab" ssh win11 'Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; Remove-NetFirewallRule -DisplayName rh-lab-net-peer -ErrorAction SilentlyContinue; foreach ($f in "C:/lab/pw/peer-server.mjs","C:/lab/pw/peer.log","C:/lab/pw/peer.err") { Remove-Item $f -Force -ErrorAction SilentlyContinue }; "ok"' >/dev/null 2>&1 || true; }

# (set here, from the specs: start_peer runs in a subshell, its assignments would not reach the cleanup trap)
used_host=0; used_ubuntu=0; used_win=0
for sp in "$SPEC_A" "$SPEC_B"; do case "${sp%%:*}" in host) used_host=1 ;; ubuntu) used_ubuntu=1 ;; win11) used_win=1 ;; esac; done
start_peer() { # <spec> -> prints "<endpoint> <engine>"
  local spec=$1 where=${1%%:*} engine=chromium
  [[ "$spec" == *:* ]] && engine=${spec#*:}
  case "$where" in
    host)
      docker rm -f rh-lab-net-hostpeer >/dev/null 2>&1
      docker run -d --name rh-lab-net-hostpeer --network host --device /dev/dri --shm-size 512m --memory 2560m \
        -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright -e PEER=host -e PEER_BIND=127.0.0.1 -e PEER_ENGINE="$engine" \
        -v "$repo":/game:ro -v "${PW_BROWSERS:-$HOME/.cache/ms-playwright}":/ms-playwright:ro -w /game \
        red-horizon-gpu-rig tools/net-lab/peer-server.mjs >/dev/null || return 1
      wait_port 127.0.0.1 "host peer ($engine)" >&2 || return 1
      echo "ws://127.0.0.1:3000/pw $engine" ;;
    ubuntu)
      local ip; ip=$(vm_ip ubuntu); [ -n "$ip" ] || return 1
      "$lab" copy ubuntu "$here/peer-server.mjs" ':pw/peer-server.mjs' || return 1
      # SwiftShader Chromium is headless; Firefox/WebKit run headed under xvfb (WebGL). setsid + no inherited fds so
      # the server outlives this SSH session; the SSH call itself is bounded.
      local run="node peer-server.mjs"
      [ "$engine" != chromium ] && run="xvfb-run -a -s '-screen 0 1280x720x24' node peer-server.mjs"
      local hf=0; [ "$engine" != chromium ] && hf=1
      timeout 25 "$lab" ssh ubuntu "fuser -k 3000/tcp >/dev/null 2>&1; sleep 1; cd ~/pw && setsid env PEER=ubuntu PEER_ENGINE=$engine PEER_GPU=0 PEER_HEADFUL=$hf $run >~/pw/peer.log 2>&1 </dev/null & disown; sleep 1; echo launched" >/dev/null 2>&1 || true
      wait_port "$ip" "ubuntu peer ($engine)" >&2 || { timeout 20 "$lab" ssh ubuntu 'tail -5 ~/pw/peer.log' >&2; return 1; }
      echo "ws://$ip:3000/pw $engine" ;;
    win11)
      local ip; ip=$(vm_ip win11); [ -n "$ip" ] || return 1
      "$lab" copy win11 "$here/peer-server.mjs" ':C:/lab/pw/peer-server.mjs' || return 1
      # the host reaches the peer server through Windows Firewall: a rule for the run, removed in cleanup
      timeout 150 "$lab" ssh win11 "New-NetFirewallRule -DisplayName rh-lab-net-peer -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null; Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }; cd C:/lab/pw; \$env:PEER='win11'; \$env:PEER_WIN='1'; \$env:PEER_CHANNEL='${WIN_CHANNEL:-chrome}'; \$env:PEER_ENGINE='$engine'; Start-Process node -ArgumentList 'peer-server.mjs' -WindowStyle Hidden -RedirectStandardError C:/lab/pw/peer.err -RedirectStandardOutput C:/lab/pw/peer.log; 'started'" >/dev/null 2>&1 || true
      wait_port "$ip" "win11 peer ($engine)" >&2 || return 1
      echo "ws://$ip:3000/pw $engine" ;;
    *) log "unknown peer $spec"; return 1 ;;
  esac
}

cleanup() {
  [ $used_ubuntu = 1 ] && stop_ubuntu
  [ $used_win = 1 ] && stop_win
  [ $used_host = 1 ] && docker rm -f rh-lab-net-hostpeer >/dev/null 2>&1
  true
}
trap cleanup EXIT

run() {
  local a b
  a=$(start_peer "$SPEC_A") || { log "peer A failed"; return 2; }
  b=$(start_peer "$SPEC_B") || { log "peer B failed"; return 2; }
  for side in A B; do
    local spec; spec=$([ $side = A ] && echo "$SPEC_A" || echo "$SPEC_B")
    local n; n=$([ $side = A ] && echo "${NETEM_A:-}" || echo "${NETEM_B:-}")
    if [ -n "$n" ]; then
      if [[ "$spec" == ubuntu* ]]; then timeout 30 "$lab" ssh ubuntu "sudo tc qdisc replace dev enp1s0 root netem $n" && log "ubuntu netem: $n"
      else log "netem for $spec skipped (only the ubuntu VM has tc netem)"; fi
    fi
  done
  log "A=$a  B=$b  url=$URL"
  node "$here/match.mjs" --a "${a% *}" --engine-a "${a#* }" --b "${b% *}" --engine-b "${b#* }" --url "$URL" --shape-a - --shape-b - "$@"
}

# browsers run (on the host and in the VMs): the lab's memory guard and heavy lock, held only for this run
"$repo/tools/assets/memguard.sh" 6000
mkdir -p /tmp/rh-lab
exec 9>/tmp/rh-lab/heavy.lock; flock 9
run "$@"
