# Real-hardware testing checklist

Automated tests run headless, on a software GPU, without touch screens, gamepads or speakers. This list covers
what only real devices can show. Each item says what to try and what "good" looks like. Tick what you checked
and report anything else, using the steps in [Reporting a problem](#reporting-a-problem).

Before you start:
- Use a recent Chrome, Edge, Firefox or Safari.
- Start from the main menu with default settings, or note what you changed.
- Note how long each session lasts. Some problems (memory, heat, audio drift) only show after 20–30 minutes.

## Reporting a problem

1. Open **Settings › Accessibility › Copy diagnostics**. After a crash, use **Copy diagnostics** on the
   "Something went wrong" screen.
2. Paste the report into the bug report, along with:
   - what you did;
   - what you expected;
   - what happened;
   - a screenshot or short video if you can.

The report is plain text and you can read it before sending. It holds:
- the game and simulation versions;
- the browser and operating system;
- the GPU and screen size;
- the main settings;
- the status of the HD models and terrain;
- recent errors and warnings.

It never includes your callsign or profile name. Nothing is sent anywhere: the button only copies the report to
the clipboard. If copying is blocked, the report is printed to the browser console (F12, then Console).

## Touch: tablet

Use an iPad or Android tablet, landscape, in a browser tab and then from the home screen (installed app).

| Try | Good looks like |
|---|---|
| Tap units and buildings, then tap the ground | Selection rings appear and units move. No accidental box select. |
| Drag with one finger; pinch; twist with two fingers | The camera pans, zooms and rotates smoothly, without jumping. |
| Hold on the map (about half a second) | The order menu opens under your finger. Stop, scatter, deploy, stance and formation all work. |
| Use the toolbar: Box, Add, Attack, Force, Guard, Patrol, Stop, All | Each mode is clearly shown as on or off, and works on the next tap. |
| Build from the build bar; hold a card | Tapping builds; holding cancels or holds. Placing a structure works with one tap. |
| Settings › Interface size at 80% and at 150% | Every panel stays on screen. Buttons stay at least finger-sized at 80%. Nothing overlaps the build bar at 150%. |
| Play for 20 minutes | No growing lag, no reloads, and the tablet doesn't overheat badly. |

## Touch: phone

Use a recent iPhone and an Android phone, in landscape.

| Try | Good looks like |
|---|---|
| Open the game in portrait | You're asked to rotate, or the menu still fits. |
| Main menu, skirmish setup, Settings | All controls are reachable, scrolling works, and no text is cut off. |
| A Quick Battle | You can select, move, build and win without a mouse. The HUD leaves enough map visible to play. |
| Turn the phone, then turn it back | The layout follows, and the game doesn't restart. |
| Switch to another app for a minute and come back | The game is paused or still running, and the sound comes back. |

## Gamepad: Xbox and PlayStation

Connect over USB and over Bluetooth, in Chrome and Firefox.

| Try | Good looks like |
|---|---|
| Menus: D-pad, A (Cross), B (Circle), Start | The focus moves logically, the highlight is easy to see, A activates and B goes back. |
| Battle: left stick cursor, right stick camera, LT and RT zoom | The cursor and camera move smoothly, with no drift when the sticks are released. |
| A to select (hold for a box), X to command, Y to deploy | Each button works the first time it's pressed. |
| D-pad in the build bar: A builds, X cancels, Y loops | The focused card is clearly marked, and building works without the mouse. |
| LB / RB idle units and groups; L3 / R3 | They match the in-game Controls list. |
| Unplug the pad mid-battle, then plug it back in | The game pauses or carries on safely, and the pad works again. |

## GPU and quality presets

Try at least one of each: integrated graphics (Intel or AMD laptop), a mid-range discrete GPU, a high-end
discrete GPU, and an Apple Silicon Mac.

| Try | Good looks like |
|---|---|
| First launch (clear site data first) | The automatic quality fits the GPU: Low on weak or integrated chips, High on discrete ones. |
| The same 150-unit battle on Low, Medium and High | Low stays above 50 FPS on integrated graphics; Medium above 50 on mid-range; High above 50 on high-end. The FPS chip shows the numbers. |
| HD models on and off (Settings › Model detail) | HD buildings and vehicles load within seconds, and switching back never leaves holes. |
| Terrain on Medium and High | Ground textures replace the flat colours within a few seconds. Copy diagnostics shows the terrain as `ready`. |
| Zoom all the way in and out; rotate | No flicker, z-fighting, missing shadows or black screens. |
| Alt+Tab away and back, or sleep the laptop | The picture comes back without a reload (WebGL context restore). |

## Audio

Use speakers and headphones. On phones, try with the mute switch on and off.

| Try | Good looks like |
|---|---|
| Click anything on the first screen | Menu music starts after the first click or tap, not before. |
| Settings › Audio sliders | Each channel changes on its own, and Master changes everything. |
| A battle with lots of explosions | No crackling, dropouts or clipping. The announcer is heard over the battle. |
| The announcer: "Construction complete", "Base under attack" | Each line is spoken once and also shown as a subtitle at the bottom (Settings › Subtitles). |
| Switch tabs, then come back | The sound pauses or continues cleanly, without a burst of queued sounds. |

## Accessibility settings

| Try | Good looks like |
|---|---|
| Settings › Team colours: Colour-blind, then You vs enemies | Units, minimap dots, health bars and selection rings change at once. In "You vs enemies" every enemy is orange. |
| Health bars | The 25% and 50% tick marks are visible on every bar, at every zoom. |
| Interface size 80%, 100%, 150%, in both layouts (Modern and Classic) | Everything scales together. Nothing is clipped at 1280×720 or on a 4K screen. |
| Subtitle size S to XL | The announcer captions and the radio panels grow, and stay readable over snow and desert maps. |
| Controls › Customise keys: rebind Attack-move, then use it in a battle | The new key works, the old one doesn't, and the in-game Controls list and the HUD buttons show the new key. "Reset all to defaults" restores everything. |
| Use only the keyboard in the menus (Tab, Shift+Tab, Enter, Esc) | A yellow focus ring is always visible. Tab never gets lost behind a menu. Esc goes back and Enter activates. |
| A screen reader (NVDA, VoiceOver or TalkBack) in the menus | Buttons and switches are announced with their names, and announcer lines and radio messages are read out. |

## Multiplayer across two devices

Use two different devices, for example a desktop and a laptop, or a PC and a tablet, on different networks if
possible.

| Try | Good looks like |
|---|---|
| Host creates a room and shares the code or link; the guest joins | The guest joins within a few seconds. Both see the same seats, factions and settings. |
| Play a 1 vs 1 for at least 10 minutes | Both screens show the same battle. No "desync" message, and orders respond within about a quarter of a second. |
| Turn the guest's Wi-Fi off for 10 seconds, then on | The match stalls and then resumes, or the guest is dropped cleanly, with a clear message. |
| Different versions (one device on an old tab) | The room refuses to mix builds, with an explanation. |
| Finish a ranked run and submit it | The score appears on the leaderboard after the server checks it. |

## Offline install (PWA)

| Try | Good looks like |
|---|---|
| Install from the browser (address-bar install button, or Share › Add to Home Screen) | The app opens in its own window with the game's icon and name. |
| Settings › HD content for offline play › Download | The progress finishes and shows the size and date. |
| Turn the network off and start the installed app | The menu opens and a skirmish starts, with HD models and terrain if they were downloaded. |
| Publish an update, then reopen the app | The update is offered or applied, without losing saves, settings or key bindings. |

## The itch.io build

| Try | Good looks like |
|---|---|
| Upload `release/red-horizon-itch-<version>.zip` as an HTML game and open the page | The game loads inside the itch.io frame, without console errors about blocked files. |
| Fullscreen button on itch.io, then Alt+Enter in game | Both work, and edge scrolling works in fullscreen. |
| Share links and clips | Share links point to the itch.io page, and clips download. |
| Reload the page with the network off | It still loads after the first visit (service worker inside the frame). |

## The desktop build (Electron)

Try Windows (installer and zip), macOS (dmg) and Linux (AppImage), as built by `npm run desktop:build`.

| Try | Good looks like |
|---|---|
| Install and start it | It opens a window with the game, with no browser bars and no security warnings beyond the unsigned-app prompt. |
| Fullscreen (F11 or Alt+Enter), then a battle | Edge scrolling works on every monitor edge, and Esc leaves fullscreen only when asked. |
| Settings, saves and key bindings | They stay after closing and reopening the app. |
| Gamepad and audio | They behave as in the browser. |
| Copy diagnostics | It reports the Electron version in the browser line, and the GPU. |
