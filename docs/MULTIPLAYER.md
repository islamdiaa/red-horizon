# Multiplayer and verified leaderboards

Red Horizon plays online with up to four players, and ranks Daily Challenge, Survival and challenge scores on
global leaderboards that cannot be faked by editing a number. Both run on one small server, the **relay**
(`server/`), which you host yourself next to the game. There are no accounts and no database.

## How it works

### Lockstep

The simulation (`src/sim`) is deterministic: the same start and the same orders give the same battle, tick for
tick. Multiplayer builds on that.

- **Every client runs the whole simulation.** Nobody sends unit positions; players only exchange orders.
- **Orders are scheduled ahead.** An order given at tick *T* runs at tick *T + delay*. The delay adapts to the
  room's round-trip times and jitter, between 100 and 250 ms (2 to 5 ticks at 20 Hz). It rises at once when the
  network gets worse and comes down a step at a time.
- **The relay orders everything.** Each client sends its orders together with a commit: "nothing more from me for
  ticks up to *U*". Once every player has committed a tick, the relay closes it and sends its orders to everyone,
  in one order (tick, seat, arrival). A client steps from tick *T* only once *T* is closed. So all clients run
  the same orders at the same ticks.
- **Commands are checked on arrival.** Every client rebuilds each command field by field
  (`src/net/commands.ts`). The issuing player is always the sender's seat, whatever the message claims. Type ids
  must exist, coordinates must be finite and in range. All clients drop exactly the same commands.
- **AI players run on every client.** AI players, and the AI that takes over a dropped player, run inside the
  simulation like everything else.

### Desync detection

Every 5 seconds (100 ticks) each client reports a hash of its world to the relay. The hash covers the RNG, the
economy, every unit, structure and projectile, and the ore (`src/replay/hash.ts`). If two hashes for the same
tick differ, the relay stops the match for everyone. Each player then sees a dialog with:

- the tick;
- every player's hash;
- buttons to save the replay (to the Replays list) or download it as a file.

### The same maths everywhere

JavaScript fixes `+ - * /` and `Math.sqrt` bit for bit, but not `Math.sin`, `cos`, `atan2`, `pow` or `log2`. Engines
differ in the last bit: Node 22 and Chromium 156, both V8, disagree on almost all of them. A one-bit difference in
a unit's heading is enough to change a battle.

Multiplayer matches and ranked runs therefore use portable versions of the functions the simulation calls
(`src/net/dmath.ts`):

- they use the classic fdlibm algorithms, built only from exactly specified operations;
- they agree with the engine's own to within about one unit in the last place;
- they produce bit-identical results in Node and Chromium (checked by `tests/browser/leaderboard.mjs`).

The game switches to them while such a match runs, and so does the leaderboard server. New matches and runs
record it in their setup (`dmath: true`), so their replays, branches and saves use them too, while older
recordings without the field keep the engine's maths and replay exactly as they were played. Skirmishes, the campaign and the other single-player modes keep the engine's maths, so their simulation is
unchanged.

### Stalls, reconnects and drops

- **A slow or lost player pauses the match.** It stalls naturally: nobody can step past the last closed tick.
  After 2.5 s everyone sees who they are waiting for, and why: still loading, lost the connection, or not
  responding.
- **Dropped connections reconnect.** The client retries with backoff and resumes its seat with its token. The
  relay keeps every closed order of the match. It sends the missing ones, and the client re-sends what never
  arrived.
- **A reloaded page can rejoin.** It rebuilds the match from the start and re-simulates it from the relay's
  buffer, quickly and without effects, until it catches up. The seat token lives in `sessionStorage`, so only
  that tab can rejoin.
- **A player who does not come back is replaced by the AI.** After 20 s of stalling, the other players may drop
  the stalled player. The relay does it by itself after 60 s without a connection, or after 90 s without
  progress. The takeover happens at the same tick on every client and is recorded in the replay.
- **A hidden tab does not stop the match.** While it is in the background it keeps committing ahead (it issues
  nothing meanwhile), and it catches up when it is shown again.

### Modes and setup

| Mode | Players |
|---|---|
| 1 vs 1 | two players |
| 2 vs 2 | four seats in two teams; any seat can be an AI |
| Free for all | three or four commanders, each for himself |
| Co-op vs AI | players on one team against one to three AI commanders |

In the lobby, the host chooses:

- Commander or Classic rules;
- mutators;
- a generated or curated map;
- credits, the starting units and fog;
- a build-up ceasefire and battlefield events.

Every player picks a faction (or Random, drawn from the match seed). Under Commander rules each player also
picks a doctrine.

Only players with the **same build** can share a room: the version, the protocol and a hash of the rule tables
(`src/net/fingerprint.ts`). They also need the **same mod set**: the room shows its mod set hash, and a player
with other mods is told to match them.

### Verified leaderboards

