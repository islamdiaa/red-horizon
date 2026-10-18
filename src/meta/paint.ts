/**
 * Paint-scheme cosmetics (src/meta/unlocks.ts): the local army's paint in a match and the Locker's tank previews.
 * Render only, through the team-colour uniforms in src/render/models/materials.ts. Split from ./cosmetics.ts because
 * it needs the 3D models: the menu loads without them (the engine chunk brings them).
 */
import { setPaintScheme, type PaintScheme } from '../render/models/materials';
import { renderThumbnails } from '../render/thumbnails';
import { COSMETICS, equipped } from './unlocks';
import { unlockContext } from './index';

let activePaint: { hex: number; scheme: PaintScheme | null } = { hex: -1, scheme: null };

function setPaint(hex: number, scheme: PaintScheme | null) {
  setPaintScheme(hex, scheme);
  activePaint = { hex: scheme ? hex : -1, scheme };
}

/** Start of a match: the local army's paint scheme (only for a match the player commands: not the menu backdrop or a replay). */
export function applyMatchPaint(teamColor: number, commanded: boolean) {
  try {
    const paint = equipped('paint', unlockContext()).paint ?? null;
    setPaint(teamColor, commanded ? paint : null);
  } catch (e) {
    console.warn('cosmetics', e);
  }
}

/** Back to factory colours (the match is over and torn down). */
export function clearMatchCosmetics() {
  if (activePaint.scheme) setPaint(activePaint.hex, null);
}

/** Locker previews: one portrait of a tank per paint scheme, in the player's colour (procedural models). */
export function paintPreviews(hex: number, faction: 'allies' | 'soviet', w = 216, h = 150): Map<string, string> {
  const out = new Map<string, string>();
  const unit = faction === 'soviet' ? '3tnk' : '2tnk';
  const keep = activePaint;
  try {
    for (const def of COSMETICS) {
      if (def.slot !== 'paint') continue;
      setPaintScheme(hex, def.paint ?? null);
      const url = renderThumbnails([unit], hex, w, h, faction).get(unit);
      if (url) out.set(def.id, url);
    }
  } catch (e) {
    console.warn('paint previews', e);
  } finally {
    setPaintScheme(hex, null);
    if (keep.scheme) setPaintScheme(keep.hex, keep.scheme);
  }
  return out;
}
