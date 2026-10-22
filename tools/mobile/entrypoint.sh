#!/bin/sh
# Container entrypoint for the Android emulator lab (see README.md).
#   rh-emu setup <system-image>   install platform-tools, the emulator and the system image into /sdk
#   rh-emu create <name> <image> [device]   create an AVD in /avd
#   rh-emu run <name> [ram MB] [gpu]   boot the AVD headless and print "ready"; with GAME="host:port ..." the
#                                    device's http://localhost:<port> reaches each game server
#   rh-emu <anything else>        exec it (sh, adb ..., sdkmanager ...)
set -e
cmd="$1"; [ $# -gt 0 ] && shift
case "$cmd" in
  setup)
    img="${1:?system image, e.g. system-images;android-37.0;google_apis;x86_64}"
    yes | sdkmanager --licenses >/dev/null 2>&1 || true
    sdkmanager --install platform-tools emulator "$img"
    ;;
  create)
    name="${1:?avd name}"; img="${2:?system image}"; dev="${3:-pixel_7}"
    echo no | avdmanager create avd --force -n "$name" -k "$img" -d "$dev"
    ;;
  run)
    name="${1:?avd name}"; ram="${2:-4096}"; gpu="${3:-swiftshader_indirect}"
    # mobile.sh publishes the adb server port on the host's loopback, so the server listens on the container's
    # interfaces (the container itself sits on the NAT bridge).
    # a killed emulator (OOM, docker kill) leaves its locks behind and the next boot refuses to start
    rm -rf "$ANDROID_AVD_HOME/$name.avd/"*.lock
    adb kill-server >/dev/null 2>&1 || true
    adb -a -P 5037 server nodaemon >/tmp/adb.log 2>&1 &
    sleep 1
    emulator -avd "$name" -no-window -no-audio -no-boot-anim -no-snapshot -memory "$ram" \
      -gpu "$gpu" -cores 4 -no-metrics >/tmp/emulator.log 2>&1 &
    emu=$!
    trap 'kill $emu 2>/dev/null; wait $emu' TERM INT
    adb wait-for-device
    until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done
    # a test lab device: the screen never sleeps (Chrome stops rendering when it does)
    adb shell 'svc power stayon true; settings put system screen_off_timeout 2147483647; input keyevent KEYCODE_WAKEUP' >/dev/null 2>&1 || true
    # Game access: the device's http://localhost:<port> (a secure context, so the service worker and the
    # install prompt work) -> adb reverse -> container loopback -> socat -> host:port. GAME may list several.
    for g in $GAME; do
      port="${g##*:}"
      socat TCP-LISTEN:"$port",bind=127.0.0.1,fork,reuseaddr TCP:"$g" &
      adb reverse tcp:"$port" tcp:"$port" >/dev/null
      echo "game: device http://localhost:$port -> $g"
    done
    echo "ready ($(adb shell getprop ro.build.version.release | tr -d '\r'), $(adb shell dumpsys package com.android.chrome | grep -m1 versionName | tr -d ' \r'))"
    wait $emu
    ;;
  *)
    exec "$cmd" "$@"
    ;;
esac
