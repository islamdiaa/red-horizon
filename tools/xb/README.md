# Cross-browser and test-VM checks

These scripts run the game in Chromium, Firefox and WebKit on the host's GPU, in the rig's container
(`tools/gpu-rig/Dockerfile.xb`, run through `rig.sh`). They also run in the test VMs (`tools/lab/lab.sh run <vm> ...`),
where they cover Chrome, Edge and Firefox on Windows (Direct3D 11 through ANGLE) and the low-end Ubuntu VM. All of them
take a production build. In a VM, `KEY=value` arguments become environment variables, because `lab.sh` forwards
arguments but not the environment.

| Script | Where | What it does |
|---|---|---|
| `rig.sh` | host | Runs a script in the cross-browser rig after `memguard.sh`, under a lock file. `XB_DISPLAY=weston` gives a GPU-backed display server for headful Firefox and WebKit. |
| `probe.mjs` | rig | WebGL2 per engine: renderer, the extensions the game uses, limits, and whether float colour buffers render |
| `matrix.mjs` | rig | Per engine: `boot` (time to the menu, CSP, Quick Battle by click, audio unlock, fullscreen, service worker, offline reload), `input` (wheel, clicks, box select, right click, control groups, arrows, Esc), `battle` (frame times and the HDR scan per preset), `look` (fixed scenes for `compare.mjs`) |
| `compare.mjs` | host | Compares look grids against a reference renderer: per-channel and luminance differences, the share of cells that differ |
| `vmlook.mjs` | VM | The look scenes in any browser in a VM, e.g. Chrome or Edge on D3D11 WARP (`CHROME_ARGS=--use-angle=d3d11 --ignore-gpu-blocklist`) |
| `vmsweep.mjs` | VM | The rig's correctness sweep (`env`, `fx`, `ctxloss`, `models`) in any browser in a VM |
| `soak.mjs` | VM | Two-hour soak: three cycles of a ceasefire build-up at 2x, a battle at 5x, results and Play again by a click. Logs heap, browser memory, renderer resources, DOM nodes, event listeners on attached targets and frame time every minute. |
| `leakcheck.mjs` | VM | Chromium: live instances of the match's main classes after forced garbage collection, over several Play again cycles. Every count must stay at its first-match value. |
| `lowend.mjs` | VM | A 300-unit battle at 1x, 2x and 5x: frame rate and cost, simulation ms per tick, main-thread ms per subsystem, ticks per second against the target, input delay, long tasks |
| `pwa.mjs` | VM | Chrome / Edge: the service worker, installability (DevTools), `PWA.install` and launch, then offline: menu and a Quick Battle |
| `hidpi.mjs` | VM desktop | Headed, at the OS display scale (`lab.sh display win11 1920x1080 150`): pixel ratio, canvas backing size, layout outside the window, screenshots |
| `vme2e.sh` | host → VM | Copies `tools/e2e` and `tools/xb` into a VM's Playwright folder and runs a script that needs the E2E bot there |
| `vmplay.mjs` | VM | The E2E bot plays a mode in real time through the UI (skirmish, campaign, co-op): frame rate, game clock against real time, input to next frame, memory and renderer resources every minute |
| `vmmenus.mjs` | VM or rig | Every main-menu screen in each locale the browser announces: raw keys, clipped or off-screen text, sideways scrolling, screenshots |
| `vmload.mjs` | VM | Where the loading time goes on a slow machine: the menu, then each loading-screen stage of a match, with long tasks |
| `vmnotice.mjs` | VM | The "graphics acceleration is off" notice on a software renderer: shown by itself, hidden in battle, dismissed for good |
| `vmcold.mjs`, `vmctxdiag.mjs` | VM | Cold launches (a fresh browser each time): menu or "can't start", WebGL 2 retries; and why a first context fails, per Chromium flag set, on a blank page |
| `settingsprobe.mjs` | VM or rig | Clicks every enabled Settings control in turn and records console errors per control |
| `memcycle.mjs` | rig | Quick Play again cycles; after each, the browser's memory per process split by kind from `/proc/<pid>/smaps` (GPU buffers on the render node, anonymous memory, heap, files, shared memory), with renderer resource counts. `EXTRA_INIT_FILE` adds an init script for A/B experiments |
| `soakseg.mjs`, `soakseg.sh` | rig | `soak.mjs` in segments for a shared machine: one page, active only while the driver holds the shared lock for a segment, idle between |

`probe-core.mjs`, `sweep-core.mjs`, `look-core.mjs` and `vmlib.mjs` are the shared parts. The rig scripts in
`tools/gpu-rig/` use the first two.

Leak checks from Playwright have two traps. An element handle, such as the one `page.waitForSelector` returns, keeps
its element alive, and the element's handlers keep the whole match alive. A DevTools remote object does the same until it
is released. `soak.mjs` and `leakcheck.mjs` avoid both.
