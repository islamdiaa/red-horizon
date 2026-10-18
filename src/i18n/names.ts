/**
 * Translated game-data names and descriptions. The data modules keep the English (and modded types simply have no
 * translation), so every helper takes the record itself and falls back to its own text.
 */
import { addSourceResolver, dt } from './core';

interface TypeLike { id: string; name: string; description?: string; kind?: string }
const typeTable = (t: TypeLike) => (t.kind === 'building' ? 'building' : 'unit');

/** A unit or structure type's display name (data/rules.ts TypeDef). */
export const typeName = (t: TypeLike): string => dt(typeTable(t), t.id, 'name', t.name);
/** A unit or structure type's description. */
export const typeDesc = (t: TypeLike): string => dt(typeTable(t), t.id, 'description', t.description ?? '');

interface Rec { id: string }
/** Commander power (sim/commander.ts POWERS). */
export const powerName = (p: Rec & { name: string }): string => dt('power', p.id, 'name', p.name);
export const powerDesc = (p: Rec & { desc: string }): string => dt('power', p.id, 'desc', p.desc);
/** Doctrine (sim/doctrine.ts DOCTRINES). */
export const doctrineName = (d: Rec & { name: string }): string => dt('doctrine', d.id, 'name', d.name);
export const doctrineBlurb = (d: Rec & { blurb: string }): string => dt('doctrine', d.id, 'blurb', d.blurb);
export const doctrineBonus = (d: Rec & { bonuses: readonly string[] }, i: number): string => dt('doctrine', d.id, `bonuses.${i}`, d.bonuses[i] ?? '');
export const doctrineDrawback = (d: Rec & { drawback: string }): string => dt('doctrine', d.id, 'drawback', d.drawback);
/** Building upgrade (sim/economy-data.ts UPGRADES). */
export const upgradeName = (u: Rec & { name: string }): string => dt('upgrade', u.id, 'name', u.name);
export const upgradeEffect = (u: Rec & { effect: string }): string => dt('upgrade', u.id, 'effect', u.effect);
export const upgradeBlurb = (u: Rec & { blurb: string }): string => dt('upgrade', u.id, 'blurb', u.blurb);
/** Research project (sim/economy-data.ts RESEARCH). */
export const researchName = (r: Rec & { name: string }): string => dt('research', r.id, 'name', r.name);
export const researchBlurb = (r: Rec & { blurb: string }): string => dt('research', r.id, 'blurb', r.blurb);
/** Effect of research level `level` (1-based, as in the research tree). */
export const researchEffect = (r: Rec & { levels: readonly { effect: string }[] }, level: number): string =>
  dt('research', r.id, `levels.${level - 1}.effect`, r.levels[level - 1]?.effect ?? '');
/** AI personality (sim/ai-personality.ts). */
export const personalityName = (p: Rec & { name: string }): string => dt('personality', p.id, 'name', p.name);
export const personalityBlurb = (p: Rec & { blurb: string }): string => dt('personality', p.id, 'blurb', p.blurb);
/** Mutator (modes/mutators.ts). */
export const mutatorName = (m: Rec & { name: string }): string => dt('mutator', m.id, 'name', m.name);
export const mutatorDesc = (m: Rec & { desc: string }): string => dt('mutator', m.id, 'desc', m.desc);

/**
 * Let trSource() translate unit and structure names inside emitted English ("Destroy the Power Plant"). Called
 * once by a module that already has the rules tables (the HUD), so this module stays free of game data.
 */
export function resolveTypeNames(...tables: Record<string, TypeLike>[]) {
  let byName: Map<string, TypeLike> | null = null;
  addSourceResolver((english) => {
    if (!byName) {
      byName = new Map();
      for (const t of tables) for (const def of Object.values(t)) if (!byName.has(def.name)) byName.set(def.name, def);
    }
    const def = byName.get(english);
    return def ? typeName(def) : null;
  });
}
