#!/bin/bash
# Red Horizon test lab: two libvirt VMs on the libvirt NAT network "default".
#   rh-test-ubuntu  Ubuntu 24.04 cloud image, 2 vCPU / 4 GB ("low-end laptop")
#   rh-test-win11   Windows 11 Enterprise evaluation, 4 vCPU / 6 GB, UEFI + TPM 2.0
# See tools/lab/README.md. Paths and secrets come from tools/lab/.env (git-ignored).
set -euo pipefail

LAB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$LAB_DIR/../.." && pwd)
[ -f "$LAB_DIR/.env" ] && . "$LAB_DIR/.env"
: "${LAB_SECRETS:?set LAB_SECRETS in tools/lab/.env}"
: "${LAB_DISKS:?set LAB_DISKS in tools/lab/.env}"
LAB_NET=default
# The game as seen from inside the VMs: the NAT network's gateway (the host), port 8091.
[ -n "${LAB_GAME_URL:-}" ] || LAB_GAME_URL="http://$(virsh net-dumpxml "$LAB_NET" 2>/dev/null | sed -n "s/.*<ip address='\([0-9.]*\)'.*/\1/p" | head -1):8091/"
LAB_OUT=${LAB_OUT:-${XDG_CACHE_HOME:-$HOME/.cache}/rh-lab-out}
MEMGUARD=${LAB_MEMGUARD:-$REPO/tools/assets/memguard.sh}
KEY=$LAB_SECRETS/lab_ed25519
PW_VERSION=${LAB_PW_VERSION:-1.64.1}   # keep in step with the repo's playwright

die() { echo "lab: $*" >&2; exit 1; }
log() { echo "lab: $*" >&2; }

# ---------------------------------------------------------------- VM table
resolve() {
  case "${1:-}" in
    ubuntu|rh-test-ubuntu)
      VM=rh-test-ubuntu KIND=ubuntu RAM=4096 CPUS=2 DISK_GB=30 USER_NAME=rhlab MAC=52:54:00:4b:10:01 ;;
    win|win11|windows|rh-test-win11)
      VM=rh-test-win11 KIND=win11 RAM=6144 CPUS=4 DISK_GB=64 USER_NAME=rhadmin MAC=52:54:00:4b:10:02 ;;
    *) die "unknown VM '${1:-}' (use ubuntu or win11)" ;;
  esac
  VMDIR=$LAB_DISKS/$VM
  DISK=$VMDIR/$VM.qcow2
  SNAPDIR=$VMDIR/snapshots
}

state() { local s; s=$(virsh domstate "$VM" 2>/dev/null) || s=undefined; echo "${s%%$'\n'*}"; }
defined() { virsh dominfo "$VM" >/dev/null 2>&1; }

ip_of() {
  local ip
  ip=$(virsh domifaddr "$VM" --source lease 2>/dev/null | awk -v m="$MAC" '$2==m && $3=="ipv4" {split($4,a,"/"); print a[1]}' | tail -1)
  [ -z "$ip" ] && ip=$(virsh domifaddr "$VM" --source agent 2>/dev/null | awk '$3=="ipv4" && $4 ~ /^192\.168\.122\./ {split($4,a,"/"); print a[1]}' | head -1)
  echo "$ip"
}

SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR
          -o ConnectTimeout=8 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o BatchMode=yes)

need_ip() { IP=$(ip_of); [ -n "$IP" ] || die "$VM has no IP yet (state: $(state))"; }

vssh() { need_ip; ssh "${SSH_OPTS[@]}" "$USER_NAME@$IP" "$@"; }

wait_ssh() {
  local limit=${1:-600} t=0
  while :; do
    IP=$(ip_of)
    if [ -n "$IP" ] && ssh "${SSH_OPTS[@]}" "$USER_NAME@$IP" "echo ok" >/dev/null 2>&1; then
      log "$VM is up at $IP"; return 0
    fi
    [ "$t" -ge "$limit" ] && die "$VM: no SSH after ${limit}s (state: $(state), ip: ${IP:-none})"
    sleep 10; t=$((t + 10))
  done
}

