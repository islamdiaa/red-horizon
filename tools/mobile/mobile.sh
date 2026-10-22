#!/bin/bash
# Android emulator lab: Chrome on Android in a KVM emulator inside a container (see README.md).
#
#   tools/mobile/mobile.sh build                 build the container image
#   tools/mobile/mobile.sh setup                 download the SDK tools and the system image into $RH_MOBILE_HOME
#   tools/mobile/mobile.sh up                    boot the emulator (memguard first; adb on the host's loopback :5037)
#   tools/mobile/mobile.sh down                  stop it
#   tools/mobile/mobile.sh status                container and device state
#   tools/mobile/mobile.sh adb <args...>         run adb inside the container
#   tools/mobile/mobile.sh profile <name>        phone | phone-land | tablet | tablet-land | native
#   tools/mobile/mobile.sh shot <out.png>        device screenshot (whole screen, Android UI included)
#
# Environment:
#   RH_MOBILE_HOME   persistent folder for sdk/ and avd/ (several GB; default ~/.rh-mobile)
#   RH_MOBILE_RAM    guest RAM in MB (default 4096)
#   RH_MOBILE_GPU    emulator -gpu mode (default swiftshader_indirect)
#   RH_MOBILE_GAME   game servers the device reaches as http://localhost:<port>, as "host:port ..."
#                    (default host.docker.internal:5305, i.e. `vite preview --host <docker bridge IP> --port 5305`)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
HOME_DIR="${RH_MOBILE_HOME:-$HOME/.rh-mobile}"
IMAGE=rh-lab-android-emu
NAME=rh-lab-mobile
AVD=rh-phone
SYSIMG='system-images;android-37.0;google_apis;x86_64'
RAM="${RH_MOBILE_RAM:-4096}"
GPU="${RH_MOBILE_GPU:-swiftshader_indirect}"
GAME="${RH_MOBILE_GAME:-host.docker.internal:5305}"
# cmdline-tools from dl.google.com/android/repository/repository2-3.xml (sha1 published there)
CLT_ZIP=commandlinetools-linux-16111833_latest.zip
CLT_SHA1=e025545c62a8e64c7559119566a569fb1dec5f60

dexec() { docker exec "$NAME" "$@"; }

case "${1:-}" in
  build)
    docker build -t "$IMAGE" "$HERE"
    ;;
  setup)
    mkdir -p "$HOME_DIR/sdk/cmdline-tools" "$HOME_DIR/avd" "$HOME_DIR/dl"
    if [ ! -x "$HOME_DIR/sdk/cmdline-tools/latest/bin/sdkmanager" ]; then
      curl -fsSL -o "$HOME_DIR/dl/$CLT_ZIP" "https://dl.google.com/android/repository/$CLT_ZIP"
      echo "$CLT_SHA1  $HOME_DIR/dl/$CLT_ZIP" | sha1sum -c -
      rm -rf "$HOME_DIR/dl/x" && mkdir "$HOME_DIR/dl/x" && unzip -q "$HOME_DIR/dl/$CLT_ZIP" -d "$HOME_DIR/dl/x"
      mv "$HOME_DIR/dl/x/cmdline-tools" "$HOME_DIR/sdk/cmdline-tools/latest"
    fi
    docker run --rm -v "$HOME_DIR/sdk:/sdk" -v "$HOME_DIR/avd:/avd" "$IMAGE" setup "$SYSIMG"
    ;;
  up)
    if docker ps --format '{{.Names}}' | grep -qx "$NAME"; then echo "already running"; exit 0; fi
    docker rm "$NAME" >/dev/null 2>&1 || true
    "$REPO/tools/assets/memguard.sh" $((RAM + 8192 + 2000))
    if [ ! -f "$HOME_DIR/avd/$AVD.ini" ]; then
      docker run --rm -v "$HOME_DIR/sdk:/sdk" -v "$HOME_DIR/avd:/avd" "$IMAGE" create "$AVD" "$SYSIMG" pixel_7
      # a hardware keyboard would hide the on-screen keyboard; the lab wants the phone experience
      sed -i 's/^hw.keyboard=.*/hw.keyboard=no/' "$HOME_DIR/avd/$AVD.avd/config.ini"
      grep -q '^hw.keyboard=' "$HOME_DIR/avd/$AVD.avd/config.ini" || echo 'hw.keyboard=no' >> "$HOME_DIR/avd/$AVD.avd/config.ini"
    fi
    # NAT only: the default bridge network; the adb server port is published on the host's loopback only.
    # The memory cap covers the guest RAM plus the emulated GPU (SwiftShader keeps the guest's textures and
    # buffers in the emulator process): a 4 GB guest running the game has passed 9.8 GB.
    docker run -d --name "$NAME" --device /dev/kvm --memory "$((RAM + 8192))m" \
      --add-host host.docker.internal:host-gateway -p 127.0.0.1:5037:5037 \
      -e GAME="$GAME" -v "$HOME_DIR/sdk:/sdk" -v "$HOME_DIR/avd:/avd" \
      "$IMAGE" run "$AVD" "$RAM" "$GPU" >/dev/null
    echo -n "booting"
    for _ in $(seq 1 180); do
      if docker logs "$NAME" 2>&1 | grep -q '^ready'; then echo; docker logs "$NAME" 2>&1 | tail -n 3; exit 0; fi
      if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then echo; docker logs "$NAME" 2>&1 | tail -n 20; exit 1; fi
      if docker exec "$NAME" grep -q "^FATAL" /tmp/emulator.log 2>/dev/null; then echo; docker exec "$NAME" grep "^FATAL" /tmp/emulator.log; exit 1; fi
      echo -n .; sleep 2
    done
    echo " timed out"; exit 1
    ;;
  down)
    docker stop -t 20 "$NAME" >/dev/null 2>&1 || true
    docker rm "$NAME" >/dev/null 2>&1 || true
    echo "stopped"
    ;;
  status)
    docker ps -a --filter "name=^$NAME\$" --format '{{.Names}} {{.Status}}'
    dexec adb devices 2>/dev/null || true
    ;;
  adb)
    shift; docker exec -i "$NAME" adb "$@"
    ;;
  profile)
    # CSS viewport = pixels / (density / 160)
    case "${2:-}" in
      phone)       sz=1170x2532; dpi=480; rot=0 ;;  # 390 x 844
      phone-land)  sz=1170x2532; dpi=480; rot=1 ;;  # 844 x 390
      tablet)      sz=1600x2560; dpi=320; rot=0 ;;  # 800 x 1280
      tablet-land) sz=1600x2560; dpi=320; rot=1 ;;  # 1280 x 800
      native)      dexec adb shell wm size reset; dexec adb shell wm density reset; exit 0 ;;
      *) echo "profile: phone | phone-land | tablet | tablet-land | native"; exit 1 ;;
    esac
    dexec adb shell wm size "$sz"
    dexec adb shell wm density "$dpi"
    dexec adb shell settings put system accelerometer_rotation 0
    dexec adb shell settings put system user_rotation "$rot"
    ;;
  shot)
    out="${2:?output png}"
    docker exec "$NAME" adb exec-out screencap -p > "$out"
    ;;
  *)
    sed -n '2,20p' "$0"; exit 1
    ;;
esac
