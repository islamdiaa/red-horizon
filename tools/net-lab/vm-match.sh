#!/bin/bash
# Cross-machine multiplayer over the REAL libvirt NAT: a browser in a test VM against a browser on the host (or in
# the other VM), both joining a room on the host's lab relay. Proves the lockstep and the portable maths hold across
# separate machines, OS network stacks and JavaScript engines (V8 / SpiderMonkey / JavaScriptCore).
#
# A Playwright browser server runs on each side (tools/net-lab/peer-server.mjs); the host drives both through
# tools/net-lab/match.mjs. The VM browser's game traffic is the real VM->host NAT; shaping on the Ubuntu side is real
# `tc netem` on enp1s0, both directions (ingress through an ifb device). Windows has no netem. The game+relay are the
# rh-lab-net stack with the game published on the NAT gateway (netlab.sh: NETLAB_VM_BIND).
#
#   tools/net-lab/vm-match.sh <A> <B> [match.mjs args...]
#     peer: host | ubuntu[:chromium|firefox|webkit] | win11      (host = Chromium on the host GPU, localhost only)
#   NETEM_A / NETEM_B   a `tc netem` argument string for an ubuntu peer, applied to each direction,
#                       e.g. 'delay 75ms 10ms loss 2%' (about 150 ms RTT, 2 % loss each way)
#   NETLAB_PEER_PORT    the Playwright server port on every peer (default 8818). It must be free: the script checks
#                       it on each machine first and stops with a clear message when something else listens there
#                       (on the host, port 3000 belongs to another service: never use it).
#   NETLAB_VM_PORT      the game's port on the NAT gateway (default 8812, netlab.sh)
# Processes are stopped only if this script started them (by its own port); snapshots are never reverted.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
lab="$repo/tools/lab/lab.sh"
PORT=${NETLAB_PEER_PORT:-8818}
URL="http://192.168.122.1:${NETLAB_VM_PORT:-8812}/"
log(){ echo "vm-match: $*" >&2; }
SPEC_A=${1:?A peer}; SPEC_B=${2:?B peer}; shift 2
st=$(mktemp -d); # markers: what this run started (start_peer runs in a subshell)

vm_ip() { "$lab" status 2>/dev/null | awk -v v="rh-test-$1" '$1==v{for(i=1;i<=NF;i++) if($i ~ /^ip=/){sub(/ip=/,"",$i);print $i}}'; }

# --- is the port free? (on the host: anything listening on it, any address)
host_busy() { ss -ltnH "( sport = :$PORT )" 2>/dev/null | grep -q .; }
ubuntu_busy() { timeout 30 "$lab" ssh ubuntu "ss -ltnH '( sport = :$PORT )' | grep -q . && echo busy || echo free" 2>/dev/null | grep -q busy; }
win_busy() { timeout 150 "$lab" ssh win11 "if (Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue) { 'busy' } else { 'free' }" 2>/dev/null | grep -q busy; }
busy_msg() { log "port $PORT is already in use on $1 by something this script did not start: not touching it. Pick another with NETLAB_PEER_PORT=<free port>."; }

# --- wait until OUR server says it is ready (a bare TCP check would also succeed against another service)
wait_ready() { # <what> <command printing the peer log>
  local k; for k in $(seq 1 90); do
    if eval "$2" 2>/dev/null | grep -q 'ready ws://'; then log "$1 ready on port $PORT"; return 0; fi
    sleep 1
  done
  log "$1 did not become ready on port $PORT; last log lines:"; eval "$2" 2>/dev/null | tail -5 >&2; return 1
}