The Daily Challenge, the three Survival fronts (solo and co-op with AI allies) and the built-in scenario
challenges have global boards with daily tops.

1. **The game records the run.** It keeps every order of the run and, at the end, the tick, the world hash and
   the mission score.
2. **The player chooses to submit.** A card offers it after the run. The Leaderboards screen (Challenges →
   Leaderboards) also offers the last run that was not sent.
3. **The server re-simulates the run.** It never takes a setup from the client: it rebuilds the board's setup
   from the board id, feeds the orders into the same engine (bundled from `src/`), and runs it headless.
4. **The score counts only if everything matches.** The run must end at the claimed tick, with the same hash
   and the same score.

The commands are the only thing a player controls, and the simulation computes whatever score they earn. Editing
the score, the result or a single order makes the run fail.

Verification is bounded:

- one run at a time, in a worker thread with a heap cap and a time limit;
- a short queue, after which new submissions are turned away;
- a per-address rate limit.

Boards are kept in a JSON file on a volume: the top 50 per board and day, for 30 days, with a size cap. One entry
per player and board-day, the best one.

### Privacy and security

- **No accounts, no e-mail, no personal data.** A callsign (cleaned with the untrusted-text rules and capped at
  20 characters) is shown to your room and on boards you submit to. The leaderboard server stores a salted hash
  of a random per-browser id, never the id itself.
- **IP addresses stay in the relay's memory**, for rate limits only. They are never logged or written to disk.
- **Untrusted text is cleaned.** Chat is cleaned and capped at 160 characters on the relay, rate-limited, and
  escaped again in the UI. Every player can mute one player or all chat.
- **Limits on the relay:** room size, message size (16 KB), messages and chat lines per connection, connections
  per address, rooms, joins per address (against code guessing), heartbeats with timeouts, and origin checks on
  WebSocket and HTTP.
- **Invite codes** are six characters from a 31-letter alphabet without look-alikes (about 887 million codes).
  An invite link carries the code in the URL fragment (`#join=CODE`), which browsers never send to a server.
- The relay container is as hardened as the game's: an unprivileged user, a read-only root filesystem, no
  capabilities, no privilege escalation, and memory and process limits.

## Self-hosting with Docker Compose

`docker-compose.yml` defines two services:

- **`red-horizon`**: the game, nginx on port 8091.
- **`relay`**: the relay and the leaderboards, not published on the host.

The game's nginx proxies `/relay/` (including the WebSocket upgrade) to the relay. Players therefore connect to
the game's own address, and the CSP stays `connect-src 'self'`.

```bash
docker compose up -d --build          # http://localhost:8091, Multiplayer in the main menu
docker compose logs -f relay          # counts and events only (no names, chat or addresses)
```

The leaderboards live in the `relay-data` volume (`/data/leaderboard.json`). Back it up, or delete it to reset the
boards. Without the relay, the game still works: the Multiplayer screen then shows "Server unavailable".

The relay must be built from the same commit as the game. Leaderboards only verify runs of the server's own
build, and players need the same build to share a room.

### Reaching it from the internet

Exposing the server is your choice; nothing is published beyond port 8091 on your host. If you do, put it behind
a reverse proxy that terminates HTTPS, for example Nginx Proxy Manager, Caddy, Traefik or a Cloudflare Tunnel, and
forward everything (including `/relay/`) to the game container. The proxy must:

- **pass WebSocket upgrades.** In Nginx Proxy Manager, enable "Websockets Support". Cloudflare Tunnels pass them by
  default.
- **keep the `Host` header.** The relay accepts browsers whose `Origin` matches the requested host. If your proxy
  rewrites `Host` (a Cloudflare Tunnel with `httpHostHeader`, for example), list your public origin in
  `RELAY_ALLOWED_ORIGINS`.
- **allow long-lived connections.** Use an idle timeout above 30 s; the relay sends a heartbeat every 2 s.

The relay's per-address limits see the address nginx reports (`X-Real-IP`). Behind a tunnel, that is the tunnel's
address. Configure nginx's `real_ip` module for your proxy if you want per-player limits there.

### Configuration