# ---------------------------------------------------------------- media
# A small FAT image (no root/loop needed) labelled CIDATA for cloud-init NoCloud.
mkfat() { # <out.img> <label> <file>...
  local out=$1 label=$2; shift 2
  rm -f "$out"
  mkfs.vfat -C -n "$label" "$out" 8192 >/dev/null
  local f
  for f in "$@"; do mcopy -o -i "$out" "$f" "::$(basename "$f")"; done
  chmod 600 "$out"
}

xml_escape() { python3 -I -c 'import sys,html; print(html.escape(sys.stdin.read().strip(), quote=True), end="")'; }

build_ubuntu_seed() {
  local tmp; tmp=$(mktemp -d)
  local hash pub
  hash=$(openssl passwd -6 -stdin < "$LAB_SECRETS/ubuntu-user.pass")
  pub=$(cat "$KEY.pub")
  sed -e "s|@USER@|$USER_NAME|g" -e "s|@HASH@|$hash|g" -e "s|@PUBKEY@|$pub|g" \
    "$LAB_DIR/ubuntu/user-data.tmpl" > "$tmp/user-data"
  printf 'instance-id: %s-%s\nlocal-hostname: %s\n' "$VM" "$(date +%s)" "$VM" > "$tmp/meta-data"
  mkfat "$LAB_SECRETS/$VM-seed.img" CIDATA "$tmp/user-data" "$tmp/meta-data"
  rm -rf "$tmp"
}

build_win_answer() { # a small ISO on a CD-ROM drive, so Setup's disk wipe can't touch it
  local tmp; tmp=$(mktemp -d)
  local pass; pass=$(xml_escape < "$LAB_SECRETS/win11-admin.pass")
  python3 -I - "$LAB_DIR/win11/autounattend.xml.tmpl" "$tmp/autounattend.xml" "$USER_NAME" "$pass" <<'PY'
import sys
src, dst, user, pw = sys.argv[1:5]
t = open(src, encoding='utf-8').read().replace('@USER@', user).replace('@PASSWORD@', pw)
open(dst, 'w', encoding='utf-8').write(t)
PY
  cp "$LAB_DIR/win11/setup.ps1" "$tmp/rhlab-setup.ps1"
  cp "$KEY.pub" "$tmp/rhlab-authorized_keys"
  python3 -I "$LAB_DIR/mkiso.py" "$LAB_SECRETS/$VM-answer.iso" RHLAB \
    "$tmp/autounattend.xml" "$tmp/rhlab-setup.ps1" "$tmp/rhlab-authorized_keys"
  chmod 600 "$LAB_SECRETS/$VM-answer.iso"
  rm -rf "$tmp"
}

render_xml() { # <template> <out>
  sed -e "s|@NAME@|$VM|g" -e "s|@RAM@|$RAM|g" -e "s|@CPUS@|$CPUS|g" -e "s|@MAC@|$MAC|g" \
      -e "s|@DISK@|$DISK|g" -e "s|@VMDIR@|$VMDIR|g" -e "s|@SECRETS@|$LAB_SECRETS|g" \
      -e "s|@WIN_ISO@|${LAB_WIN_ISO:-}|g" -e "s|@VIRTIO_ISO@|${LAB_VIRTIO_ISO:-}|g" \
      -e "s|@NET@|$LAB_NET|g" "$1" > "$2"
}