stop_ubuntu() {
  [ -e "$st/ubuntu" ] && timeout 30 "$lab" ssh ubuntu "fuser -k $PORT/tcp >/dev/null 2>&1; rm -f ~/pw/peer-server-$PORT.mjs ~/pw/peer-$PORT.log; echo ok" >/dev/null 2>&1
  [ -e "$st/netem" ] && timeout 30 "$lab" ssh ubuntu 'sudo tc qdisc del dev enp1s0 root 2>/dev/null; sudo tc qdisc del dev enp1s0 ingress 2>/dev/null; sudo ip link del ifb0 2>/dev/null; sudo modprobe -r ifb 2>/dev/null; tc qdisc show dev enp1s0 | head -1' >&2
  true
}
stop_win() {
  [ -e "$st/win11" ] || return 0
  timeout 150 "$lab" ssh win11 "Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }; Remove-NetFirewallRule -DisplayName rh-lab-net-peer-$PORT -ErrorAction SilentlyContinue; foreach (\$f in 'C:/lab/pw/peer-server-$PORT.mjs','C:/lab/pw/peer-$PORT.log','C:/lab/pw/peer-$PORT.err') { Remove-Item \$f -Force -ErrorAction SilentlyContinue }; 'ok'" >/dev/null 2>&1 || true
}

start_peer() { # <spec> -> prints "<endpoint> <engine>"
  local spec=$1 where=${1%%:*} engine=chromium
  [[ "$spec" == *:* ]] && engine=${spec#*:}
  case "$where" in
    host)
      host_busy && { busy_msg host; return 1; }
      docker rm -f rh-lab-net-hostpeer >/dev/null 2>&1
      touch "$st/host"
      docker run -d --name rh-lab-net-hostpeer --network host --device /dev/dri --shm-size 512m --memory 2560m \
        -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright -e PEER=host -e PEER_BIND=127.0.0.1 -e PEER_PORT="$PORT" -e PEER_ENGINE="$engine" \
        -v "$repo":/game:ro -v "${PW_BROWSERS:-$HOME/.cache/ms-playwright}":/ms-playwright:ro -w /game \
        red-horizon-gpu-rig tools/net-lab/peer-server.mjs >/dev/null || return 1
      wait_ready "host peer ($engine)" "docker logs rh-lab-net-hostpeer 2>&1" || return 1
      echo "ws://127.0.0.1:$PORT/pw $engine" ;;
    ubuntu)
      local ip; ip=$(vm_ip ubuntu); [ -n "$ip" ] || return 1
      ubuntu_busy && { busy_msg "the ubuntu VM"; return 1; }
      "$lab" copy ubuntu "$here/peer-server.mjs" ":pw/peer-server-$PORT.mjs" || return 1
      touch "$st/ubuntu"
      # SwiftShader Chromium is headless; Firefox/WebKit run headed under xvfb (WebGL). setsid + no inherited fds so
      # the server outlives this SSH session; the SSH call itself is bounded.
      local run="node peer-server-$PORT.mjs" hf=0
      [ "$engine" != chromium ] && { run="xvfb-run -a -s '-screen 0 1280x720x24' node peer-server-$PORT.mjs"; hf=1; }
      timeout 25 "$lab" ssh ubuntu "cd ~/pw && rm -f peer-$PORT.log && setsid env PEER=ubuntu PEER_PORT=$PORT PEER_ENGINE=$engine PEER_GPU=0 PEER_HEADFUL=$hf $run >~/pw/peer-$PORT.log 2>&1 </dev/null & disown; sleep 1; echo launched" >/dev/null 2>&1 || true
      wait_ready "ubuntu peer ($engine)" "timeout 20 '$lab' ssh ubuntu 'cat ~/pw/peer-$PORT.log'" || return 1
      echo "ws://$ip:$PORT/pw $engine" ;;
    win11)
      local ip; ip=$(vm_ip win11); [ -n "$ip" ] || return 1
      win_busy && { busy_msg "the win11 VM"; return 1; }
      "$lab" copy win11 "$here/peer-server.mjs" ":C:/lab/pw/peer-server-$PORT.mjs" || return 1
      touch "$st/win11"
      # the host reaches the peer server through Windows Firewall: a rule for the run, removed in cleanup. The server is
      # started through WMI (Win32_Process.Create): a process started from the SSH session would die with it (Windows
      # OpenSSH ends the session's job object), so its environment goes on the cmd line.
      local envs="set PEER=win11&& set PEER_PORT=$PORT&& set PEER_WIN=1&& set PEER_CHANNEL=${WIN_CHANNEL:-chrome}&& set PEER_ENGINE=$engine&&"
      timeout 150 "$lab" ssh win11 "New-NetFirewallRule -DisplayName rh-lab-net-peer-$PORT -Direction Inbound -LocalPort $PORT -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null; Remove-Item C:/lab/pw/peer-$PORT.log,C:/lab/pw/peer-$PORT.err -ErrorAction SilentlyContinue; \$node = (Get-Command node).Source; \$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = \"cmd /c $envs \`\"\$node\`\" peer-server-$PORT.mjs > C:\\lab\\pw\\peer-$PORT.log 2> C:\\lab\\pw\\peer-$PORT.err\"; CurrentDirectory = 'C:\\lab\\pw' }; 'started ' + \$r.ProcessId" >&2 || true
      wait_ready "win11 peer ($engine)" "timeout 60 '$lab' ssh win11 'Get-Content C:/lab/pw/peer-$PORT.log -ErrorAction SilentlyContinue'" || return 1
      echo "ws://$ip:$PORT/pw $engine" ;;
    *) log "unknown peer $spec"; return 1 ;;
  esac
}

