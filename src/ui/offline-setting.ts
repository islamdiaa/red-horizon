/**
 * Settings › Graphics: "Download HD content for offline play". The background prefetch stays off with Data Saver,
 * on slow and on metered connections (src/platform/network.ts), so players choose explicitly here: every HD model
 * and every climate's terrain textures, cached by the service worker (src/platform/offline.ts).
 */
import { el as h } from './dom';
import { ICONS } from './icons';
import { backgroundDownloadBlocker } from '../platform/network';
import { downloadOfflineContent, offlineContentMB, offlineDownloadedAt, offlineSupported } from '../platform/offline';
import { currentLang } from '../i18n/core';
import tCommon from '../i18n/en/common';
import tSettings from '../i18n/en/settings';

type RowFn = (icon: string, title: string, sub: string, control: HTMLElement) => HTMLElement;

/** A download size: "3.2 MB" (one decimal under 10 MB). */
function mb(bytes: number): string {
  const d = bytes < 10485760 ? 1 : 0;
  let n: string;
  try { n = new Intl.NumberFormat(currentLang(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(bytes / 1048576); } catch { n = (bytes / 1048576).toFixed(d); }
  return tSettings('offline.mb', { n });
}

/** The setting row and its status line. `row` is the menu's settings-row builder. */
export function offlineContentRows(row: RowFn): HTMLElement[] {
  const blocker = backgroundDownloadBlocker();
  const btn = h('button', 'btn btn-sm', `${ICONS.download}<span>${offlineDownloadedAt() ? tSettings.html('offline.again') : tCommon.html('download')}</span>`);
  const status = h('div', 'set-status');
  status.setAttribute('role', 'status');
  const say = (t: string) => { status.textContent = t; };
  const local = typeof location !== 'undefined' && location.protocol !== 'https:' && location.protocol !== 'http:'; // the desktop app (app://)
  if (local || !offlineSupported()) {
    btn.disabled = true;
    say(tSettings(local ? 'offline.local' : 'offline.unsupported'));
  } else {
    // the size, once the manifests are in (the label stays short until then)
    void offlineContentMB().then((n) => { if (n && status.isConnected && !status.textContent) say(tSettings('offline.estimate', { size: tSettings('offline.mb', { n }) })); }).catch(() => {});
  }
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const p = await downloadOfflineContent((q) => say(q.bytes
        ? tSettings('offline.progressSize', { done: q.done, total: q.total, size: mb(q.bytes) })
        : tSettings('offline.progress', { done: q.done, total: q.total })));
      say(p.failed ? tSettings('offline.partial', { n: p.failed }) : tSettings('offline.done', { size: mb(p.bytes) }));
      btn.querySelector('span')!.textContent = tSettings('offline.again');
    } catch {
      say(tSettings('offline.partial', { n: 1 }));
    } finally {
      btn.disabled = false;
    }
  };
  return [row(ICONS.download, tSettings.html('offline.title'), tSettings.html(blocker ? 'offline.subLazy' : 'offline.sub'), btn), status];
}
