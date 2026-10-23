# Mobile lab: Chrome on Android in an emulator

Runs the game in real Chrome for Android (an x86_64 Google APIs system image, KVM, no GPU needed) and drives it with
touch: taps and swipes through Android's own input pipeline (`adb input`), pinches and twists through the Chrome
DevTools protocol. It covers what the desktop harnesses can't: touch controls, phone and tablet layouts in both
orientations, the on-screen keyboard, backgrounding, rotation and the installed app.

## Files

| File | What it does |
|---|---|
| `Dockerfile`, `entrypoint.sh` | The emulator container (Ubuntu 24.04, JDK for the SDK tools). The SDK and the AVD live in a mounted folder, so the image stays small. |
| `mobile.sh` | `build`, `setup`, `up`, `down`, `status`, `adb …`, `profile <name>`, `shot <png>` |
| `lib.mjs` | Playwright's Android driver plus touch helpers (`Touch`: CDP multi-touch; `AdbTouch`: real input, calibrated to CSS pixels), screen profiles and HUD audits |
| `run.mjs` | The test matrix (below) |
| `cdp-bridge.mjs` | Chrome's DevTools at `http://127.0.0.1:9222` on the host, for tools that take a CDP URL: `node tools/e2e/run.mjs settings --cdp http://127.0.0.1:9222 --touch --mobile --slow 4` |

## Setup

Needs Docker, `/dev/kvm`, about 8 GB of disk and about 13 GB of free memory while it runs.

```sh
export RH_MOBILE_HOME=/some/persistent/folder        # SDK + AVD, about 7 GB (default ~/.rh-mobile)
tools/mobile/mobile.sh build
tools/mobile/mobile.sh setup                          # cmdline-tools (sha1-checked), platform-tools, emulator, Android 17 image
```

## Run

Serve a production build where the container can reach it, then boot the emulator:

```sh
npx vite build --outDir /tmp/rh-mobile-dist
node tools/e2e/serve.mjs /tmp/rh-mobile-dist 5305 <docker bridge IP, e.g. 172.17.0.1>
RH_MOBILE_GAME="host.docker.internal:5305" tools/mobile/mobile.sh up     # about a minute
node tools/mobile/run.mjs --out /tmp/rh-mobile-report
tools/mobile/mobile.sh down
```

- **The game's address on the device** is `http://localhost:<port>`: `adb reverse` plus a `socat` hop inside the
  container. `localhost` is a secure context, so the service worker and the install prompt work as on a real site.
- **`RH_MOBILE_GAME`** takes several `host:port` pairs, e.g. a deployed server too.
- **Networking:** the container sits on Docker's default NAT bridge. Only the adb server port (5037) is published,
  on the host's loopback.

## The matrix (`run.mjs`)

`--profiles phone-land,phone,tablet-land,tablet` (390×844 and 800×1280 CSS pixels, each in both orientations),
`--only <scenarios>`, `--url`, `--out`, `--every-profile` (every scenario on every profile; by default only `menus`,
`match`, `rotate` and `campaign` do), `--mission-minutes` (the campaign scenario's touch play). Each scenario starts Chrome fresh with empty storage.

| Scenario | Checks |
|---|---|
| `menus` | Main menu, Skirmish, Settings, Campaign: no sideways scrolling, nothing off screen, tap targets, Android Back |
| `match` | Quick Battle by tap, tap to skip the intro, HUD panels don't overlap, no invisible element over the map, how much of the screen the HUD covers, the battlefield is drawn, card and button sizes |
| `gestures` | Drag to pan (also with slow frames), tap to select, tap to move, hold for the order ring, pinch, twist, hold-and-drag box select |
| `build` | Deploy the MCV from the selection panel, buy a Power Plant from the build bar, place it with a tap |
| `perf` | Low preset and Auto render scale picked on first launch, frame rate, simulation speed |
| `lifecycle` | Home for 30 s and back, WebGL context loss and restore |
| `rotate` | Rotating mid-match keeps the match and resizes the canvas |
| `keyboard` | The on-screen keyboard opens for text fields and doesn't cover them |
| `pwa` | Installable, service worker, the menu and a match offline, Add to Home screen and launch from the icon |
| `campaign` | Campaign screen: the difficulty picker (fits, finger-sized, a new player starts on Easy, a tap picks and stores a level, remembered), the briefing readable; Allied mission 1 deployed at Easy (the level reaches the mission and its objectives panel), mission HUD audit, pause and resume with Back; then played by touch: MCV deployed from the selection panel, Power Plant, Barracks and Refinery bought and placed by tap, a Field Manual battle alert (idle Barracks) checked in both orientations (on screen, readable, its × finger-sized, taps and drags beside it reach the map, the text does not dismiss it, the × does), Rocket Soldiers trained and the army sent with All, Attack and a tap until the mission ends or `--mission-minutes` runs out |
| `pickerprobe` | Triage: where a real tap and a CDP touch on the campaign difficulty picker land (pointer and click targets), and whether they pick the level |

## Notes

- **Speed:** the emulator renders WebGL with SwiftShader on the CPU, so the game runs at a few frames per second.
  Frame rates are only good for comparisons; timing-sensitive checks fast-forward the game or use event
  timestamps.
- **Memory:** the emulator's host process keeps about 1 GB of GPU memory from every Chrome that is killed while it
  ran the game. `run.mjs` reboots the emulator when it grows past `--restart-gb` (8.5 GB).
- **First-run sheets:** `lib.mjs` grants Chrome's notification permission and confirms Android's full-screen
  notice, so neither swallows the first taps.
- **Profiles:** `mobile.sh profile` changes the screen size and density. A density change restarts Chrome, so set
  the profile before connecting. Rotation alone (`lib.rotate`) keeps the page.