# ---------------------------------------------------------------- commands
cmd_build() {
  resolve "$1"
  defined && die "$VM is already defined; '$0 destroy $KIND --yes' first to rebuild it"
  mkdir -p "$VMDIR"
  local xml; xml=$(mktemp --suffix=.xml)
  if [ "$KIND" = ubuntu ]; then
    [ -f "${LAB_UBUNTU_IMG:-}" ] || die "LAB_UBUNTU_IMG not found"
    log "creating $DISK from the cloud image (${DISK_GB}G)"
    qemu-img convert -O qcow2 "$LAB_UBUNTU_IMG" "$DISK"
    qemu-img resize -q "$DISK" "${DISK_GB}G"
    build_ubuntu_seed
    render_xml "$LAB_DIR/ubuntu/domain.xml" "$xml"
  else
    [ -f "${LAB_WIN_ISO:-}" ] || die "LAB_WIN_ISO not found"
    [ -f "${LAB_VIRTIO_ISO:-}" ] || die "LAB_VIRTIO_ISO not found"
    log "creating $DISK (${DISK_GB}G)"
    qemu-img create -q -f qcow2 "$DISK" "${DISK_GB}G"
    build_win_answer
    render_xml "$LAB_DIR/win11/domain.xml" "$xml"
  fi
  virsh define "$xml" >/dev/null && rm -f "$xml"
  virsh autostart --disable "$VM" >/dev/null 2>&1 || true
  log "defined $VM; starting the unattended install"
  memguard_for
  virsh start "$VM" >/dev/null
  if [ "$KIND" = win11 ]; then
    # OVMF boots the DVD through "Press any key to boot from CD or DVD": answer it.
    local i; for i in $(seq 1 25); do virsh send-key "$VM" KEY_ENTER >/dev/null 2>&1 || true; sleep 1; done
    log "Windows Setup is running unattended (about 20-40 min); then: $0 provision win11"
  else
    log "cloud-init is running; then: $0 provision ubuntu"
  fi
}

cmd_destroy() {
  resolve "$1"; [ "${2:-}" = "--yes" ] || die "this deletes $VM and its disk; add --yes"
  if defined; then
    [ "$(state)" = "running" ] && virsh destroy "$VM" >/dev/null
    virsh undefine "$VM" --nvram --tpm >/dev/null 2>&1 || virsh undefine "$VM" --nvram >/dev/null
  fi
  rm -rf "$SNAPDIR" "$DISK" "$VMDIR/VARS.fd"
  rm -f "$LAB_SECRETS/$VM-seed.img" "$LAB_SECRETS/$VM-answer.iso"
  log "destroyed $VM"
}

cmd_provision() {
  resolve "$1"
  [ "$(state)" = running ] || cmd_up "$1"
  wait_ssh 3600
  if [ "$KIND" = ubuntu ]; then
    vssh "cloud-init status --wait >/dev/null 2>&1 || true"
    scp "${SSH_OPTS[@]}" -q "$LAB_DIR/ubuntu/provision.sh" "$USER_NAME@$IP:/tmp/provision.sh"
    vssh "sudo PW_VERSION=$PW_VERSION LAB_USER=$USER_NAME bash /tmp/provision.sh"
  else
    vssh "New-Item -ItemType Directory -Force C:\\lab | Out-Null"
    scp "${SSH_OPTS[@]}" -q "$LAB_DIR/win11/provision.ps1" "$LAB_DIR/win11/desktop-run.ps1" "$LAB_DIR/win11/display.ps1" "$USER_NAME@$IP:C:/lab/"
    vssh "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\lab\\provision.ps1 -PwVersion $PW_VERSION"
    # Installed: eject the Windows DVD and the answer ISO (it wipes disk 0 if Setup ever ran again).
    local dev; for dev in sda sdc; do virsh change-media "$VM" "$dev" --eject --live --config >/dev/null 2>&1 || true; done
  fi
  log "provisioned $VM. Take the clean snapshot with: $0 snapshot $KIND clean"
}

memguard_for() { "$MEMGUARD" $((RAM + 6000)); }

cmd_up() {
  resolve "$1"
  if [ "$(state)" != running ]; then
    memguard_for
    virsh start "$VM" >/dev/null
  fi
  wait_ssh "${2:-900}"
}

cmd_down() {
  resolve "$1"
  [ "$(state)" = running ] || { log "$VM is $(state)"; return 0; }
  virsh shutdown "$VM" >/dev/null
  local t=0
  while [ "$(state)" = running ]; do
    if [ $t -ge 240 ]; then log "$VM ignored ACPI shutdown for 240 s; powering off"; virsh destroy "$VM" >/dev/null; break; fi
    sleep 5; t=$((t + 5))
  done
  log "$VM is $(state)"
}

