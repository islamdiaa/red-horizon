# Distributing Red Horizon

Red Horizon is a static web app: HTML, JavaScript, fonts, textures and GLB models, with no server and no
accounts. The same build runs from a web host, a game portal, an itch.io page or a desktop wrapper. This page
covers each target and what to check.

**Privacy stays the default everywhere.**
- The game makes no third-party requests and has no analytics.
- Shared links carry their data in the URL fragment, which never reaches a server.
- Clips and trailers are recorded on the player's device.

Keep it that way when you package it: none of the steps below adds a tracker, an ad SDK or a remote service.

## Builds at a glance

| Target | Command | Output | Base path |
|---|---|---|---|
| Web (site root) | `npm run build` | `dist/` | `/` |
| Web (sub-path) | `RH_BASE=/red-horizon/ npm run build` | `dist/` | `/red-horizon/` |
| itch.io, portals, any folder | `npm run build:itch` | `dist-itch/`, `release/red-horizon-itch-<version>.zip` | `./` |
| Desktop (Electron) | `npm run desktop:build` | `desktop/out/` | `./` |

- **Base paths.**
  - Every runtime asset URL goes through `assetUrl()` in `src/platform/paths.ts`, and Vite rewrites the URLs in
    `index.html` (fonts, icons, manifest).
  - So the game runs from the site root, a sub-path or a relative folder without code changes.
  - `tests/paths.test.ts` fails if a root-absolute asset URL (`'/models/…'`) creeps back into `src/`.
- **Relative builds.**
  - The relative builds (itch.io and desktop) inject the game's Content-Security-Policy as a `<meta>` tag, since
    those hosts don't send the headers in `docker/security-headers.conf`.
  - `frame-ancestors` can't be set from a `<meta>` tag, and portals embed the game in a frame anyway.
- **Checking a relative build.** `node tools/release/verify-subpath.mjs dist-itch /games/red-horizon/` serves
  the build from a sub-folder of a plain static server. It checks in headless Chromium that:
  - a match starts;
  - the fonts and HD models load;
  - no request leaves the folder.

## Link previews

`index.html` carries Open Graph and Twitter card tags. Discord, WhatsApp, X, Slack, Telegram and iMessage
read them. The preview image is `public/og/red-horizon-1200x630.jpg`, rendered from the game.

- **Set the public address at build time.** Crawlers need absolute image URLs:
  `RH_SITE_URL=https://example.com/ npm run build` makes `og:image` and `twitter:image` absolute and adds `og:url`
  and a canonical link.
  - On Vercel, the production domain is picked up automatically (`VERCEL_PROJECT_PRODUCTION_URL`).
  - Without a site URL the image path stays root-relative. Discord and most chat apps still resolve it, but
    X needs the absolute URL.
- **GitHub.** The repository's link preview is the *Social preview* image under the repository's
  **Settings → General**. GitHub has no file or API for it. Upload `public/og/red-horizon-1280x640.jpg` there:
  GitHub recommends 1280×640.
