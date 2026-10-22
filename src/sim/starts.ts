/**
 * Team-aware start positions. Generated maps list their starts corner by corner (four players: bottom-left,
 * top-right, top-left, bottom-right), and a player takes `startPositions[player.id]`, so a 2v2 that pairs players
 * 0+1 put teammates in opposite corners with both enemies between them. `arrangeStarts` reorders the starts so that
 * teammates share a side: the assignment with the smallest total distance between teammates, the given order
 * winning ties. Pure and deterministic (lockstep, replays, the leaderboard's re-simulation: game.ts and
 * modes/headless.ts call it the same way).
 */

type Pt = { x: number; y: number };

/** The starts reordered so that `teams[i]` (player i's team) lands next to its teammates; unchanged without teams. */
export function arrangeStarts<T extends Pt>(starts: readonly T[], teams: readonly number[]): T[] {
  const n = teams.length;
  const out = starts.slice();
  if (n < 3 || starts.length < n || n > 8) return out;
  if (new Set(teams).size === n) return out; // free-for-all: nobody to group
  const cost = (perm: readonly number[]) => {
    let c = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (teams[i] !== teams[j]) continue;
      const a = starts[perm[i]], b = starts[perm[j]];
      c += Math.hypot(a.x - b.x, a.y - b.y);
    }
    return c;
  };
  // every way to give the n players distinct starts, the given order first (lexicographic), kept only when it is
  // strictly better (an eighth of a cell, so float noise never decides)
  let best = Array.from({ length: n }, (_, i) => i);
  let bestCost = cost(best);
  const perm: number[] = [];
  const used = new Array<boolean>(starts.length).fill(false);
  const walk = () => {
    if (perm.length === n) {
      const c = cost(perm);
      if (c < bestCost - 0.125) { bestCost = c; best = perm.slice(); }
      return;
    }
    for (let s = 0; s < starts.length; s++) {
      if (used[s]) continue;
      used[s] = true; perm.push(s);
      walk();
      perm.pop(); used[s] = false;
    }
  };
  walk();
  const chosen = best.map((s) => starts[s]);
  const rest = starts.filter((_, s) => !best.includes(s));
  return [...chosen, ...rest];
}
