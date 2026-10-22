/**
 * Surrender from the in-match menu (src/ui/menu.ts showPause): the menu entry, its confirmation, and the command
 * (sim/resign.ts). A multiplayer match sends it through the lockstep (src/net/game-link.ts); a skirmish or a ranked
 * run issues it like any order, so the replay and the leaderboard's re-simulation (src/net/verify.ts) see it too.
 * Offered in multiplayer matches, skirmishes (Quick Battle too) and ranked runs (Survival, the Daily Challenge, the
 * built-in challenges); not in the campaign, Conquest, King of the Hill, custom missions or replay branches.
 *
 * (Kept light: the menu chunk imports it. The simulation module itself is not imported here.)
 */
import type { Game } from '../game';
import { ICONS } from '../ui/icons';
import { el, esc } from '../ui/dom';
import { boardOfSetup } from './boards';
import tNet from '../i18n/en/net';
import tCommon from '../i18n/en/common';

/** What the confirmation needs from the menu. */
export interface SurrenderUi {
  /** Open a fresh menu screen (the pause menu's look) and return it. */
  open(): HTMLElement;
  setEsc(fn: () => void): void;
  /** Back to the pause menu. */
  back(): void;
  /** Close the menu and play on (the surrender runs at the next tick). */
  done(): void;
}

type MenuEntry = (act: string, label: string, icon: string, fn: () => void, cls?: string) => void;

/** Can the local player surrender now? */
export function surrenderAvailable(game: Game): boolean {
  const s = game.setup, w = game.world, me = game.local;
  if (s.replay || s.demo || !me || w.gameOver || me.defeated || me.resigned) return false;
  if (game.net) return !!game.net.canSurrender;
  if (s.mission || s.challenge || s.conquest || s.branch || s.customMission || s.koth) return !!boardOfSetup(s); // ranked runs only
  return true; // a skirmish
}

/** A human team-mate still plays: the side would fight on under the AI (sim/resign.ts). */
function teamFightsOn(game: Game): boolean {
  const me = game.local;
  return !game.world.mission && game.world.players.some((q) => q !== me && q.team === me.team && q.isHuman && !q.defeated && !q.resigned);
}

/** Surrender (no confirmation): returns false when it is not possible now. */
export function surrender(game: Game): boolean {
  if (!surrenderAvailable(game)) return false;
  if (game.net) return game.net.surrender?.() ?? false;
  game.issue({ c: 'resign', player: game.local.id });
  return true;
}

/** The pause menu's "Surrender" entry (when it is available), which asks for confirmation first. */
export function surrenderEntry(game: Game, mk: MenuEntry, ui: SurrenderUi) {
  if (surrenderAvailable(game)) mk('surrender', tNet('surrender.button'), ICONS.flag, () => confirmSurrender(game, ui), 'danger');
}

function confirmSurrender(game: Game, ui: SurrenderUi) {
  const s = ui.open();
  const body = game.net ? (teamFightsOn(game) ? 'surrender.bodyTeam' : 'surrender.bodyConcede') : boardOfSetup(game.setup) ? 'surrender.bodyRun' : 'surrender.bodyConcede';
  const panel = el('div', 'menu-panel panel pause-panel surrender-panel');
  panel.innerHTML = `<div class="mp-head"><span class="mp-ic">${ICONS.flag}</span><div><small>${tNet.html('surrender.kicker')}</small><h2>${tNet.html('surrender.title')}</h2></div></div>
    <p style="margin:0;color:var(--text-2);line-height:1.45">${tNet.html(body)}</p>`;
  const list = el('div', 'pp-list');
  const btn = (act: string, label: string, icon: string, fn: () => void, cls: string) => {
    const b = el('button', 'pp-btn ' + cls, `<span class="pp-bic">${icon}</span><span>${esc(label)}</span>${cls === 'primary' ? `<kbd>${tCommon.html('keys.esc')}</kbd>` : ICONS.chevR}`);
    b.dataset.act = act;
    b.onclick = fn;
    list.appendChild(b);
  };
  btn('keep fighting', tNet('surrender.cancel'), ICONS.play, ui.back, 'primary');
  btn('confirm surrender', tNet('surrender.confirm'), ICONS.flag, () => { surrender(game); ui.done(); }, 'danger');
  panel.appendChild(list);
  s.appendChild(panel);
  ui.setEsc(ui.back);
  (list.firstElementChild as HTMLElement | null)?.focus();
}
