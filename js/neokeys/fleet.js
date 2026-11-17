/**
 * NeoKeys: the G fleet switcher.
 *
 * Every Neorgon tool, grouped by category with the page's own category
 * first, and a Recent group above them while the visitor keeps one. The
 * list is fleet-data.js, generated from the registry (and apps-site's
 * catalog) by scripts/fleet_build.py and vendored beside this file. It is
 * imported on first open: a page that never opens the switcher never loads
 * it, and a same-origin module needs nothing new from a strict CSP.
 *
 * The input is an ARIA combobox over a listbox. Focus stays in the input
 * while the arrow keys move the active option, which aria-activedescendant
 * names, so a screen reader hears each tool as it is reached.
 *
 * Items that cannot be opened yet (a Soon site with no address) are not
 * listed; archived tools appear only in search results. The page's own
 * tool is left out: jumping to where you are is not a jump.
 */

const TEXT = {
  en: {
    label: 'Jump to a Neorgon tool', placeholder: 'Find a tool', list: 'Neorgon tools',
    recent: 'Recent', results: 'Results', empty: 'No tool matches that.',
    unavailable: 'The tool list is not available.',
    hint: 'Arrows to move, Enter to open, Esc to close', keep: 'Keep a recent list',
    soon: 'Soon', archived: 'Archived', test: 'Open test',
  },
  es: {
    label: 'Ir a una herramienta de Neorgon', placeholder: 'Busca una herramienta', list: 'Herramientas de Neorgon',
    recent: 'Recientes', results: 'Resultados', empty: 'Ninguna herramienta coincide.',
    unavailable: 'La lista de herramientas no está disponible.',
    hint: 'Flechas para moverte, Enter para abrir, Esc para cerrar', keep: 'Guardar una lista de recientes',
    soon: 'Próximamente', archived: 'Archivada', test: 'Prueba abierta',
  },
};

const RECENT_KEY = 'neokeys-recent';
const RECENT_OFF = 'neokeys-recent-off';
const RECENT_MAX = 5;

let dlg = null;
let data = null;        // { groups, items } once loaded
let rows = [];          // selectable items, in display order
let cursor = 0;

function lang() {
  return /^es(-|$)/i.test(document.documentElement.getAttribute('lang') || '') ? 'es' : 'en';
}
function t() { return TEXT[lang()]; }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* Kept for sites written against the old fetched list. The manifest is
   generated and vendored now, so a source URL has nothing left to set. */
export function setSource() {}

async function load() {
  if (data) return data;
  try {
    const mod = await import('./fleet-data.js');
    data = { groups: mod.groups || [], items: (mod.items || []).filter((i) => i && i.listed !== false) };
  } catch {
    /* No silent empty list: the dialog says the list is unavailable, which
       reads as a fault rather than as an empty fleet. */
    data = { groups: [], items: [] };
  }
  return data;
}

/* ── Recent ───────────────────────────────────────────────────────────
   Ids of the tools opened from this switcher, newest first, in this site's
   localStorage. Nothing leaves the browser, clearing site data clears it,
   and the switch in the dialog turns it off (and forgets the list). Where
   storage is blocked there is no Recent group and no switch. */
function storage() {
  try {
    const k = '__neokeys_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch { return null; }
}
function recentOn() {
  const s = storage();
  return !!s && s.getItem(RECENT_OFF) !== '1';
}
function readRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}
function remember(id) {
  if (!recentOn()) return;
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* not fatal */ }
}
function keepRecent(on) {
  try {
    if (on) localStorage.removeItem(RECENT_OFF);
    else { localStorage.setItem(RECENT_OFF, '1'); localStorage.removeItem(RECENT_KEY); }
  } catch { /* not fatal */ }
}

/* ── Where the page is ─────────────────────────────────────────────── */
function pageCategory() {
  return (document.querySelector('meta[name="neo-category"]')?.content || '').trim().toLowerCase();
}
/* The longest listed address the page sits under: apps.neorgon.com/pittari/
   is Pittari, not the catalog it lives in. */
function pageItem(items) {
  const here = location.origin + location.pathname;
  let best = null;
  for (const it of items) {
    if (it.url && here.startsWith(it.url) && (!best || it.url.length > best.url.length)) best = it;
  }
  return best;
}

