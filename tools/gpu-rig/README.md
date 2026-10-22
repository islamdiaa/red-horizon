# Real-GPU rig

Headless Chromium on a real GPU (the host's Mesa driver through ANGLE), for what SwiftShader hides: NaN
behaviour (`normalize(0)`, `pow(<0)`), real shader compilers and real frame times. The image holds Mesa
(iris for GL, ANV for Vulkan), the Chromium system libraries and Node; the repository and the Playwright
browser cache are mounted read-only, so the image never goes stale.

```bash
docker build -t red-horizon-gpu-rig tools/gpu-rig
npx vite build --outDir /tmp/rh-gpu/dist && npx vite preview --outDir /tmp/rh-gpu/dist --port 5291 --host 127.0.0.1 &
RIG="docker run --rm --name red-horizon-gpu-rig --device /dev/dri --network host --memory 3g --shm-size 512m \
  -v $PWD:/game:ro -v $HOME/.cache/ms-playwright:/ms-playwright:ro -v /tmp/rh-gpu:/out red-horizon-gpu-rig"
$RIG tools/gpu-rig/probe.mjs                                   # renderer string per backend: must not say SwiftShader
$RIG tools/gpu-rig/sweep.mjs http://127.0.0.1:5291/ env        # presets x climates x time of day x weather x zoom
$RIG tools/gpu-rig/sweep.mjs http://127.0.0.1:5291/ fx         # superweapons, Tesla, fire, explosions, photo mode
$RIG tools/gpu-rig/sweep.mjs http://127.0.0.1:5291/ models     # every unit and structure, HD on and off
$RIG tools/gpu-rig/sweep.mjs http://127.0.0.1:5291/ ctxloss    # WEBGL_lose_context and restore mid-match
$RIG -e MASK=1 tools/gpu-rig/sweep.mjs http://127.0.0.1:5291/ env medium   # no float colour buffers / float filtering
$RIG tools/gpu-rig/perf.mjs http://127.0.0.1:5291/ low,medium,high 150,300  # FPS and GPU time per pass at 1920x1080
```

- **Backends.** `RIG_BACKEND=gl` (default, ANGLE on GLES/EGL) or `vulkan` (ANGLE on Vulkan): pass it with `-e`.
- **What the sweep checks** after each pass, in every half and float render target: non-finite values, values beyond the half-float range
  (65504), the maximum. It also checks `gl.getError()`, shader compile and link warnings, black and white frames, and frame-to-frame
  flicker of a paused scene. One JSON line per check goes to `/out/sweep-<mode>.jsonl`; `BAD` lines are printed in full.
- **Memory.** Integrated GPUs keep textures in system memory, which counts against the container limit: the High preset needs about 3 GB.
- **Shared machines.** Run one container at a time, after `tools/assets/memguard.sh`.

## Firefox and WebKit

`Dockerfile.xb` builds a second image, `red-horizon-gpu-rig-xb`, from the official Playwright image of the repository's
version. It has Chromium, Firefox and WebKit, plus Weston and PulseAudio. In a container, headless Firefox has no WebGL
and headless WebKit renders WebGL in software, so both run headful as Wayland clients of a headless Weston that
renders with GL on the GPU's render node. PulseAudio gives them a null audio sink. `tools/xb/rig.sh` runs one script in
it after `memguard.sh`, under a lock file. `RIG_ENGINE` picks the browser for the rig's own scripts:

```bash
docker build -t red-horizon-gpu-rig-xb -f tools/gpu-rig/Dockerfile.xb tools/gpu-rig
XB_DISPLAY=weston tools/xb/rig.sh tools/xb/probe.mjs chromium,firefox,webkit       # renderer, extensions, float targets
XB_DISPLAY=weston RIG_ENGINE=firefox TAG=-firefox tools/xb/rig.sh tools/gpu-rig/sweep.mjs http://127.0.0.1:5291/ env
XB_DISPLAY=weston tools/xb/rig.sh tools/xb/matrix.mjs http://127.0.0.1:5291/ all    # boot, input, battle, look per engine
```

Firefox reports a coarse renderer string ("Intel(R) HD Graphics, or similar") and WebKit reports "Apple GPU". Neither
has `EXT_disjoint_timer_query_webgl2`, so GPU times per pass are Chromium-only. See `tools/xb/README.md` for the
cross-browser and test-VM scripts.
