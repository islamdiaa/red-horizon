/**
 * Render only (MAPS): the start camera of a World Conquest region battle on the viewport the player actually has.
 * The battlefield's `startFocus` (sim data, saved with nothing) is chosen for a desktop screen; on a portrait phone the
 * view is a few cells wide and the HUD covers its top and bottom, and on a short landscape phone the bars leave a small
 * window. There the camera searches the line from the start towards the landmark, and its distance, for the closest
 * view that shows the landmark (its middle and most of its height) in the part of the screen the HUD leaves free,
 * with the human's start on screen (inside the free part too where a close enough view allows it). Desktop viewports get `startFocus` unchanged. No simulation state is read or written
 * beyond the static map, so saves and replays are untouched.
 */
import type { GameMap } from '../sim/map';
import { LANDMARK_HEIGHTS } from '../sim/landmarks';

export interface StartView { x: number; y: number; dist: number }

/** The camera model of render/camera.ts at yaw 0. */
const FOV = 32, PITCH_NEAR = 0.66, PITCH_FAR = 0.96, MIN_DIST = 9, MAX_DIST = 64;

/** Screen rectangle (NDC: x0, x1, y0 bottom, y1 top) the HUD leaves free on this viewport, or null on a desktop one. */
export function freeScreen(width: number, height: number): [number, number, number, number] | null {
  const aspect = width / Math.max(1, height);
  // portrait phones: top bar, objectives and the order toolbar take ~the top third, the build bar and command
  // panel the bottom ~38% (measured at 390x844: open between y 270 and 520 px)
  if (aspect < 0.8) return [-0.86, 0.86, -0.22, 0.34];
  // short landscape phones: objectives and toolbar on the left, the top bar, the build bar along the bottom and
  // the command panel on the right (measured at 844x390: open between x 210-600 px, y 55-250 px)
  if (height < 520) return [-0.48, 0.4, -0.26, 0.7];
  return null;
}

function ndc(map: GameMap, fx: number, fy: number, dist: number, aspect: number, x: number, y: number, lift: number): [number, number] | null {
  const t = Math.min(1, Math.max(0, (dist - MIN_DIST) / (MAX_DIST - MIN_DIST)));
  const pitch = PITCH_NEAR + (PITCH_FAR - PITCH_NEAR) * t;
  const gy = Math.max(0, map.heightAt(fx, fy));
  const cy = gy + Math.sin(pitch) * dist, cz = fy + Math.cos(pitch) * dist;
  const d0 = x - fx, d1 = map.surfaceAt(x, y) + lift - cy, d2 = y - cz;
  const z = -d1 * Math.sin(pitch) - d2 * Math.cos(pitch);
  if (z <= 0.5) return null;
  const tan = Math.tan((FOV / 2) * Math.PI / 180);
  return [d0 / (z * tan * aspect), (d1 * Math.cos(pitch) - d2 * Math.sin(pitch)) / (z * tan)];
}

/**
 * The start camera's focus and distance for a viewport of width x height pixels: `map.startFocus` (or the default
 * just south of the start at 20) on a desktop screen or a map without a landmark; else the closest view that frames
 * the landmark and the start inside the free part of the screen.
 */
export function startView(map: GameMap, width: number, height: number): StartView {
  const s0 = map.startPositions[0] ?? { x: map.w / 2, y: map.h / 2 };
  const base: StartView = { x: map.startFocus?.x ?? s0.x, y: map.startFocus?.y ?? s0.y + 1, dist: map.startFocus?.dist ?? 20 };
  const free = freeScreen(width, height);
  const l = map.landmarks[0];
  if (!free || !l) return base;
  const aspect = width / Math.max(1, height);
  const [x0, x1, y0, y1] = free;
  const inside = (p: [number, number] | null, m = 0) => !!p && p[0] >= x0 + m && p[0] <= x1 - m && p[1] >= y0 + m && p[1] <= y1 - m;
  const H = LANDMARK_HEIGHTS[l.id] ?? 4;
  const lx = l.cx + l.w / 2, ly = l.cy + l.h / 2;
  let best: StartView | null = null, bestScore = -Infinity;
  for (let dist = base.dist; dist <= MAX_DIST; dist += 2) {
    for (let k = 0; k <= 10; k++) {
      // the focus slides from the start towards the landmark (and a little past its middle)
      const t = k / 10;
      const fx = s0.x + (lx - s0.x) * t, fy = s0.y + 1 + (ly - s0.y - 1) * t;
      // the start (its MCV / landing force) on screen; best inside the free part too, but on a phone the free part
      // is too small for both at a playable zoom, so the landmark comes first
      const start = ndc(map, fx, fy, dist, aspect, s0.x, s0.y, 0.5);
      if (!start || Math.abs(start[0]) > 0.86 || start[1] < -0.9 || start[1] > 0.86) continue;
      const startFree = inside(start, 0.04);
      const mid = ndc(map, fx, fy, dist, aspect, lx, ly, H * 0.5);
      if (!inside(mid)) continue;
      let shown = 0;
      for (let j = 0; j <= 10; j++) if (inside(ndc(map, fx, fy, dist, aspect, lx, ly, (H * j) / 10))) shown++;
      if (shown < 6) continue;
      // the closest view wins (the start in the free part is worth 6 units of distance); then more of the landmark,
      // then the start more centred
      const score = -dist * 10 + (startFree ? 60 : 0) + shown + (1 - Math.abs(start[0])) * 0.5;
      if (score > bestScore) { bestScore = score; best = { x: fx, y: fy, dist }; }
    }
    // (stop once a view is found and nothing further out can beat it)
    if (best && bestScore > -(dist + 2) * 10 + 60 + 11 + 0.5) break;
  }
  return best ?? base;
}
