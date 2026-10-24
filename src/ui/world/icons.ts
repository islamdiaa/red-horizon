/**
 * Landmark icons for the globe and the cards: ARCH's landmarkThumb (src/render/landmarks), loaded after the globe
 * shows; until then (or without it) a small drawn marker. Cached per landmark.
 */
type Img = CanvasImageSource;
const cache = new Map<string, Img | null>();
let loading = false;
let thumb: ((id: string) => string | HTMLCanvasElement | null) | null = null;
const waiting = new Set<() => void>();

/** A drawn fallback: a gold pin with a small tower. */
function fallback(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(255,211,77,0.95)';
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(24, 4); g.lineTo(31, 18); g.lineTo(29, 40); g.lineTo(19, 40); g.lineTo(17, 18); g.closePath();
    g.fill(); g.stroke();
    g.fillRect(12, 40, 24, 5); g.strokeRect(12, 40, 24, 5);
  }
  return c;
}
let fb: HTMLCanvasElement | null = null;

/** The icon of a landmark now (a fallback until the real one is ready; `ready` is called once it is). */
export function landmarkIcon(id: string, ready?: () => void): Img | null {
  if (cache.has(id)) return cache.get(id) ?? null;
  if (!thumb) {
    if (ready) waiting.add(ready);
    if (!loading) {
      loading = true;
      // (the landmark models are a separate concern: the globe shows first, the icons fill in)
      void import('./landmark-thumbs').then((m) => { thumb = m.thumbFn(); for (const f of waiting) f(); }).catch(() => { thumb = () => null; });
    }
    if (typeof document === 'undefined') return null;
    return (fb ??= fallback());
  }
  // a thumbnail costs ~10-30 ms the first time: make them one at a time, between frames
  if (ready) waiting.add(ready);
  if (!queue.includes(id)) queue.push(id);
  pump();
  return (fb ??= fallback());
}

const queue: string[] = [];
let pumping = false;
function pump() {
  if (pumping || !queue.length || !thumb) return;
  pumping = true;
  setTimeout(() => {
    pumping = false;
    const id = queue.shift();
    if (id && !cache.has(id)) {
      let img: Img | null = null;
      try {
        const t = thumb!(id);
        if (typeof t === 'string' && t) { const im = new Image(); im.src = t; im.onload = () => { for (const f of waiting) f(); }; img = im; }
        else if (t && typeof t !== 'string') img = t;
      } catch { img = null; }
      cache.set(id, img ?? (fb ??= fallback()));
    }
    if (queue.length) pump(); else { for (const f of waiting) f(); waiting.clear(); }
  }, 40);
}

/** A data URL of a landmark's icon for HTML (cards, panels), or null. */
export function landmarkIconUrl(id: string): string | null {
  const i = landmarkIcon(id);
  if (!i) return null;
  if (i instanceof HTMLImageElement) return i.src;
  if (i instanceof HTMLCanvasElement) { try { return i.toDataURL(); } catch { return null; } }
  return null;
}