/* Subsequence match, the same shape the command palettes across the fleet
   already use: "cfg" finds "CardForge". Scored so that earlier and tighter
   matches win, which is what makes two keystrokes usually enough. */
function score(needle, hay) {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = String(hay || '').toLowerCase();
  let i = 0, s = 0, last = -1;
  for (const ch of n) {
    const at = h.indexOf(ch, i);
    if (at === -1) return -1;
    s += at === last + 1 ? 3 : 1;
    if (at === 0) s += 4;
    last = at;
    i = at + 1;
  }
  return s;
}

function groupLabel(id) {
  const g = data.groups.find((x) => x.id === id);
  return g ? (g[lang()] || g.en) : '';
}

/* A query ranks by name and id; a whole word of the one-line description or
   the start of a category's name ("play", "ia") still finds a tool, below
   any name match. Archived tools come last. */
function ranked(items, query) {
  const q = query.toLowerCase();
  return items
    .map((it) => {
      let v = Math.max(score(q, it.name), score(q, it.id.replace(/^app:/, '')));
      if (v < 0 && q.length >= 2) {
        const g = data.groups.find((x) => x.id === it.group);
        if (g && [g.en, g.es].some((l) => String(l).toLowerCase().startsWith(q))) v = 2;
      }
      if (v < 0 && q.length >= 3 && String(it.line || '').toLowerCase().includes(q)) v = 1;
      return { it, v };
    })
    .filter((x) => x.v >= 0)
    .map((x) => (x.it.listed === 'archived' ? { it: x.it, v: x.v - 1000 } : x))
    .sort((a, b) => b.v - a.v || a.it.name.localeCompare(b.it.name))
    .map((x) => x.it);
}

function sections(query) {
  const here = pageItem(data.items);
  const reachable = data.items.filter((i) => i.url && i !== here);
  if (query) {
    const hits = ranked(reachable, query);
    return hits.length ? [{ id: 'results', label: t().results, items: hits, showGroup: true }] : [];
  }
  const out = [];
  const used = new Set();
  const live = reachable.filter((i) => i.listed !== 'archived');
  if (recentOn()) {
    const recent = readRecent().map((id) => live.find((i) => i.id === id)).filter(Boolean);
    if (recent.length) {
      out.push({ id: 'recent', label: t().recent, items: recent, showGroup: true });
      recent.forEach((i) => used.add(i));
    }
  }
  const cur = pageCategory();
  const order = [...data.groups].sort((a, b) => (b.id === cur) - (a.id === cur));
  for (const g of order) {
    const items = live.filter((i) => i.group === g.id && !used.has(i));
    if (items.length) out.push({ id: g.id, label: g[lang()] || g.en, items });
  }
  return out;
}

function host(url) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
  } catch { return ''; }
}

function option(item, index, showGroup) {
  const a = el('a', 'nk-fleet__item');
  a.href = item.url;
  a.id = `nk-fleet-opt-${index}`;
  a.setAttribute('role', 'option');
  a.setAttribute('aria-selected', 'false');
  a.tabIndex = -1;
  a.appendChild(el('span', 'nk-fleet__name', item.name));
  const tags = el('span', 'nk-fleet__tags');
  const status = { soon: t().soon, archived: t().archived, test: t().test }[item.listed];
  if (status) tags.appendChild(el('span', 'nk-fleet__tag nk-fleet__tag--status', status));
  if (item.platform) tags.appendChild(el('span', 'nk-fleet__tag', item.platform));
  if (showGroup) tags.appendChild(el('span', 'nk-fleet__tag nk-fleet__tag--group', groupLabel(item.group)));
  if (tags.childNodes.length) a.appendChild(tags);
  a.appendChild(el('span', 'nk-fleet__domain', host(item.url)));
  if (item.line) {
    const line = el('span', 'nk-fleet__desc', item.line);
    if (item.lang && item.lang !== lang()) line.lang = item.lang;
    a.appendChild(line);
  }
  a.addEventListener('mousemove', () => { if (cursor !== index) setActive(index, false); });
  a.addEventListener('click', () => remember(item.id));
  return a;
}

