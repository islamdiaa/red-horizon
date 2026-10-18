/**
 * Opening a share link (`#share=…`): decode it as untrusted input (codec.ts), validate it with the kind's
 * importer (content.ts), then ask before anything is stored or played. The fragment is removed from the
 * address bar first, so a reload never asks twice. Loaded on demand by main.ts only when a link is opened.
 */
import type { GameSetup } from '../game';
import type { Quality } from '../render/renderer';
import { esc } from '../ui/dom';
import { ICONS } from '../ui/icons';
import { saveDoc, customMissionSetup } from '../editor/store';
import { saveChallenge } from '../modes/store';
import { challengeGameSetup } from '../modes/author';
import { saveReplay } from '../replay/store';
import { newReplayId } from '../replay/format';
import { playbackSetup } from '../replay/launch';
import { decodeSharePayload, payloadFromHash, ShareLinkError } from './codec';
import { validateShared, type SharedItem } from './content';
import { openModal, SHARE_ICONS } from './dialog';
import tShare from '../i18n/en/share';
import tCommon from '../i18n/en/common';

export interface ShareHost {
  start(setup: GameSetup): void;
  quality(): Quality;
  play?(k: 'click' | 'ready_ping'): void;
}

/** Remove `#share=…` from the address bar (keeps the path and query). */
function clearFragment() {
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  } catch {
    /* sandboxed: ignore */
  }
}

let busy = false;

/** Look for a share link in the address and handle it. Resolves once the dialog is shown (or nothing to do). */
export async function openShareLink(host: ShareHost): Promise<void> {
  const payload = payloadFromHash(location.hash);
  if (payload === null || busy) return;
  busy = true;
  clearFragment();
  try {
    const item = await validateShared(await decodeSharePayload(payload));
    confirmImport(item, host);
  } catch (e) {
    const msg = e instanceof ShareLinkError ? e.message : tShare('open.unreadable');
    if (!(e instanceof ShareLinkError)) console.warn('[share]', e);
    const m = openModal(ICONS.warn, tShare('open.kicker'), tShare('open.cannotOpen'));
    (m.panel.querySelector('.sh-body') as HTMLElement).innerHTML = `<div class="mx-note bad">${esc(msg)}</div>
      <div class="mx-note" style="margin-top:.6rem">${tShare.html('open.nothingImported')}</div>
      <div class="mx-actions"><button class="btn-primary" data-a="ok">${ICONS.check}<span>${tCommon.html('ok')}</span></button></div>`;
    (m.panel.querySelector('[data-a="ok"]') as HTMLElement).onclick = () => m.close();
    m.focus();
  } finally {
    busy = false;
  }
}

function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

/** The confirmation: what it is, what importing does, and Import / Play. */
function confirmImport(item: SharedItem, host: ShareHost) {
  const m = openModal(SHARE_ICONS.share, tShare('open.sharedKicker', { kind: item.kind }), item.title);
  const body = m.panel.querySelector('.sh-body') as HTMLElement;
  const intro = item.kind === 'map' ? (item.doc.mission ? tShare.html('open.introMapMission') : tShare.html('open.introMapSkirmish'))
    : item.kind === 'challenge' ? tShare.html('open.introChallenge')
    : tShare.html('open.introReplay');
  const playLabel = item.kind === 'replay' ? tShare('open.watch') : tCommon('play');
  body.innerHTML = `<div class="sh-facts">${item.facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
    <div class="mx-note" style="margin-top:.8rem">${intro}</div>
    <div class="sh-status" role="status" aria-live="polite"></div>
    <div class="mx-actions"><button class="btn-primary" data-a="play">${ICONS.play}<span>${esc(playLabel)}</span></button>
      <button class="btn" data-a="save">${ICONS.check}<span>${tShare.html('open.import')}</span></button><button class="btn" data-a="cancel">${ICONS.close}<span>${tCommon.html('cancel')}</span></button></div>
    <div class="sh-priv">${SHARE_ICONS.lock}<span>${tShare.html('open.privacy')}</span></div>`;
  const status = body.querySelector('.sh-status') as HTMLElement;
  const btns = body.querySelectorAll<HTMLButtonElement>('button');
  const save = async (): Promise<GameSetup | null> => {
    btns.forEach((b) => { b.disabled = true; });
    const q = host.quality();
    switch (item.kind) {
      case 'map': {
        await saveDoc(item.doc);
        const mission = item.doc.mission ? customMissionSetup(item.doc.id) : null;
        const def = item.doc.map;
        const players = Math.max(2, def.players || 2);
        const base = {
          faction: 'allies' as const, color: 0x3d7be0, mapSize: def.size, water: 0.5, trees: 0.5, ore: 0.6, credits: 10000,
          startUnits: 'mcv' as const, fog: true, timeOfDay: 'day' as const, quality: q, seed: randomSeed(), climate: def.climate,
        };
        if (mission) return { ...base, opponents: [], mission: item.doc.id, intro: true, ...mission };
        return {
          ...base, opponents: Array.from({ length: players - 1 }, () => ({ faction: 'random' as const, difficulty: 'normal' as const })),
          mapId: def.id, customMap: JSON.parse(JSON.stringify(def)), rules: 'commander', events: true,
        };
      }
      case 'challenge': {
        const c = { ...item.challenge, id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1679616).toString(36)}`, source: { ...(item.challenge.source ?? {}), kind: 'import' as const } };
        await saveChallenge(c);
        return challengeGameSetup(c, q);
      }
      case 'replay': {
        const r = { ...item.replay, id: newReplayId(Date.now(), Math.random()) };
        await saveReplay(r);
        return playbackSetup(r, q);
      }
    }
  };
  m.focus();
  (body.querySelector('[data-a="cancel"]') as HTMLElement).onclick = () => m.close();
  (body.querySelector('[data-a="save"]') as HTMLElement).onclick = () => {
    void save().then(() => {
      host.play?.('ready_ping');
      status.textContent = tShare(item.kind === 'map' ? 'open.importedMap' : item.kind === 'challenge' ? 'open.importedChallenge' : 'open.importedReplay');
      setTimeout(() => m.close(), 1800);
    }).catch((e) => { console.warn('[share]', e); status.textContent = tShare('open.saveFailed'); status.classList.add('bad'); btns.forEach((b) => { b.disabled = false; }); });
  };
  (body.querySelector('[data-a="play"]') as HTMLElement).onclick = () => {
    void save().then((setup) => { m.close(); if (setup) host.start(setup); })
      .catch((e) => { console.warn('[share]', e); status.textContent = tShare('open.startFailed'); status.classList.add('bad'); btns.forEach((b) => { b.disabled = false; }); });
  };
}
