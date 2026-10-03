/**
 * NeoKeys — the G fleet switcher.
 *
 * Fifty-one live sites and the only route between any two of them is going
 * back to the hub. The registry already knows every domain, so the jump costs
 * one fetch and a filter box.
 *
 * The site list is fetched rather than bundled so a new site appears without
 * redeploying fifty others. On a real rollout the URL is the CDN copy of
 * docs/site-registry.json; here it is a local trim of the same file.
 */

let dlg = null;
let sites = [];
let filtered = [];
let cursor = 0;
let source = 'data/fleet.json';

export function setSource(url) { source = url; }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

async function load() {
  if (sites.length) return sites;
  try {
    const res = await fetch(source);
    if (!res.ok) throw new Error(res.status);
    sites = await res.json();
  } catch {
    /* No silent empty list: a switcher that opens onto nothing looks broken
       rather than offline, and the difference matters when debugging. */
    sites = [];
  }
  return sites;
}

/* Subsequence match, the same shape the command palettes across the fleet
   already use: "cfg" finds "CardForge". Scored so that earlier and tighter
   matches win, which is what makes two keystrokes usually enough. */
function score(needle, hay) {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
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

function apply(query) {
  filtered = sites
    .map((s) => ({ s, v: Math.max(score(query, s.name), score(query, s.id)) }))
    .filter((x) => x.v >= 0)
    .sort((a, b) => b.v - a.v || a.s.name.localeCompare(b.s.name))
    .map((x) => x.s);
  cursor = 0;
}

function paint() {
  const listEl = dlg.querySelector('.nk-fleet__list');
  listEl.textContent = '';
  if (!filtered.length) {
    listEl.appendChild(el('p', 'nk-fleet__empty',
      sites.length ? 'Nothing matches that.' : 'Site list unavailable.'));
    return;
  }
  filtered.forEach((s, i) => {
    const a = el('a', 'nk-fleet__item' + (i === cursor ? ' is-active' : ''));
    a.href = s.url;
    a.appendChild(el('span', 'nk-fleet__name', s.name));
    a.appendChild(el('span', 'nk-fleet__domain', s.domain));
    if (s.desc) a.appendChild(el('span', 'nk-fleet__desc', s.desc));
    a.addEventListener('mousemove', () => { cursor = i; paint(); });
    listEl.appendChild(a);
  });
  listEl.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'nk-fleet';
  dlg.setAttribute('aria-label', 'Jump to a Neorgon site');

  const input = el('input', 'nk-fleet__input');
  input.type = 'text';
  input.placeholder = 'Jump to a Neorgon site…';
  input.setAttribute('aria-label', 'Filter sites');

  const listEl = el('div', 'nk-fleet__list');
  const hint = el('div', 'nk-fleet__hint', 'Arrows to move, Enter to open, Esc to close');

  dlg.append(input, listEl, hint);
  document.body.appendChild(dlg);

  input.addEventListener('input', () => { apply(input.value.trim()); paint(); });

  /* The input is a typing target, so core.js will not fire shortcuts while it
     has focus. That is the guard doing its job: G opens this, and every key
     after it is text until the dialog closes. */
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); dlg.close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, filtered.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); paint(); }
    else if (e.key === 'Enter' && filtered[cursor]) { e.preventDefault(); location.href = filtered[cursor].url; }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  return dlg;
}

export async function open() {
  if (!dlg) build();
  await load();
  const input = dlg.querySelector('.nk-fleet__input');
  input.value = '';
  apply('');
  paint();
  dlg.showModal();
  input.focus();
}

export function close() { dlg?.close(); }

export function toggle() {
  if (dlg?.open) close(); else open();
}

export function count() { return sites.length; }