function setActive(i, scroll = true) {
  if (!rows.length) return;
  cursor = Math.max(0, Math.min(i, rows.length - 1));
  const list = dlg.querySelector('.nk-fleet__list');
  list.querySelectorAll('.nk-fleet__item').forEach((n, k) => {
    const on = k === cursor;
    n.classList.toggle('is-active', on);
    n.setAttribute('aria-selected', String(on));
    if (on && scroll) n.scrollIntoView({ block: 'nearest' });
  });
  dlg.querySelector('.nk-fleet__input').setAttribute('aria-activedescendant', `nk-fleet-opt-${cursor}`);
}

function paint(query) {
  const list = dlg.querySelector('.nk-fleet__list');
  const input = dlg.querySelector('.nk-fleet__input');
  list.textContent = '';
  rows = [];
  input.removeAttribute('aria-activedescendant');
  if (!data.items.length) {
    list.appendChild(el('p', 'nk-fleet__empty', t().unavailable));
    return;
  }
  const parts = sections(query);
  if (!parts.length) {
    list.appendChild(el('p', 'nk-fleet__empty', t().empty));
    return;
  }
  for (const part of parts) {
    const group = el('div', 'nk-fleet__group');
    group.setAttribute('role', 'group');
    const head = el('div', 'nk-fleet__heading', part.label);
    head.id = `nk-fleet-h-${part.id}`;
    head.setAttribute('role', 'presentation');
    group.setAttribute('aria-labelledby', head.id);
    group.appendChild(head);
    for (const item of part.items) {
      group.appendChild(option(item, rows.length, part.showGroup));
      rows.push(item);
    }
    list.appendChild(group);
  }
  setActive(0);
}

function go(item) {
  remember(item.id);
  location.href = item.url;
}

function label() {
  const x = t();
  dlg.setAttribute('aria-label', x.label);
  const input = dlg.querySelector('.nk-fleet__input');
  input.placeholder = x.placeholder;
  input.setAttribute('aria-label', x.label);
  dlg.querySelector('.nk-fleet__list').setAttribute('aria-label', x.list);
  dlg.querySelector('.nk-fleet__hint').textContent = x.hint;
  dlg.querySelector('.nk-fleet__keep-label').textContent = x.keep;
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'nk-fleet';

  const input = el('input', 'nk-fleet__input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'nk-fleet-list');
  input.setAttribute('aria-autocomplete', 'list');

  const list = el('div', 'nk-fleet__list');
  list.id = 'nk-fleet-list';
  list.setAttribute('role', 'listbox');

  const foot = el('div', 'nk-fleet__foot');
  const hint = el('span', 'nk-fleet__hint');
  const keep = el('label', 'nk-fleet__keep');
  const box = el('input');
  box.type = 'checkbox';
  box.className = 'nk-fleet__keep-box';
  keep.append(box, el('span', 'nk-fleet__keep-label'));
  foot.append(hint, keep);

  dlg.append(input, list, foot);
  document.body.appendChild(dlg);

  input.addEventListener('input', () => paint(input.value.trim()));
  box.addEventListener('change', () => {
    keepRecent(box.checked);
    paint(input.value.trim());
  });

  /* The input is a typing target, so core.js will not fire shortcuts while it
     has focus. That is the guard doing its job: G opens this, and every key
     after it is text until the dialog closes. */
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); dlg.close(); return; }
    if (e.target === box) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(cursor + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(cursor - 1); }
    else if (e.key === 'PageDown') { e.preventDefault(); setActive(cursor + 8); }
    else if (e.key === 'PageUp') { e.preventDefault(); setActive(cursor - 8); }
    else if (e.key === 'Enter' && rows[cursor]) { e.preventDefault(); go(rows[cursor]); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  return dlg;
}

export async function open() {
  if (!dlg) build();
  await load();
  label();
  const input = dlg.querySelector('.nk-fleet__input');
  const box = dlg.querySelector('.nk-fleet__keep-box');
  const keep = dlg.querySelector('.nk-fleet__keep');
  keep.hidden = !storage();
  box.checked = recentOn();
  input.value = '';
  paint('');
  if (!dlg.open) dlg.showModal();
  input.focus();
}

export function close() { dlg?.close(); }

export function toggle() {
  if (dlg?.open) close(); else open();
}

export function count() { return data ? data.items.length : 0; }