cleanup() {
  stop_ubuntu
  stop_win
  [ -e "$st/host" ] && docker rm -f rh-lab-net-hostpeer >/dev/null 2>&1
  rm -rf "$st"
  true
}
trap cleanup EXIT

netem() { # <netem args>: the same model on egress and (through ifb0) ingress
  touch "$st/netem"
  timeout 40 "$lab" ssh ubuntu "set -e; sudo modprobe ifb numifbs=1; sudo ip link add ifb0 type ifb 2>/dev/null || true; sudo ip link set ifb0 up;
    sudo tc qdisc replace dev enp1s0 root netem $1;
    sudo tc qdisc add dev enp1s0 handle ffff: ingress;
    sudo tc filter add dev enp1s0 parent ffff: protocol all u32 match u32 0 0 action mirred egress redirect dev ifb0;
    sudo tc qdisc replace dev ifb0 root netem $1; tc qdisc show dev enp1s0; tc qdisc show dev ifb0" >&2
}

run() {
  local a b
  a=$(start_peer "$SPEC_A") || { log "peer A failed"; return 2; }
  b=$(start_peer "$SPEC_B") || { log "peer B failed"; return 2; }
  for side in A B; do
    local spec; spec=$([ $side = A ] && echo "$SPEC_A" || echo "$SPEC_B")
    local n; n=$([ $side = A ] && echo "${NETEM_A:-}" || echo "${NETEM_B:-}")
    if [ -n "$n" ]; then
      if [[ "$spec" == ubuntu* ]]; then netem "$n" && log "ubuntu netem (each way): $n"
      else log "netem for $spec skipped (only the ubuntu VM has tc netem)"; fi
    fi
  done
  log "A=$a  B=$b  url=$URL"
  node "$here/match.mjs" --a "${a% *}" --engine-a "${a#* }" --b "${b% *}" --engine-b "${b#* }" --url "$URL" --shape-a - --shape-b - "$@"
}

# a browser on the host: the lab's memory guard and heavy lock, held only for this run (browsers inside the VMs use
# the VMs' own fixed memory, so a VM-only match needs neither)
if [[ "$SPEC_A" == host* || "$SPEC_B" == host* ]]; then
  "$repo/tools/assets/memguard.sh" 6000
  mkdir -p /tmp/rh-lab
  exec 9>/tmp/rh-lab/heavy.lock; flock 9
fi
run "$@"
