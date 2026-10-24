/**
 * World Conquest names for display: regions (territories), zones, homelands and landmarks, with the homelands' and
 * landmarks' blurbs. The data (./regions.ts) keeps the English; the translations are game-data keys
 * (tools/i18n/data-sources.ts, tables worldRegion, worldZone, worldHomeland, worldLandmark) in every locale.
 * A region that is a whole country (`iso`) falls back to Intl.DisplayNames if a locale ever lacks its key.
 * Display only: runs and battles keep ids, never translated text.
 */
import { addSourceResolver, currentLang, dt } from '../../i18n/core';
import type { LandmarkId } from './types';
import { HOMELAND_BY_ID, LANDMARK_INFO, REGION_BY_ID, WORLD_HOMELANDS, WORLD_REGIONS, WORLD_ZONES, ZONE_BY_ID } from './regions';

let display: { lang: string; names: Intl.DisplayNames | null } | null = null;
function countryName(iso: string): string | null {
  const lang = currentLang();
  if (!display || display.lang !== lang) {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' }); } catch { names = null; }
    display = { lang, names };
  }
  return display.names?.of(iso) ?? null;
}

/** A region's (territory's) name in the interface language; unknown ids come back as they are. */
export function regionName(id: string): string {
  const r = REGION_BY_ID[id];
  if (!r) return id;
  const t = dt('worldRegion', id, 'name', '');
  if (t) return t;
  return (currentLang() !== 'en' && r.iso && countryName(r.iso)) || r.name;
}
/** A bonus zone's name. */
export const zoneName = (id: string): string => dt('worldZone', id, 'name', ZONE_BY_ID[id]?.name ?? id);
/** A homeland's (starting nation's) name. */
export const homelandName = (id: string): string => dt('worldHomeland', id, 'name', HOMELAND_BY_ID[id]?.name ?? id);
/** A homeland's one-line blurb for the picker. */
export const homelandBlurb = (id: string): string => dt('worldHomeland', id, 'blurb', HOMELAND_BY_ID[id]?.blurb ?? '');
/** A landmark's name. */
export const landmarkName = (id: LandmarkId): string => dt('worldLandmark', id, 'name', LANDMARK_INFO[id]?.name ?? id);
/** A landmark's blurb. */
export const landmarkBlurb = (id: LandmarkId): string => dt('worldLandmark', id, 'blurb', LANDMARK_INFO[id]?.blurb ?? '');

// A region, zone, homeland or landmark name inside emitted English (trSource) is translated too, in capitals as well.
let byName: Map<string, () => string> | null = null;
addSourceResolver((english) => {
  if (!byName) {
    byName = new Map();
    for (const r of WORLD_REGIONS) byName.set(r.name, () => regionName(r.id));
    for (const z of WORLD_ZONES) if (!byName.has(z.name)) byName.set(z.name, () => zoneName(z.id));
    for (const h of WORLD_HOMELANDS) if (!byName.has(h.name)) byName.set(h.name, () => homelandName(h.id));
    for (const [id, l] of Object.entries(LANDMARK_INFO)) if (!byName.has(l.name)) byName.set(l.name, () => landmarkName(id as LandmarkId));
    for (const [k, f] of [...byName]) { const up = k.toUpperCase(); if (!byName.has(up)) byName.set(up, () => f().toLocaleUpperCase(currentLang())); }
  }
  return byName.get(english)?.() ?? null;
});
