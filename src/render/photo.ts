/**
 * Photo mode lens controls (the photo key, U by default, hides the interface): a small depth-of-field panel that stays on screen.
 * Aperture 0 = everything sharp (the default); focus follows the screen centre or a set distance.
 */
import tHud from '../i18n/en/hud';
import { fillKeys } from '../ui/keymap';
import { esc } from '../ui/dom';

export interface PhotoLensTarget {
  photoDof: number;
  /** Focus: -1 = auto (screen centre), otherwise a distance from the camera in world units. */
  photoFocus: number;
}

const CSS = `
.photo-lens { position: fixed; left: 50%; bottom: 3.5vh; transform: translateX(-50%); z-index: 60; display: none;
  font-family: var(--mono, monospace); font-size: 12px; letter-spacing: .12em; color: #e6eef6;
  background: rgba(8, 12, 18, .62); border: 1px solid rgba(160, 200, 255, .25); border-radius: 8px; padding: 8px 14px;
  backdrop-filter: blur(6px); align-items: center; gap: 12px; user-select: none; }
body.photo-mode .photo-lens { display: flex; }
.photo-lens input[type=range] { width: 170px; accent-color: rgb(var(--accent-rgb, 90, 180, 255)); }
.photo-lens label { display: flex; align-items: center; gap: 8px; opacity: .9; text-transform: uppercase; }
.photo-lens .hint { opacity: .5; font-size: 11px; text-transform: uppercase; }
.photo-lens .hint kbd { font: inherit; }
`;

export class PhotoLens {
  private el: HTMLElement;
  private stop = (e: Event) => e.stopPropagation();

  constructor(private target: PhotoLensTarget) {
    if (!document.getElementById('photo-lens-style')) {
      const st = document.createElement('style');
      st.id = 'photo-lens-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.className = 'photo-lens';
    el.innerHTML = `<label>${esc(tHud('photo.dof'))} <input type="range" data-k="dof" min="0" max="1" step="0.01" value="0"></label>
      <label>${esc(tHud('photo.focus'))} <input type="range" data-k="focus" min="0" max="1" step="0.01" value="0"></label><span class="hint">${fillKeys(tHud.html('photo.hint'))}</span>`;
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'wheel', 'contextmenu']) el.addEventListener(ev, this.stop);
    const dof = el.querySelector('[data-k="dof"]') as HTMLInputElement;
    const focus = el.querySelector('[data-k="focus"]') as HTMLInputElement;
    dof.addEventListener('input', () => { this.target.photoDof = +dof.value; });
    // 0 = auto focus, otherwise 6..60 world units from the camera
    focus.addEventListener('input', () => { const f = +focus.value; this.target.photoFocus = f <= 0.01 ? -1 : 6 + f * 54; });
    document.body.appendChild(el);
    this.el = el;
  }

  /** Photo mode toggled: the panel shows through the body class; the lens is only active while it is on. */
  set(on: boolean) {
    const dof = this.el.querySelector('[data-k="dof"]') as HTMLInputElement;
    if (!on) this.target.photoDof = 0;
    else this.target.photoDof = +dof.value;
  }

  dispose() {
    this.el.remove();
  }
}
