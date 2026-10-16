/**
 * In-game glue for the round-5 modes (called from src/main.ts):
 *   setModeHost(...)      how mode screens start games / return to the menus
 *   attachModes(game)     KOTH HUD, branch / challenge badge, moment tracking for "make this a challenge"
 *   modesOnEnd(game, won) medals; a challenge's result screen (returns true when it handled the end)
 *   offerMoments(game)    suggested challenges on the skirmish end screen
 *   openScenarioChallenges()  the challenge list (from the Challenges hub)
 */
import { meta, type Game, type GameSetup } from '../game';
import type { Quality } from '../render/renderer';
import { getMapDef } from '../maps';
import { parseCoopId } from '../missions/special';
import { hookStep } from '../replay/core';
import { formatTime } from '../core/util';
import { DT } from '../sim/types';
import { KothHud } from '../ui/koth-hud';
import { weather } from '../ui/moment';
import { momentOffers, openChallengeList, showChallengeResult } from '../ui/challenge-list';
import { ICONS } from '../ui/icons';
import { el, esc } from '../ui/dom';
import { ensureModesCss } from '../ui/modes-css';
import { recordCoopRun } from '../ui/coop';
import { picto } from '../meta';
import { challengeFromMoment, challengeGameSetup } from './author';
import { challengeResult } from './challenge';
import { MomentTracker } from './moments';
import { isWhatIf } from './runtime';
import { recordAttempt } from './store';

export interface ModeHost {
  start(setup: GameSetup): void;
  quality(): Quality;
  /** Leave the match for the main menu (menu backdrop running). */
  toMenu(): void;
  openChallenges(): void;
  openReplays(): void;
}

let host: ModeHost | null = null;
export function setModeHost(h: ModeHost) {
  host = h;
}

const trackers = new WeakMap<Game, MomentTracker>();

/** Per-match mode UI and tracking. Torn down with the game (game.attachments). */
export function attachModes(game: Game) {
  const s = game.setup;
  if (s.demo) return;
  const items: { dispose(): void }[] = [];
  if (game.world.mission?.flags.koth) items.push(new KothHud(game));
  if (s.challenge && !s.replay) {
    // challenge attempts are not stored as replays (they would crowd out real matches)
    game.recorder?.discard();
    game.recorder = null;
  }
  if ((s.branch || s.challenge) && !s.replay) items.push(badge(game));
  if (game.recorder && !s.replay) {
    const tr = new MomentTracker(game.world, () => game.local, () => {
      const c = game.gfx.cam;
      return { cam: { x: c.x, y: c.y, dist: c.targetDist, yaw: c.targetYaw }, hours: game.hours, ...weather(game) };
    });
    trackers.set(game, tr);
    items.push({ dispose: hookStep(game.world, null, () => tr.afterStep()) });
  }
  game.attachments.push(...items);
}

function badge(game: Game): { dispose(): void } {
  ensureModesCss();
  const s = game.setup;
  const [icon, kind, text] = s.challenge
    ? [picto('trophy', 'ic'), 'Challenge', s.challenge.title]
    : [ICONS.flag, 'Branch', `from ${formatTime(s.branch!.tick * DT)} as ${game.local.name}`];
  // a chip in the HUD's top bar (next to the objective), else a floating badge
  const bar = document.getElementById('topbar');
  const b = bar
    ? el('div', 'tb-chip tb-obj mode-chip', `<span class="obj-ic">${icon}</span><span class="obj-txt"><small>${kind}</small><b>${esc(text)}</b></span>`)
    : el('div', 'mode-badge panel', `${icon}<span>${kind}</span><small>${esc(text)}</small>`);
  (bar ?? document.getElementById('ui'))?.appendChild(b);
  return { dispose: () => b.remove() };
}

/** Medals and the challenge result screen. Returns true when the end was handled here. */
export function modesOnEnd(game: Game, won: boolean): boolean {
  const s = game.setup;
  if (s.replay || s.demo) return false;
  try {
    if (s.koth && won && !isWhatIf(s)) meta.unlock('king-of-the-hill');
    if (s.branch && won) meta.unlock('alternate-history');
    const coop = game.missionDef ? parseCoopId(game.missionDef.id) : null;
    if (coop) {
      const survived = game.world.mission?.flags.survived ?? 0;
      meta.addCounter('coopWave', survived);
      recordCoopRun(game.missionDef!.id, game.world.mission?.score ?? 0, survived);
    }
  } catch (e) {
    console.warn('mode medals', e);
  }
  const c = s.challenge;
  if (!c) return false;
  const r = challengeResult(game.world.mission);
  const best = r ? recordAttempt(c.id, r) : null;
  if (r?.won) {
    meta.addCounter('challenges', 1);
    if (r.stars >= 3) meta.unlock('textbook');
  }
  showChallengeResult(c, r, best, {
    retry: () => host?.start(challengeGameSetup(c, s.quality)),
    list: () => { host?.toMenu(); openScenarioChallenges(); },
    menu: () => host?.toMenu(),
    watch: () => game.resume(),
  });
  return true;
}

/** Suggested challenges from this match's key moments, added to the skirmish end screen. */
export function offerMoments(game: Game, won: boolean) {
  const tr = trackers.get(game);
  if (!tr) return;
  const moments = tr.offers(won);
  if (!moments.length) return;
  const s = game.setup;
  const def = s.customMap ?? (s.mapId ? getMapDef(s.mapId) : undefined);
  const mapName = def?.name ?? `Random ${game.world.map.w}×${game.world.map.h}`;
  const offers = moments.map((m) => ({ def: challengeFromMoment(m, s, game.local.id, mapName), at: m.at * DT }));
  const wrap = document.querySelector('.end-screen .end-wrap');
  if (!wrap) return;
  const box = momentOffers(wrap as HTMLElement, offers, (c) => host?.start(challengeGameSetup(c, s.quality)));
  const btns = wrap.querySelector('.end-btns');
  if (box && btns) wrap.insertBefore(box, btns);
}

/** The scenario challenge list (back returns to the Challenges hub). */
export function openScenarioChallenges(onBack?: () => void) {
  openChallengeList({
    play: (c) => host?.start(challengeGameSetup(c, host.quality())),
    onBack: onBack ?? (() => host?.openChallenges()),
  });
}