cmd_status() {
  local k
  for k in ubuntu win11; do
    resolve "$k"
    if ! defined; then printf '%-16s undefined\n' "$VM"; continue; fi
    local st ip auto snaps
    st=$(state); ip=$(ip_of); auto=$(virsh dominfo "$VM" | awk -F: '/^Autostart:/ {gsub(/ /,"",$2); print $2}')
    snaps=$( (ls "$SNAPDIR" 2>/dev/null || true) | tr '\n' ' ')
    printf '%-16s %-10s ip=%-16s user=%-8s ram=%sM vcpu=%s autostart=%s snapshots=[%s]\n' \
      "$VM" "$st" "${ip:--}" "$USER_NAME" "$RAM" "$(virsh dominfo "$VM" | awk '/^CPU\(s\)/ {print $2}')" "$auto" "${snaps% }"
  done
}

cmd_ssh() { resolve "$1"; shift; if [ $# -eq 0 ]; then need_ip; exec ssh -t "${SSH_OPTS[@]/BatchMode=yes/BatchMode=no}" "$USER_NAME@$IP"; else vssh "$@"; fi; }

cmd_copy() { # copy <vm> <src> <dst>   (prefix the VM-side path with ':' to copy from the VM)
  resolve "$1"; need_ip
  local src=$2 dst=$3
  if [[ "$src" == :* ]]; then scp "${SSH_OPTS[@]}" -q -r "$USER_NAME@$IP:${src#:}" "$dst"
  else scp "${SSH_OPTS[@]}" -q -r "$src" "$USER_NAME@$IP:${dst#:}"; fi
}

# Offline snapshots (qcow2 internal snapshot + firmware vars + TPM state), so they work
# with UEFI/TPM guests. The VM is shut down for the snapshot and restarted if it was running.
tpm_dir() { local uuid; uuid=$(virsh domuuid "$VM"); echo "/var/lib/libvirt/swtpm/$uuid"; }

cmd_snapshot() {
  resolve "$1"; local name=${2:?snapshot name}; local was; was=$(state)
  [ "$was" = running ] && cmd_down "$KIND"
  qemu-img snapshot -d "$name" "$DISK" 2>/dev/null || true
  qemu-img snapshot -c "$name" "$DISK"
  rm -rf "${SNAPDIR:?}/$name"; mkdir -p "$SNAPDIR/$name"
  [ -f "$VMDIR/VARS.fd" ] && cp "$VMDIR/VARS.fd" "$SNAPDIR/$name/"
  [ -d "$(tpm_dir)" ] && cp -a "$(tpm_dir)" "$SNAPDIR/$name/tpm"
  date -u +%FT%TZ > "$SNAPDIR/$name/created"
  log "snapshot '$name' of $VM saved"
  [ "$was" = running ] && cmd_up "$KIND" || true
}

cmd_revert() {
  resolve "$1"; local name=${2:?snapshot name}
  [ -d "$SNAPDIR/$name" ] || die "no snapshot '$name' for $VM"
  local was; was=$(state)
  [ "$was" = running ] && { virsh destroy "$VM" >/dev/null; sleep 2; }
  qemu-img snapshot -a "$name" "$DISK"
  [ -f "$SNAPDIR/$name/VARS.fd" ] && cp "$SNAPDIR/$name/VARS.fd" "$VMDIR/VARS.fd"
  if [ -d "$SNAPDIR/$name/tpm" ]; then rm -rf "$(tpm_dir)"; cp -a "$SNAPDIR/$name/tpm" "$(tpm_dir)"; fi
  log "reverted $VM to '$name'"
  [ "$was" = running ] && cmd_up "$KIND" || true
}

cmd_snapshots() { resolve "$1"; ls -1 "$SNAPDIR" 2>/dev/null || true; }

# run <vm> <script.mjs> [args]: copy the script (and its sibling .mjs/.js/.json files) into the
# VM's Playwright folder and run it with GAME_URL and OUT_DIR set; OUT_DIR comes back to
# $LAB_OUT/<vm>/<job>. Linux runs under xvfb-run so headed browsers work too.
# On Windows, LAB_DESKTOP=1 runs it in the logged-on desktop session instead of the SSH session.
cmd_run() {
  resolve "$1"; local script=$2; shift 2
  [ -f "$script" ] || die "no such script: $script"
  need_ip
  local dir base job stamp args=""
  dir=$(cd "$(dirname "$script")" && pwd); base=$(basename "$script")
  stamp=$(date +%Y%m%d-%H%M%S); job="${base%.*}-$stamp"
  local a q="'"   # single-quote each argument: POSIX shells escape ' as '\'', PowerShell as ''
  for a in "$@"; do
    if [ "$KIND" = win11 ]; then args+=" '${a//$q/$q$q}'"; else args+=" '${a//$q/$q\\$q$q}'"; fi
  done
  mkdir -p "$LAB_OUT/$VM"
  local files=(); while IFS= read -r -d '' f; do files+=("$f"); done < <(find "$dir" -maxdepth 1 -type f \( -name '*.mjs' -o -name '*.js' -o -name '*.json' \) -print0)
  if [ "$KIND" = ubuntu ]; then
    local rdir="pw/jobs/$(basename "$dir")" out="/home/$USER_NAME/pw/out/$job"
    vssh "mkdir -p $rdir $out"
    scp "${SSH_OPTS[@]}" -q "${files[@]}" "$USER_NAME@$IP:$rdir/"
    local rc=0
    vssh "cd $rdir && GAME_URL='$LAB_GAME_URL' OUT_DIR='$out' xvfb-run -a -s '-screen 0 1920x1080x24' node $base$args" || rc=$?
    scp "${SSH_OPTS[@]}" -q -r "$USER_NAME@$IP:$out" "$LAB_OUT/$VM/" || true
  else
    local rdir="C:/lab/pw/jobs/$(basename "$dir")" out="C:/lab/pw/out/$job"
    vssh "New-Item -ItemType Directory -Force '$rdir','$out' | Out-Null"
    scp "${SSH_OPTS[@]}" -q "${files[@]}" "$USER_NAME@$IP:$rdir/"
    local rc=0
    if [ "${LAB_DESKTOP:-0}" = 1 ]; then
      local argopt=""; [ -n "$args" ] && argopt="-ArgLine \"$args\""
      vssh "powershell -NoProfile -ExecutionPolicy Bypass -File C:/lab/desktop-run.ps1 -Dir '$rdir' -Script '$base' -Out '$out' -GameUrl '$LAB_GAME_URL' $argopt" || rc=$?
    else
      vssh "cd '$rdir'; \$env:GAME_URL='$LAB_GAME_URL'; \$env:OUT_DIR='$out'; node $base$args; exit \$LASTEXITCODE" || rc=$?
    fi
    scp "${SSH_OPTS[@]}" -q -r "$USER_NAME@$IP:$out" "$LAB_OUT/$VM/" || true
  fi
  log "results: $LAB_OUT/$VM/$job (exit $rc)"
  return $rc
}

cmd_cpus() { # cpus <vm> <n>: change the vCPU count (applies on next boot)
  resolve "$1"; local n=${2:?count}
  local xml; xml=$(mktemp --suffix=.xml)
  virsh dumpxml --inactive "$VM" > "$xml"
  sed -i -e "s|<vcpu placement='static'>[0-9]*</vcpu>|<vcpu placement='static'>$n</vcpu>|" \
         -e "s|cores='[0-9]*'|cores='$n'|" "$xml"
  virsh define "$xml" >/dev/null && rm -f "$xml"
  log "$VM now has $n vCPUs (restart it to apply)"
}

cmd_screen() { # screen <vm> <out.png>: grab the VM console (useful while Windows installs)
  resolve "$1"; local out=${2:?out.png} ppm; ppm=$(mktemp --suffix=.ppm)
  virsh screenshot "$VM" "$ppm" >/dev/null
  python3 -I - "$ppm" "$out" <<'PY'
import struct, sys, zlib
d = open(sys.argv[1], 'rb').read()
if d.startswith(b'\x89PNG'):  # newer libvirt/QEMU already return PNG
    open(sys.argv[2], 'wb').write(d); sys.exit(0)
magic, dims, maxv, px = d.split(b'\n', 3)
w, h = map(int, dims.split())
raw = b''.join(b'\x00' + px[y * w * 3:(y + 1) * w * 3] for y in range(h))
chunk = lambda t, b: struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
open(sys.argv[2], 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                              + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
PY
  rm -f "$ppm"
}

cmd_display() { # display win11 <W>x<H> [scale%]: desktop resolution and DPI scaling (Windows only)
  resolve "$1"; [ "$KIND" = win11 ] || die "display is for win11 (Ubuntu: xvfb-run sets the screen per run)"
  local wh=${2:?WxH} scale=${3:-0}; need_ip
  scp "${SSH_OPTS[@]}" -q "$LAB_DIR/win11/display.ps1" "$USER_NAME@$IP:C:/lab/"
  vssh "powershell -NoProfile -ExecutionPolicy Bypass -File C:/lab/display.ps1 -Width ${wh%x*} -Height ${wh#*x} -Scale $scale"
}

cmd_info() { # machine-readable summary (used for lab-ready.json)
  local k first=1
  echo "{"
  for k in ubuntu win11; do
    resolve "$k"; defined || continue
    [ $first = 1 ] || echo ","; first=0
    printf '  "%s": {"state": "%s", "ip": "%s", "user": "%s", "ram_mb": %s, "vcpus": %s}' \
      "$VM" "$(state)" "$(ip_of)" "$USER_NAME" "$RAM" "$(virsh dominfo "$VM" | awk '/^CPU\(s\)/ {print $2}')"
  done
  echo; echo "}"
}

usage() {
  cat <<EOF
usage: tools/lab/lab.sh <command> ...   (VMs: ubuntu | win11)
  build <vm>                   create the disk + answer media, define the VM, start the unattended install
  provision <vm>               install browsers, Node and Playwright over SSH
  up <vm> | down <vm>          start (after memguard) and wait for SSH | clean shutdown
  status                       state, IP, vCPUs, autostart and snapshots of both VMs
  ssh <vm> [cmd]               shell or one command (Windows: PowerShell)
  copy <vm> <src> <dst>        host -> VM; prefix the VM path with ':' to copy VM -> host
  snapshot <vm> <name>         offline snapshot (disk + UEFI vars + TPM); revert <vm> <name>; snapshots <vm>
  run <vm> <script.mjs> [args] run a Playwright script in the VM against \$LAB_GAME_URL ($LAB_GAME_URL)
  cpus <vm> <n>                change the vCPU count
  screen <vm> <out.png>        screenshot of the VM console
  display win11 <W>x<H> [pct]  Windows desktop resolution and display scaling (e.g. 1920x1080 150)
  info                         JSON summary
  destroy <vm> --yes           delete the VM and its disk
EOF
}

c=${1:-}; shift || true
case "$c" in
  build) cmd_build "$@" ;; destroy) cmd_destroy "$@" ;; provision) cmd_provision "$@" ;;
  up) cmd_up "$@" ;; down) cmd_down "$@" ;; status) cmd_status ;; ssh) cmd_ssh "$@" ;;
  copy) cmd_copy "$@" ;; snapshot) cmd_snapshot "$@" ;; revert) cmd_revert "$@" ;;
  snapshots) cmd_snapshots "$@" ;; run) cmd_run "$@" ;; cpus) cmd_cpus "$@" ;; info) cmd_info ;;
  screen) cmd_screen "$@" ;; display) cmd_display "$@" ;;
  ip) resolve "$1"; ip_of ;;
  ""|-h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
