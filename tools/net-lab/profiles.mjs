// Link profiles for the net lab (pktem.py fields, applied to each direction of a player's link).
// Delay and jitter are per direction, so a profile's round trip is twice its delay_ms; loss applies to each
// direction independently (a 2% profile loses about 2% of packets each way, like netem on both ends).
// An outage blackholes one player's link in both directions (no RST, no FIN: a dead Wi-Fi or a pulled cable).
export const PROFILES = {
  lan: { link: {} },
  rtt80: { link: { delay_ms: 40 } },
  rtt200j50: { link: { delay_ms: 100, jitter_ms: 25 } },          // RTT 200 ms +- 50 ms
  loss2: { link: { delay_ms: 20, loss: 0.02 } },                   // on a 40 ms path
  loss5: { link: { delay_ms: 20, loss: 0.05 } },
  mbit1: { link: { delay_ms: 20, rate_kbit: 1000, queue_ms: 300 } },
  disc10: { link: { delay_ms: 20 }, outage: { peer: 'b', after: 30, secs: 10 } },
  disc60: { link: { delay_ms: 20 }, outage: { peer: 'b', after: 30, secs: 60 } },
  disc120: { link: { delay_ms: 20 }, outage: { peer: 'b', after: 30, secs: 120 } },
  // the worst plausible home link: high latency, jitter and loss at once
  awful: { link: { delay_ms: 120, jitter_ms: 40, loss: 0.03 } },
  // the high-latency ladder (input delay vs game speed): both players at this round trip
  rtt50: { link: { delay_ms: 25 } },
  rtt150: { link: { delay_ms: 75 } },
  rtt300: { link: { delay_ms: 150 } },
  rtt450: { link: { delay_ms: 225 } },
  rtt600: { link: { delay_ms: 300 } },
  rtt150j40: { link: { delay_ms: 75, jitter_ms: 20 } },           // RTT 150 ms +- 40 ms
  rtt300j80: { link: { delay_ms: 150, jitter_ms: 40 } },
  rtt450j100: { link: { delay_ms: 225, jitter_ms: 50 } },
  // one player far away, the other near (the room's delay follows the slowest)
  far600: { link: { delay_ms: 300 }, only: 'b' },
};

/** The relay hands a silent player's seat to the AI after about this long (pong timeout 30 s + grace 60 s). */
export const GRACE_MS = 90_000;

export function outageOf(p) {
  return p.outage ? { ...p.outage, graceMs: GRACE_MS } : null;
}
