/** Tiny form helpers for the editor panels: labelled rows that commit on change. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function row(label: string, ...controls: HTMLElement[]): HTMLElement {
  const r = el('div', 'ed-f');
  r.appendChild(el('label', '', esc(label)));
  if (controls.length === 1) r.appendChild(controls[0]);
  else { const w = el('div', 'row'); w.append(...controls); r.appendChild(w); }
  return r;
}

export function text(value: string, commit: (v: string) => void, opts: { placeholder?: string; max?: number } = {}): HTMLInputElement {
  const i = el('input');
  i.type = 'text';
  i.value = value;
  i.spellcheck = false;
  if (opts.placeholder) i.placeholder = opts.placeholder;
  if (opts.max) i.maxLength = opts.max;
  i.onchange = () => commit(i.value);
  i.onkeydown = (e) => { if (e.key === 'Enter') i.blur(); e.stopPropagation(); };
  return i;
}

export function num(value: number | undefined, commit: (v: number) => void, opts: { min?: number; max?: number; step?: number; placeholder?: string } = {}): HTMLInputElement {
  const i = el('input');
  i.type = 'number';
  i.value = value === undefined || Number.isNaN(value) ? '' : String(value);
  if (opts.min !== undefined) i.min = String(opts.min);
  if (opts.max !== undefined) i.max = String(opts.max);
  i.step = String(opts.step ?? 1);
  if (opts.placeholder) i.placeholder = opts.placeholder;
  i.onchange = () => {
    let v = parseFloat(i.value);
    if (!Number.isFinite(v)) return;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    i.value = String(v);
    commit(v);
  };
  i.onkeydown = (e) => { if (e.key === 'Enter') i.blur(); e.stopPropagation(); };
  return i;
}

export function area(value: string, commit: (v: string) => void, rows = 4): HTMLTextAreaElement {
  const t = el('textarea');
  t.value = value;
  t.rows = rows;
  t.spellcheck = true;
  t.onchange = () => commit(t.value);
  t.onkeydown = (e) => e.stopPropagation();
  return t;
}

export function select<T extends string | number>(value: T, options: [T, string][] | { group: string; items: [T, string][] }[], commit: (v: T) => void): HTMLSelectElement {
  const s = el('select');
  const add = (parent: HTMLElement, [v, label]: [T, string]) => {
    const o = el('option');
    o.value = String(v);
    o.textContent = label;
    if (v === value) o.selected = true;
    parent.appendChild(o);
  };
  for (const opt of options as unknown[]) {
    if (Array.isArray(opt)) add(s, opt as [T, string]);
    else {
      const g = el('optgroup');
      g.label = (opt as { group: string }).group;
      for (const it of (opt as { items: [T, string][] }).items) add(g, it);
      s.appendChild(g);
    }
  }
  s.onchange = () => {
    const v = s.value;
    commit((typeof value === 'number' ? Number(v) : v) as T);
  };
  s.onkeydown = (e) => e.stopPropagation();
  return s;
}

export function check(label: string, value: boolean, commit: (v: boolean) => void): HTMLLabelElement {
  const l = el('label', 'ed-chk');
  const i = el('input');
  i.type = 'checkbox';
  i.checked = value;
  i.onchange = () => commit(i.checked);
  l.append(i, el('span', '', esc(label)));
  return l;
}

export function button(label: string, onClick: () => void, cls = '', title = ''): HTMLButtonElement {
  const b = el('button', 'ed-b ' + cls, label);
  if (title) b.title = title;
  b.onclick = (e) => { e.stopPropagation(); onClick(); };
  return b;
}

export function heading(text: string, ...actions: HTMLElement[]): HTMLElement {
  const h = el('div', 'ed-h', `<span>${esc(text)}</span><i class="ln"></i>`);
  // actions sit after the rule line
  if (actions.length) { const w = el('span'); w.style.display = 'flex'; w.style.gap = '0.3rem'; w.append(...actions); h.appendChild(w); }
  return h;
}
