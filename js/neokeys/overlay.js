/**
 * NeoKeys — the ? sheet.
 *
 * Two panes in one dialog: what the keys are, and how to change them. They
 * belong together because the second is what makes the first compliant. A
 * shortcut sheet that only lists keys is a feature; one that also turns them
 * off is the difference between meeting WCAG 2.1.4 and not.
 *
 * The list is generated from the registry on every open, so it cannot drift.
 * Nothing has to be kept in sync by hand, which is the whole argument for
 * declaring shortcuts as data.
 */

import { list, activeKey, isDisabled, setDisabled, remap, resetRemaps, onChange, RESERVED } from './core.js';

let dlg = null;
let capturing = null;   // id of the entry currently listening for a new key

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function kbd(key) {
  const k = el('kbd', 'nk-key', key === 'escape' ? 'Esc' : key.toUpperCase());
  return k;
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'nk-sheet';
  dlg.setAttribute('aria-labelledby', 'nk-sheet-title');

  const head = el('div', 'nk-sheet__head');
  const title = el('h2', 'nk-sheet__title', 'Keyboard shortcuts');
  title.id = 'nk-sheet-title';
  const close = el('button', 'nk-sheet__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  close.addEventListener('click', () => dlg.close());
  head.append(title, close);

  const body = el('div', 'nk-sheet__body');
  body.id = 'nk-sheet-body';

  dlg.append(head, body);
  document.body.appendChild(dlg);

  /* Escape is bound on the dialog and stopped there. Sites bind Escape at
     document level for their own panels; without stopPropagation a single
     press would close this sheet and whatever sits behind it. */
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dlg.open) { e.stopPropagation(); dlg.close(); }
    if (capturing && e.key.length === 1) {
      e.preventDefault();
      e.stopPropagation();
      const res = remap(capturing, e.key);
      capturing = null;
      render();
      if (!res.ok) flash(res.reason);
    }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  onChange(() => { if (dlg?.open) render(); });
  return dlg;
}

function flash(msg) {
  const n = dlg.querySelector('.nk-sheet__flash');
  if (!n) return;
  n.textContent = msg;
  n.hidden = false;
  setTimeout(() => { n.hidden = true; }, 2600);
}

function row(entry) {
  const r = el('div', 'nk-row');
  const keyWrap = el('div', 'nk-row__key');
  keyWrap.appendChild(kbd(activeKey(entry)));
  if (activeKey(entry) !== entry.defaultKey) keyWrap.appendChild(el('span', 'nk-row__moved', 'moved'));

  const label = el('div', 'nk-row__label');
  label.appendChild(el('span', 'nk-row__name', entry.label));
  if (entry.hint) label.appendChild(el('span', 'nk-row__hint', entry.hint));

  const actions = el('div', 'nk-row__actions');
  const rebind = el('button', 'nk-mini');
  rebind.type = 'button';
  rebind.textContent = capturing === entry.id ? 'press a key…' : 'Rebind';
  rebind.setAttribute('aria-label', `Rebind ${entry.label}`);
  rebind.addEventListener('click', () => {
    capturing = capturing === entry.id ? null : entry.id;
    render();
  });
  actions.appendChild(rebind);

  if (activeKey(entry) !== entry.defaultKey) {
    const undo = el('button', 'nk-mini');
    undo.type = 'button';
    undo.textContent = 'Reset';
    undo.addEventListener('click', () => { remap(entry.id, null); render(); });
    actions.appendChild(undo);
  }

  r.append(keyWrap, label, actions);
  return r;
}

function render() {
  const body = dlg.querySelector('.nk-sheet__body');
  body.textContent = '';

  const flashLine = el('p', 'nk-sheet__flash');
  flashLine.hidden = true;
  flashLine.setAttribute('role', 'status');
  body.appendChild(flashLine);

  const entries = list();
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }

  for (const [name, items] of groups) {
    body.appendChild(el('h3', 'nk-sheet__group', name));
    const wrap = el('div', 'nk-rows');
    items.forEach((e) => wrap.appendChild(row(e)));
    body.appendChild(wrap);
  }

  /* Escape earns a line even though the kit does not bind it, because the
     convention is the point: every Neorgon site closes its topmost layer
     with it, and a sheet that omitted it would be lying by silence. */
  const conv = el('div', 'nk-rows nk-rows--muted');
  const r = el('div', 'nk-row');
  const kw = el('div', 'nk-row__key');
  kw.appendChild(kbd('escape'));
  const lb = el('div', 'nk-row__label');
  lb.appendChild(el('span', 'nk-row__name', 'Close the topmost layer'));
  lb.appendChild(el('span', 'nk-row__hint', 'Fleet convention, handled by each site'));
  r.append(kw, lb, el('div', 'nk-row__actions'));
  conv.appendChild(r);
  body.appendChild(el('h3', 'nk-sheet__group', 'Convention'));
  body.appendChild(conv);

  /* WCAG 2.1.4 lives here. */
  const foot = el('div', 'nk-sheet__foot');
  const toggleWrap = el('label', 'nk-switch');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !isDisabled();
  cb.addEventListener('change', () => setDisabled(!cb.checked));
  toggleWrap.append(cb, el('span', null, 'Single-key shortcuts enabled'));
  foot.appendChild(toggleWrap);

  const resetAll = el('button', 'nk-mini');
  resetAll.type = 'button';
  resetAll.textContent = 'Reset all keys';
  resetAll.addEventListener('click', () => { resetRemaps(); render(); });
  foot.appendChild(resetAll);
  body.appendChild(foot);
}

export function open() {
  if (!dlg) build();
  render();
  dlg.showModal();
}

export function close() { dlg?.close(); }

export function toggle() {
  if (dlg?.open) close(); else open();
}

export { RESERVED };