- **Test a deployment.** Paste the link into a private Discord channel or a WhatsApp chat to yourself. The
  [Open Graph debuggers](https://developers.facebook.com/tools/debug/) of the big networks also work, but
  they are third-party services, so use them only on a public URL.

## Share links

**What can be shared.**
- Maps from the editor.
- Challenges, from the scenario challenge list.
- Short replays, from the Replays list.

Each has a **Copy link** button. The content is gzip-compressed and base64url-encoded into
`#share=1.<payload>`, so the link *is* the data.

- **Limits.**
  - Links of up to 32,000 characters are accepted.
  - Links under ~1,900 characters also fit in a Discord message.
  - Anything longer falls back to file export, and the dialog says so.
- **Opening a link.**
  - The fragment is decoded as untrusted input (`src/platform/untrusted.ts`): size, depth, value-count and
    inflate caps, inert strings, no prototype keys.
  - The same validator as the file importer runs on it.
  - The player confirms before anything is imported or played.
- **Where links point.** Links point at the page the game runs from. Relative builds (itch.io, desktop) point
  at `RH_SITE_URL` when it was set at build time; otherwise they offer the file instead.

## Clips and the trailer

- **Highlight clips.**
  - **Record clip** is on the results screen's highlights and in the replay viewer.
  - It plays the moment through the cinematic camera and records about 18 s.
  - It records the canvas plus the game's audio mix, in real time at the current graphics quality, through
    `MediaRecorder`.
  - Chrome, Edge and Firefox produce WebM (VP9/VP8 + Opus); Safari produces MP4.
  - On phones the result dialog offers the system share sheet.
- **The trailer.**
  - `?trailer=1` stages a battle and plays an ~85 s cut with title cards, letterboxed. It can record the cut.
  - Options: `&tod=day|dusk|night`, `&climate=temperate|winter|desert`.
  - `&autorecord=1` starts at once. Sound then needs autoplay permission.
  - Record on a machine with a real GPU, in a 1920×1080 window, at the High preset.
- **Uploading.** WebM from `MediaRecorder` has no duration in its header. Discord, X and YouTube accept it.
  For tools that need seeking, remux it once: `ffmpeg -i in.webm -c copy out.webm`, or `-c:v libx264` for MP4.

## itch.io

1. Run `npm run build:itch` and upload `release/red-horizon-itch-<version>.zip`.
2. Set the project's **Kind of project** to *HTML* and tick **This file will be played in the browser**.
3. Set the viewport to 1280×720, and enable **Mobile friendly**, **Automatically start on page load** and the
   **Fullscreen button**.
4. If you can, set **Embed options → Click to launch in fullscreen**. The game is an RTS: it wants the whole screen.

**Constraints:**
- `build:itch` checks itch.io's rules: at most 1,000 files, `index.html` at the root, and no file over 200 MB.
- The zip is about 30 MB, mostly the HD models and terrain textures.
- Upload new versions with [butler](https://itch.io/docs/butler/), e.g.
  `butler push release/red-horizon-itch-0.1.0.zip <user>/red-horizon:html`.
  butler only uploads the changed files.
- Desktop builds can go to the same page as extra channels (`:windows`, `:linux`, `:mac`).
- The service worker still registers inside itch.io's frame, so the game works offline after the first visit.
  Each upload has its own address, so old caches are replaced, not stacked.

## CrazyGames and Poki

Both portals accept HTML5 zips like the itch.io build.

- **Ads.** Both expect their SDK, at least for loading events, and usually for ads.
  - **Red Horizon doesn't include either SDK.** They load third-party scripts, track players and need the CSP
    relaxed.
  - Adding one is an explicit product decision for the maintainer, not a packaging step.
  - It would mean:
    - a separate build flavour;
    - a CSP that allows the SDK's origins;
    - a privacy notice;
    - no change to the default web, itch.io and desktop builds.
- **Requirements to expect.**
  - The initial download size counts. The HD models load lazily and the Low preset uses the procedural models,
    which suits portal limits.
  - Portals want no external links, and the game has none in play.
  - No browser-native fullscreen: the portal frame handles it. Fullscreen is a setting.
  - Pause when the tab is hidden: the game already pauses.
- **Submitting.** Use the relative build (`dist-itch/`) and check it with `tools/release/verify-subpath.mjs`
  first.

## Desktop (Electron)

`desktop/` holds a small Electron wrapper with its own `package.json`, so the game's `npm ci` never downloads
Electron.

```bash
npm run desktop          # build the relative web game into desktop/app and open it in a window
npm run desktop:build    # installers / archives for this OS into desktop/out (electron-builder)
```

The first run installs the wrapper's dependencies (`npm --prefix desktop install`).

- **Security.**
  - The window runs the same sandboxed web page as a browser: no Node.js, context isolation, the sandbox,
    and the CSP `<meta>` tag.
  - Files are served from a private `app://red-horizon/` scheme rooted at `desktop/app`, and paths can't
    escape it.
  - Navigation away is refused. https links open in the system browser.
  - Only fullscreen, pointer lock and clipboard writes are permitted.
- **Data.** Saves, replays and custom maps live in the app's own profile.
- **Targets.** electron-builder makes:
  - an AppImage and a tar.gz on Linux;
  - an NSIS installer and a zip on Windows;
  - a dmg and a zip on macOS.
  Build each OS on that OS (or in CI).
- **Signing.** Unsigned Windows installers trigger SmartScreen, and macOS needs a Developer ID signature and
  notarization (`CSC_LINK` / `APPLE_ID` environment variables for electron-builder).

### Steam

1. Make a Steamworks app with a depot per OS. Upload the unpacked electron-builder output (`desktop/out/*-unpacked`
   on Windows and Linux, the `.app` on macOS) with SteamPipe (`steamcmd +run_app_build`).
2. Set the launch options to the executable: `Red Horizon.exe`, `red-horizon`, or `Red Horizon.app`.
3. The Steam overlay needs GPU compositing to draw over Chromium. If it misbehaves, launch with
   `--in-process-gpu`; test on each OS.
4. Achievements, cloud saves and rich presence would need the Steamworks SDK through a native module (for
   example `steamworks.js`). That's a separate decision: it adds a native dependency and Valve's SDK terms.
   The game runs on Steam without it. Steam Cloud can sync the profile folder by path instead, with no code:
   - `%APPDATA%/Red Horizon` on Windows;
   - `~/.config/Red Horizon` on Linux;
   - `~/Library/Application Support/Red Horizon` on macOS.
5. Steam Deck: the Linux build runs under the Steam Linux Runtime; the game supports gamepads and touch.

### itch.io desktop channels

Push the zipped `desktop/out` archives with butler to `:windows`, `:linux` and `:mac` channels next to the
`:html` one. The itch.io app installs and updates them.

## Vercel

`vercel.json` already sets:
- the build (`npm run build`, output `dist`);
- the security headers (the same CSP as the Docker image);
- the caching rules: `assets/` immutable, `index.html`, `sw.js` and the manifest with `no-cache`.

1. Import the repository in Vercel. No settings are needed: the framework preset is Vite.
2. Link previews pick up the production domain automatically. To use a custom domain in previews and share
   links, set `RH_SITE_URL=https://your.domain/` as an environment variable.
3. Vercel's Web Analytics and Speed Insights are off unless enabled in the dashboard. Leave them off: they would
   add third-party requests and need a CSP change.

## Docker / your own server

`docker compose up -d --build` serves `dist/` with an unprivileged nginx on port 8091.
- **Headers.** The nginx configuration sends the security headers and the caching rules.
- **Link previews.** Set `RH_SITE_URL` at build time for absolute preview URLs (a `--build-arg` passed through
  to `npm run build`).
- **Sub-path.** To serve under a sub-path behind a reverse proxy, build with `RH_BASE=/red-horizon/` and proxy
  `/red-horizon/` to the container.
