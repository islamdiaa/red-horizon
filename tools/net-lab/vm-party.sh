#!/bin/bash
# A multiplayer match with two to four real browsers on several machines (the host and the test VMs), driven by
# tools/net-lab/party.mjs through the rh-lab-net stack's game on the libvirt NAT (netlab.sh with NETLAB_VM_BIND).
#
#   tools/net-lab/vm-party.sh "<peer> <peer> [<peer> <peer>]" [party.mjs args...]
#     peer: <where>:<engine>[:<channel>]@<port>
#       where   host (a container on the host's GPU; chromium from red-horizon-gpu-rig, firefox/webkit headful under
#               Weston from red-horizon-gpu-rig-xb) | ubuntu | win11
#       engine  chromium | firefox | webkit        channel (chromium only): chrome | msedge
#       port    the Playwright server port on that machine (must be free there; never 3000 on the host)
#     e.g. "host:chromium@8817 win11:chromium:msedge@8818 ubuntu:firefox@8818 host:webkit@8819"
#   VM peers get --cut-<i> / --restore-<i> commands for party.mjs's cut event: they block the game's port on that VM
#   only (Ubuntu: iptables; Windows: a firewall rule), so the Playwright control channel keeps working.
#   NETEM_<i>  a `tc netem` argument string for an ubuntu peer (each direction), e.g. 'delay 150ms 20ms loss 5%'
#   NETLAB_VM_PORT  the game's port on the NAT gateway (default 8812)
# Holds the VM locks (/tmp/rh-lab/lab4-vm-<vm>.lock) of the VMs it uses, and the heavy lock (after memguard) when a
# host peer runs. Stops only what it started (by port), removes its rules and files.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
lab="$repo/tools/lab/lab.sh"
GPORT=${NETLAB_VM_PORT:-8812}
URL="http://192.168.122.1:$GPORT/"
log(){ echo "vm-party: $*" >&2; }
read -r -a SPECS <<<"${1:?peers}"; shift
st=$(mktemp -d)

vm_ip() { "$lab" status 2>/dev/null | awk -v v="rh-test-$1" '$1==v{for(i=1;i<=NF;i++) if($i ~ /^ip=/){sub(/ip=/,"",$i);print $i}}'; }
wait_ready() { local k; for k in $(seq 1 120); do if eval "$2" 2>/dev/null | grep -q 'ready ws://'; then log "$1 ready"; return 0; fi; sleep 1; done; log "$1 not ready:"; eval "$2" 2>/dev/null | tail -5 >&2; return 1; }

