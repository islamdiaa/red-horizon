# Security policy

Red Horizon is a static web game. It has no accounts and no analytics. Settings, saves, replays,
custom maps and mods stay in the player's own browser (localStorage and IndexedDB). The production
build makes no requests to third-party hosts. Online multiplayer and the leaderboards are optional and
go through a small relay (`server/`) that whoever hosts the game runs themselves; it stores no
accounts or personal data.

The attack surface is the content a player can load: map, mission, mod, challenge, replay and save
files, plus URL parameters. All of these are treated as untrusted.
- Imported files go through one hardened parser (`src/platform/untrusted.ts`). It enforces size,
  depth and entry limits, guards against decompression bombs, drops prototype-polluting keys and
  neutralises markup in every string.
- Each format's validator then checks types and ranges.
- Text is escaped again wherever the UI builds HTML.
- Numeric URL parameters are clamped.

The bundled nginx and Vercel configurations add a strict Content-Security-Policy (same-origin only,
no inline or `eval`'d script) and the usual security headers on top.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately through GitHub's
[private vulnerability reporting](../../security/advisories/new) ("Security" tab, then "Report a
vulnerability"). Include:

- what an attacker can do, and under which conditions;
- steps to reproduce, ideally with a sample file or URL;
- the browser and version you tested with.

You should get a reply within a week. Fixes go to the `main` branch; there are no other supported
versions.

## Scope

In scope:
- script execution or HTML injection via an imported file or URL parameter;
- a crafted file that permanently breaks the game, for example by corrupting stored data so it no
  longer starts;
- bypasses of the Content-Security-Policy in the shipped server configurations;
- problems in the service worker (cache poisoning, serving stale code);
- the multiplayer relay (`server/`): crashing it, bypassing its rate and size limits, reading another
  room's traffic, or getting a forged score past leaderboard verification.

Out of scope:
- cheating in single-player modes, including via the browser console or the `?debug` test hooks;
- a crafted file that only makes a single match slow;
- missing headers on a third-party host you deployed to yourself.
