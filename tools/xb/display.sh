#!/bin/bash
# Starts a display server inside the cross-browser rig, then runs the command (headful browsers):
#   display.sh weston node script.mjs ...   headless Weston with its GL renderer on the GPU's render node; browsers
#                                           run as Wayland clients, so Firefox and WebKitGTK get hardware WebGL
#   display.sh xvfb node script.mjs ...     Xvfb (no GPU: Mesa falls back to llvmpipe; a software reference)
# Used by tools/xb/rig.sh when XB_DISPLAY is set.
set -euo pipefail
mode=$1; shift
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/tmp/xdg-$UID}
mkdir -p -m 700 "$XDG_RUNTIME_DIR"
# an audio device (a null sink): without one, Firefox's AudioContext never leaves 'suspended'
if command -v pulseaudio >/dev/null; then
  pulseaudio --daemonize=yes --exit-idle-time=-1 --log-target=file:"$XDG_RUNTIME_DIR/pulse.log" \
    --load=module-null-sink --load=module-native-protocol-unix >/dev/null 2>&1 || true
fi
case "$mode" in
  weston)
    weston --backend=headless --renderer=gl --width=1920 --height=1080 --socket=wayland-rig --idle-time=0 \
      >"$XDG_RUNTIME_DIR/weston.log" 2>&1 &
    for _ in $(seq 50); do [ -S "$XDG_RUNTIME_DIR/wayland-rig" ] && break; sleep 0.1; done
    [ -S "$XDG_RUNTIME_DIR/wayland-rig" ] || { cat "$XDG_RUNTIME_DIR/weston.log"; exit 1; }
    export WAYLAND_DISPLAY=wayland-rig MOZ_ENABLE_WAYLAND=1 GDK_BACKEND=wayland
    unset DISPLAY
    exec "$@"
    ;;
  xvfb)
    exec xvfb-run -a -s "-screen 0 1920x1080x24" "$@"
    ;;
  *) echo "usage: display.sh <weston|xvfb> <command...>" >&2; exit 2 ;;
esac
