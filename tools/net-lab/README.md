# Net lab: multiplayer over real and bad networks

Tools to test the relay and the lockstep (src/net, server/) the way players hit them: two real browsers playing a
full match through the game's nginx and the relay, with each player's link shaped for latency, jitter, loss,
limited bandwidth and outages, plus relay load, relay robustness and leaderboard verification.

Everything runs under its own Docker Compose project `rh-lab-net` on its own internal network and ports — never
the live stack. The game is published on localhost only (and, when asked, on the libvirt NAT so the test VMs can
reach it); nothing is published on the LAN.

## Why a userspace shaper

`tc netem` is the usual way to add delay and loss, but it needs the kernel `sch_netem` qdisc, which some hosts
(including the one this lab was built on: check in a throwaway network namespace before relying on it) are built without.
Containers share the host kernel, so `tc netem`/`tbf` are unavailable inside them here.

`pktem.py` is a dependency-free userspace stand-in. It runs in a small router container between a player's
network and the game's, captures every routed IPv4 packet (AF_PACKET), runs it through a per-direction link
model (delay, uniform jitter, independent loss, a token-bucket rate limit with a tail-drop queue, or a full
outage), and re-injects it with a raw socket. Real TCP runs end to end, so retransmission, congestion control and
head-of-line blocking all behave as on a real link. A stateless 1:1 `/24` NAT sidesteps Docker's rule that drops
packets addressed to a container but arriving on another bridge. The profile is set at run time over a tiny HTTP
control port (no restart), so one match can change conditions mid-flight.

The real VMs (`tools/lab`) do have `tc netem`, so `vm-match.sh` uses it there for corroboration on a real kernel.

## Layout

| File | What |
|---|---|
| `compose.yml` | the `rh-lab-net` stack: relay, game (nginx → relay), two shaper routers, two optional browser peers |
| `pktem.py` | the userspace link shaper (one router per player) |
| `shaper-entry.sh` | router entrypoint: send routed traffic to a blackhole table so only `pktem` forwards it |
| `Dockerfile.tools` | the router/helper image (`iproute2`, `python3`) |
| `netlab.sh` | `build` · `up` · `routes` · `peers-up`/`peers-down` · `shape` · `status` · `down` |
| `peer-server.mjs` | a Playwright browser server for a peer (host GPU, SwiftShader, or Windows D3D11 WARP) |
| `match.mjs` | drives two browsers through the real lobby + match; checks desync, latency, chat, stalls, reconnect, results |
| `profiles.mjs` | the link profiles (LAN, 80/200 ms, 2/5 % loss, 1 Mbit/s, outages, "awful") |
| `run.sh` | runs `match.mjs` jobs under the shared memory guard + heavy lock (browsers start per job, stop after) |
| `relay-load.mjs` | protocol-level bots filling many rooms, sampling relay CPU/memory |
| `relay-robust.mjs` | malformed/oversize/flood/rate/impersonation/replay/origin checks against a lab relay |
| `lb-forge.ts` | plays a real ranked run, submits it, then confirms every tampered variant is rejected |
| `vm-match.sh` | a cross-machine match: a browser in a test VM vs one on the host or in the other VM (real NAT, real `tc netem` on the Ubuntu side, optional Firefox/WebKit engines). Not yet run end to end: the VMs were busy with long soak runs |

## Running

```bash
# build the images and a copy of the game, start the light stack (relay, game, two routers)
tools/net-lab/netlab.sh build
tools/net-lab/netlab.sh up

# a shaped match (browsers start for the run and stop after; held under the memory guard + heavy lock)
tools/net-lab/run.sh "--profile rtt200j50 --churn 90 --fast --tag demo"

# set a link by hand while a match runs
tools/net-lab/netlab.sh shape a '{"both":{"delay_ms":100,"jitter_ms":25}}'
tools/net-lab/netlab.sh shape b '{"both":{"down":true}}'      # pull peer B's cable

# relay load, robustness and leaderboard verification (no browsers)
node tools/net-lab/relay-load.mjs --rooms 30 --four 10 --minutes 5
node tools/net-lab/relay-robust.mjs
node --import tsx tools/net-lab/lb-forge.ts

# cross-machine over the real NAT (needs the test VMs from tools/lab and the game published on the NAT:
#   NETLAB_VM_BIND=192.168.122.1 docker compose -p rh-lab-net -f tools/net-lab/compose.yml up -d game; netlab.sh routes)
# Other agents use the VMs: check nothing else runs there first. Processes are stopped by port only.
tools/net-lab/vm-match.sh ubuntu:firefox host --profile lan --churn 60 --fast --tag vm-firefox
NETEM_A='delay 40ms 10ms loss 1%' tools/net-lab/vm-match.sh ubuntu host --profile lan --churn 60 --fast --tag vm-netem

tools/net-lab/netlab.sh down            # stop and remove the stack
```

`--fast` ends a match after the order churn (determinism is proven by the agreeing state hashes); without it a 1v1
plays all the way to a winner so the results screens can be checked too. Reports are written as JSON next to the
run output; `match.mjs` also measures input-to-action latency per profile.

The deterministic virtual-network tests (latency, jitter, drops, reconnect, AI takeover, desync) live in
`tests/net.test.ts` and `tests/net-harness.ts` and run in the normal suite; this lab exercises the same code in
real browsers over a real transport.