start_peer() { # <i> <spec> -> "<endpoint>|<engine>|<label>"
  local i=$1 spec=$2 port=${2##*@} rest=${2%@*}
  local where=${rest%%:*} eng=chromium chan=''
  IFS=: read -r _ eng chan <<<"$rest"; eng=${eng:-chromium}
  case "$where" in
    host)
      ss -ltnH "( sport = :$port )" | grep -q . && { log "host port $port busy"; return 1; }
      local name="rh-lab-net-party-$port"; docker rm -f "$name" >/dev/null 2>&1
      echo "$name" >>"$st/containers"
      if [ "$eng" = chromium ]; then
        docker run -d --name "$name" --network host --device /dev/dri --shm-size 512m --memory 2560m \
          -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright -e PEER=host -e PEER_BIND=127.0.0.1 -e PEER_PORT="$port" -e PEER_ENGINE=chromium \
          -v "$repo":/game:ro -v "${PW_BROWSERS:-$HOME/.cache/ms-playwright}":/ms-playwright:ro -w /game \
          red-horizon-gpu-rig tools/net-lab/peer-server.mjs >/dev/null || return 1
      else
        docker run -d --init --name "$name" --network host --device /dev/dri --shm-size 1g --memory 3g \
          -e PEER=host -e PEER_BIND=127.0.0.1 -e PEER_PORT="$port" -e PEER_ENGINE="$eng" -e PEER_HEADFUL=1 \
          --entrypoint /game/tools/xb/display.sh -v "$repo":/game:ro -w /game \
          red-horizon-gpu-rig-xb weston node tools/net-lab/peer-server.mjs >/dev/null || return 1
      fi
      wait_ready "host $eng@$port" "docker logs $name 2>&1" || return 1
      echo "ws://127.0.0.1:$port/pw|$eng|host-$eng" ;;
    ubuntu)
      local ip; ip=$(vm_ip ubuntu); [ -n "$ip" ] || { log "ubuntu VM not running"; return 1; }
      timeout 30 "$lab" ssh ubuntu "ss -ltnH '( sport = :$port )' | grep -q . && echo busy" 2>/dev/null | grep -q busy && { log "ubuntu port $port busy"; return 1; }
      "$lab" copy ubuntu "$here/peer-server.mjs" ":pw/peer-server-$port.mjs" >/dev/null || return 1
      echo "$port" >>"$st/ubuntu"
      local run="node peer-server-$port.mjs" hf=0
      [ "$eng" != chromium ] && { run="xvfb-run -a -s '-screen 0 1280x720x24' node peer-server-$port.mjs"; hf=1; }
      timeout 25 "$lab" ssh ubuntu "cd ~/pw && rm -f peer-$port.log && setsid env PEER=ubuntu PEER_STOP_FILE=\$HOME/pw/peer-$port.stop PEER_PORT=$port PEER_ENGINE=$eng PEER_CHANNEL=$chan PEER_GPU=0 PEER_HEADFUL=$hf $run >~/pw/peer-$port.log 2>&1 </dev/null & disown; sleep 1; echo launched" >/dev/null 2>&1 || true
      wait_ready "ubuntu $eng@$port" "timeout 20 '$lab' ssh ubuntu 'cat ~/pw/peer-$port.log'" || return 1
      echo "ws://$ip:$port/pw|$eng|ubuntu-$eng${chan:+-$chan}" ;;
    win11)
      local ip; ip=$(vm_ip win11); [ -n "$ip" ] || { log "win11 VM not running"; return 1; }
      timeout 150 "$lab" ssh win11 "if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { 'busy' }" 2>/dev/null | grep -q busy && { log "win11 port $port busy"; return 1; }
      "$lab" copy win11 "$here/peer-server.mjs" ":C:/lab/pw/peer-server-$port.mjs" >/dev/null || return 1
      "$lab" copy win11 "$here/win-peer-stop.ps1" ":C:/lab/pw/win-peer-stop.ps1" >/dev/null || return 1
      echo "$port" >>"$st/win11"
      local envs="set PEER=win11&& set PEER_PORT=$port&& set PEER_WIN=1&& set PEER_CHANNEL=$chan&& set PEER_ENGINE=$eng&& set PEER_STOP_FILE=C:/lab/pw/peer-$port.stop&&"
      timeout 150 "$lab" ssh win11 "New-NetFirewallRule -DisplayName rh-lab-net-peer-$port -Direction Inbound -LocalPort $port -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null; Remove-Item C:/lab/pw/peer-$port.log,C:/lab/pw/peer-$port.err -ErrorAction SilentlyContinue; \$node = (Get-Command node).Source; \$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = \"cmd /c $envs \`\"\$node\`\" peer-server-$port.mjs > C:\\lab\\pw\\peer-$port.log 2> C:\\lab\\pw\\peer-$port.err\"; CurrentDirectory = 'C:\\lab\\pw' }; 'started ' + \$r.ProcessId" >&2 || true
      wait_ready "win11 $eng@$port" "timeout 60 '$lab' ssh win11 'Get-Content C:/lab/pw/peer-$port.log -ErrorAction SilentlyContinue'" || return 1
      echo "ws://$ip:$port/pw|$eng|win11-${chan:-$eng}" ;;
    *) log "unknown peer $spec"; return 1 ;;
  esac
}

cut_cmds() { # <i> <where>: the --cut-i/--restore-i arguments
  case "$2" in
    ubuntu) printf -- "--cut-%s\0%s\0--restore-%s\0%s\0" "$1" "timeout 40 $lab ssh ubuntu 'sudo iptables -I OUTPUT -p tcp --dport $GPORT -j DROP && sudo iptables -I INPUT -p tcp --sport $GPORT -j DROP && echo cut'" "$1" "timeout 40 $lab ssh ubuntu 'sudo iptables -D OUTPUT -p tcp --dport $GPORT -j DROP; sudo iptables -D INPUT -p tcp --sport $GPORT -j DROP; echo restored'" ;;
    win11) printf -- "--cut-%s\0%s\0--restore-%s\0%s\0" "$1" "timeout 150 $lab ssh win11 \"New-NetFirewallRule -DisplayName rh-lab-net-cut-out -Direction Outbound -RemotePort $GPORT -Protocol TCP -Action Block | Out-Null; New-NetFirewallRule -DisplayName rh-lab-net-cut-in -Direction Inbound -RemotePort $GPORT -Protocol TCP -Action Block | Out-Null; 'cut'\"" "$1" "timeout 150 $lab ssh win11 \"Remove-NetFirewallRule -DisplayName rh-lab-net-cut-out,rh-lab-net-cut-in -ErrorAction SilentlyContinue; 'restored'\"" ;;
  esac
}