The relay reads these environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `RELAY_PORT` / `RELAY_HOST` | `8787` / `0.0.0.0` | Listen address |
| `RELAY_BASE` | `relay` | URL prefix of every route |
| `RELAY_ALLOWED_ORIGINS` | (none) | Extra browser origins, comma-separated, e.g. `https://mygame.vercel.app` |
| `RELAY_TRUST_PROXY` | `0` (compose: `1`) | Take the client address from `X-Real-IP` |
| `RELAY_MAX_ROOMS` / `RELAY_MAX_CONNECTIONS` / `RELAY_MAX_PER_IP` | `200` / `1000` / `12` | Capacity limits |
| `RELAY_RECONNECT_GRACE_MS` | `60000` | How long a disconnected player keeps the seat |
| `RELAY_DROP_VOTE_MS` / `RELAY_AUTO_DROP_MS` | `20000` / `90000` | When a stalled player can be dropped, or is dropped |
| `LB_ENABLED` | `1` | Leaderboards on or off |
| `LB_FILE` | `/data/leaderboard.json` | Where the boards are stored (`''` keeps them in memory) |
| `LB_TIMEOUT_MS` / `LB_QUEUE` / `LB_WORKER_MB` | `60000` / `4` / `384` | Verification time limit, waiting runs, worker heap |
| `LB_MAX_TICKS` | `108000` | Longest run verified (90 minutes) |
| `LB_TOP` / `LB_KEEP_DAYS` / `LB_SUBMITS_PER_HOUR` | `50` / `30` / `30` | Board size, retention, submissions per address |

### Without Docker

```bash
npm ci --prefix server
npm run build --prefix server          # bundles server/dist/relay.mjs and verify-worker.mjs
RELAY_PORT=8787 LB_FILE=./data/leaderboard.json node server/dist/relay.mjs
```

Proxy `/relay/` on the game's origin to it, as `docker/nginx.conf` does. You need the WebSocket upgrade headers,
`proxy_set_header Host $http_host` and `X-Real-IP`.

## The game on Vercel (or another static host)

A static host cannot run the relay, so run the relay somewhere else, for example on your server with Docker. Then
point the game at it:

1. **Build the game with the relay's address.** Set it as a build-time environment variable (in Vercel: Project
   Settings → Environment Variables):

   ```
   VITE_RELAY_URL=https://relay.example.com/relay
   ```

2. **Allow that origin in the game's CSP.** In `vercel.json`, add the relay's origin, for both HTTPS and secure
   WebSockets, to `connect-src`:

   ```
   connect-src 'self' https://relay.example.com wss://relay.example.com
   ```

   Keep every other directive as it is.

3. **Let the relay accept the game's origin**, and serve the relay over HTTPS:

   ```
   RELAY_ALLOWED_ORIGINS=https://your-game.vercel.app
   ```

   The relay then also answers the leaderboard API with CORS headers for that origin, and only for it.

Without `VITE_RELAY_URL`, a Vercel deployment simply has no multiplayer. The menu reports that no server answers.

### Cloudflare

- **Cloudflare Tunnel** in front of the Docker setup: route the hostname to `http://red-horizon:8080` (or the host
  port 8091). Everything, including `/relay/`, then goes through the game's nginx. WebSockets work without extra
  settings.
- **The relay on its own hostname behind Cloudflare:** proxy the WebSocket through Cloudflare, which is supported
  on every plan. Keep the "Under Attack" or bot challenge off for that hostname, because WebSocket clients cannot
  solve a challenge. Then follow the Vercel steps for `VITE_RELAY_URL`, the CSP and `RELAY_ALLOWED_ORIGINS`.
- **Cloudflare Pages** for the game: the same as Vercel. Put the CSP in a `_headers` file with the extra
  `connect-src` origins.

## Development and tests

```bash
npm ci --prefix server                                 # ws (and esbuild for the bundle)
RELAY_PORT=5287 node --import tsx server/src/main.ts   # a relay for a dev server that proxies /relay to it
node --import tsx --test tests/net.test.ts tests/relay.test.ts tests/leaderboard.test.ts
node tests/browser/multiplayer.mjs http://127.0.0.1:5277/   # two browser pages play through the relay
node tests/browser/leaderboard.mjs http://127.0.0.1:5277/   # a browser run verified by the server
```

The browser tests need a dev server that proxies `/relay` to a running relay, and Playwright's Chromium. A
`tools/vite.<name>.config.ts` with `server.proxy: { '/relay': { target: 'http://127.0.0.1:5287', ws: true } }`
does it.

- **Virtual-time tests.** `tests/net-harness.ts` runs the relay in-process with headless clients on a virtual
  network: latency, jitter, induced delay, dropped links and frozen clients, all on a virtual clock. Five
  simulated minutes of a four-player match run in a few seconds.
- **WebSocket and HTTP tests.** The tests that use the real WebSocket and HTTP server are skipped until the
  server's dependencies are installed.

## Known limits

- **Other browsers.** The simulation's maths is portable, but mixed-browser matches are only tested between
  Chromium and Node so far. Firefox and Safari are expected to agree, because the arithmetic they share is exactly
  specified. A mismatch would show up as a desync (with the replay to study) or a rejected leaderboard run, never
  as a silent difference.
- **Restarted relay.** The relay keeps rooms and matches in memory, so a restart ends running matches. The
  leaderboards survive in their file.
- **No moderation of callsigns** beyond the cleaning rules. The operator can edit or delete the leaderboard file.
- **No persistent identity across devices.** A player's leaderboard entries are tied to a random id in one browser.
  Clearing site data starts a new one.
