/**
 * Mod model aliases without three.js: the mod loader (src/mods) registers cloned types here from the menu, before
 * the 3D engine has loaded; render/models binds the real aliasing once it loads and replays what was queued.
 */
type AliasFn = (typeId: string, baseId: string | null) => void;
const queued = new Map<string, string | null>();
let bound: AliasFn | null = null;

/** Mod variants (src/mods): render a cloned type with its base type's model (null removes the alias). */
export function setModelAlias(typeId: string, baseId: string | null): void {
  if (bound) bound(typeId, baseId);
  else queued.set(typeId, baseId);
}

/** render/models: the real aliasing (applies the aliases registered before it loaded). */
export function bindModelAliases(fn: AliasFn): void {
  bound = fn;
  for (const [t, b] of queued) fn(t, b);
  queued.clear();
}
