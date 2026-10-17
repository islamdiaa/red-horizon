/**
 * What a share link carries, per kind: building the shared document from local data, and validating a
 * decoded one with the same checks as the file importers (a link is just a file in a URL).
 *
 *   map        an `.rhmap.json` file (editor/store.ts docToFile / parseRhMap)
 *   challenge  a ChallengeDef (modes/store.ts decodeChallengeFile)
 *   replay     a ReplayData (replay/format.ts isReplayData), short matches only (the link must stay small)
 */
import type { EditorDoc } from '../editor/doc';
import { docToFile, parseRhMap } from '../editor/store';
import type { ChallengeDef } from '../modes/types';
import { decodeChallengeFile } from '../modes/store';
import { isReplayData, type ReplayData } from '../replay/format';
import { TICK_HZ } from '../sim/types';
import { cleanText } from '../platform/untrusted';
import { checkMapDef, MAP_SIZE_MAX, MAP_SIZE_MIN } from '../maps/custom';
import { checkMods } from '../mods/engine';
import type { ModFile } from '../mods/format';
import type { ShareEnvelope, ShareKind } from './codec';
import { ShareLinkError } from './codec';

/** A validated, ready-to-import share. `facts` are short display lines (already cleaned). */
export type SharedItem =
  | { kind: 'map'; title: string; facts: string[]; doc: EditorDoc }
  | { kind: 'challenge'; title: string; facts: string[]; challenge: ChallengeDef }
  | { kind: 'replay'; title: string; facts: string[]; replay: ReplayData };

/** Replays longer than this are never put in a link (the commands alone would not fit). */
export const MAX_SHARED_REPLAY_TICKS = 30 * 60 * TICK_HZ;
/** Command cap for a shared replay (a busy 10-minute match issues a few thousand). */
export const MAX_SHARED_REPLAY_CMDS = 20_000;

export const KIND_LABEL: Record<ShareKind, string> = { map: 'Map', challenge: 'Challenge', replay: 'Replay' };

const mmss = (ticks: number) => {
  const s = Math.max(0, Math.round(ticks / TICK_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The shared document for an editor map (the same content as its .rhmap.json file). */
export function mapShareData(doc: EditorDoc): unknown {
  return docToFile(doc);
}

/** A replay as it travels in a link: storage bookkeeping dropped. */
export function replayShareData(r: ReplayData): unknown {
  const { storedAt: _s, ...rest } = r;
  return rest;
}

/**
 * Sanity limits for the match setup a shared challenge or replay starts from (a link is easy to pass around,
 * so a hostile one must not be able to ask for a 10⁶-cell map or a broken embedded map / mod set).
 */
export function setupProblem(setup: unknown): string | null {
  const o = setup as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'it has no match setup';
  if (o.mapSize !== undefined && !(typeof o.mapSize === 'number' && o.mapSize >= MAP_SIZE_MIN && o.mapSize <= MAP_SIZE_MAX)) return 'its map size is out of range';
  if (o.opponents !== undefined && !(Array.isArray(o.opponents) && o.opponents.length <= 7)) return 'it has too many players';
  if (o.allies !== undefined && !(Array.isArray(o.allies) && o.allies.length <= 3)) return 'it has too many allies';
  if (o.mutators !== undefined && !(Array.isArray(o.mutators) && o.mutators.length <= 8)) return 'it has too many mutators';
  if (o.credits !== undefined && !(typeof o.credits === 'number' && o.credits >= 0 && o.credits <= 1e6)) return 'its credits are out of range';
  if (o.customMap !== undefined && !checkMapDef(o.customMap).def) return 'its map is not valid';
  const mods = (o.mods as { mods?: unknown } | undefined)?.mods;
  if (mods !== undefined) {
    if (!Array.isArray(mods) || mods.length > 16) return 'its mods are not valid';
    try { if (!checkMods(mods as ModFile[]).ok) return 'its mods are not valid'; } catch { return 'its mods are not valid'; }
  }
  return null;
}

/** Validate a decoded envelope with the kind's own importer. Throws ShareLinkError (user-facing). */
export async function validateShared(env: ShareEnvelope): Promise<SharedItem> {
  switch (env.k) {
    case 'map': {
      const { doc, errors } = parseRhMap(JSON.stringify(env.d));
      if (!doc) throw new ShareLinkError(`The shared map is not valid: ${errors.slice(0, 3).join(' ')}`);
      const m = doc.map;
      const facts = [`${m.size}×${m.size}`, `${m.players} player${m.players === 1 ? '' : 's'}`, cap(m.climate)];
      if (doc.mission) facts.push('with a mission');
      return { kind: 'map', title: cleanText(m.name || 'Shared map', 60), facts, doc };
    }
    case 'challenge': {
      let c: ChallengeDef;
      try {
        c = await decodeChallengeFile(JSON.stringify(env.d));
      } catch (e) {
        throw new ShareLinkError(`The shared challenge is not valid: ${e instanceof Error ? e.message : 'unknown format'}.`);
      }
      const bad = setupProblem(c.setup);
      if (bad) throw new ShareLinkError(`The shared challenge cannot be played: ${bad}.`);
      const facts = [goalWord(c.goal.kind), `${Math.round(c.timeLimit / 60)} min`];
      if (c.source?.map) facts.push(cleanText(String(c.source.map), 40));
      return { kind: 'challenge', title: cleanText(c.title || 'Shared challenge', 60), facts, challenge: c };
    }
    case 'replay': {
      const r = env.d;
      if (!isReplayData(r)) throw new ShareLinkError('The shared replay is not valid, or from an unsupported version.');
      if (!Number.isFinite(r.ticks) || r.ticks < 0 || r.ticks > MAX_SHARED_REPLAY_TICKS) throw new ShareLinkError('The shared replay is longer than a link can hold.');
      if (r.cmds.length > MAX_SHARED_REPLAY_CMDS || r.hashes.length > MAX_SHARED_REPLAY_TICKS) throw new ShareLinkError('The shared replay holds more data than the game accepts.');
      const bad = setupProblem(r.setup);
      if (bad) throw new ShareLinkError(`The shared replay cannot be played: ${bad}.`);
      const players = Array.isArray(r.players) ? r.players.filter((p) => p && typeof p === 'object').map((p) => cleanText(String(p.name ?? ''), 24)).filter(Boolean) : [];
      const facts = [mmss(r.ticks), players.slice(0, 4).join(' vs ') || 'Skirmish'];
      return { kind: 'replay', title: cleanText(r.mapName || 'Shared replay', 60), facts, replay: { ...r, storedAt: undefined } };
    }
  }
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

function goalWord(k: string): string {
  return ({ win: 'Win', survive: 'Survive', destroy: 'Destroy', protect: 'Protect', hold: 'Hold' } as Record<string, string>)[k] ?? 'Challenge';
}