cleanup() {
  if [ -s "$st/ubuntu" ]; then
    local ports; ports=$(tr '\n' ' ' <"$st/ubuntu")
    timeout 40 "$lab" ssh ubuntu "for p in $ports; do touch ~/pw/peer-\$p.stop; for k in \$(seq 20); do ss -ltnH \"( sport = :\$p )\" | grep -q . || break; sleep 0.5; done; fuser -k \$p/tcp >/dev/null 2>&1; rm -f ~/pw/peer-server-\$p.mjs ~/pw/peer-\$p.log ~/pw/peer-\$p.stop; done; sudo iptables -D OUTPUT -p tcp --dport $GPORT -j DROP 2>/dev/null; sudo iptables -D INPUT -p tcp --sport $GPORT -j DROP 2>/dev/null; if [ -e /tmp/rh-party-netem ]; then sudo tc qdisc del dev enp1s0 root 2>/dev/null; sudo tc qdisc del dev enp1s0 ingress 2>/dev/null; sudo ip link del ifb0 2>/dev/null; rm -f /tmp/rh-party-netem; fi; tc qdisc show dev enp1s0 | head -1" >&2 || true
  fi
  if [ -s "$st/win11" ]; then
    local p; for p in $(cat "$st/win11"); do
      timeout 150 "$lab" ssh win11 "powershell -NoProfile -ExecutionPolicy Bypass -File C:/lab/pw/win-peer-stop.ps1 -Port $p" >&2 || true
    done
    timeout 60 "$lab" ssh win11 "Remove-Item C:/lab/pw/win-peer-stop.ps1 -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1 || true
  fi
  [ -s "$st/containers" ] && xargs -r docker rm -f <"$st/containers" >/dev/null 2>&1
  rm -rf "$st"
}
trap cleanup EXIT

# locks: the VMs this run uses (ubuntu before win11), then memguard + the heavy lock if a host peer runs
# (never hold one lock while waiting for another: with a host peer, wait for the heavy lock, then take the VM locks only
# if they are free right away, else let everything go and try again; VM-only runs wait for the VM locks in order)
uses() { [[ " ${SPECS[*]} " == *" $1:"* ]]; }
mkdir -p /tmp/rh-lab
uses ubuntu && exec 7>/tmp/rh-lab/lab4-vm-ubuntu.lock
uses win11 && exec 8>/tmp/rh-lab/lab4-vm-win11.lock
if uses host; then
  exec 9>/tmp/rh-lab/heavy.lock
  for attempt in $(seq 1 240); do
    "$repo/tools/assets/memguard.sh" 6000
    flock 9 || { log "heavy lock failed"; exit 3; }
    ok=1
    if uses ubuntu && ! flock -n 7; then ok=0; fi
    if [ $ok = 1 ] && uses win11 && ! flock -n 8; then ok=0; flock -u 7 2>/dev/null; fi
    [ $ok = 1 ] && break
    flock -u 9; log "a VM lock is busy: waiting (attempt $attempt)"; sleep 45
  done
  [ "${ok:-0}" = 1 ] || { log "could not get the locks"; exit 3; }
elif uses ubuntu && uses win11; then
  # both VMs: wait for the ubuntu one, take the win11 one only if it is free right away, else let go and retry
  for attempt in $(seq 1 240); do
    flock 7 || { log "ubuntu VM lock failed"; exit 3; }
    flock -n 8 && { ok=1; break; }
    flock -u 7; log "the win11 VM is busy: waiting (attempt $attempt)"; sleep 45
  done
  [ "${ok:-0}" = 1 ] || { log "could not get the VM locks"; exit 3; }
else
  if uses ubuntu; then log "waiting for the ubuntu VM lock"; flock 7 || exit 3; fi
  if uses win11; then log "waiting for the win11 VM lock"; flock 8 || exit 3; fi
fi
log "locks held"

peers=() extra=()
for i in "${!SPECS[@]}"; do
  p=$(start_peer "$i" "${SPECS[$i]}") || { log "peer $i (${SPECS[$i]}) failed"; exit 2; }
  peers+=("$p")
  where=${SPECS[$i]%%:*}
  while IFS= read -r -d '' a; do extra+=("$a"); done < <(cut_cmds "$i" "$where")
  nv="NETEM_$i"
  if [ -n "${!nv:-}" ] && [ "$where" = ubuntu ]; then
    timeout 40 "$lab" ssh ubuntu "set -e; touch /tmp/rh-party-netem; sudo modprobe ifb numifbs=1; sudo ip link add ifb0 type ifb 2>/dev/null || true; sudo ip link set ifb0 up;
      sudo tc qdisc replace dev enp1s0 root netem ${!nv}; sudo tc qdisc add dev enp1s0 handle ffff: ingress;
      sudo tc filter add dev enp1s0 parent ffff: protocol all u32 match u32 0 0 action mirred egress redirect dev ifb0;
      sudo tc qdisc replace dev ifb0 root netem ${!nv}; tc qdisc show dev enp1s0 | head -1" >&2 && log "ubuntu netem (each way): ${!nv}"
  fi
done
IFS=,; P="${peers[*]}"; unset IFS
log "peers: $P"
node "${PARTY_SCRIPT:-$here/party.mjs}" --peers "$P" --url "$URL" "${extra[@]}" "$@"
