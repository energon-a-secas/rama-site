/**
 * NeoKeys — the M storefront.
 *
 * A joke, and an opt-in one. Straight from PoE2, where the shop button is
 * welded to the UI whether you want it or not. Everything costs nothing, the
 * buy button says it is already yours, and the last line is true.
 *
 * Off unless the page asks for it:
 *   <meta name="neo-keys-store" content="on">
 *
 * Gated for two reasons. It should never turn up on safeguard or
 * incident-runbook, where a fake storefront would undercut the page. And M is
 * already Sortie's own binding, so claiming it fleet-wide would make the joke
 * the system's first real collision. Opt-in means the two never meet.
 */

const ITEMS = [
  { name: 'Stash Tab', note: 'Sold out. There was one.', price: 0 },
  { name: 'Extra Accent Colour', note: 'Already free. Press ? and rebind anything.', price: 0 },
  { name: 'Remove Ads', note: 'There are none to remove.', price: 0 },
  { name: 'Priority Support', note: 'Open a GitHub issue. Same queue, same person.', price: 0 },
  { name: 'Support the Developer', note: 'Star the repo. That is the whole transaction.', price: 0 },
];

let dlg = null;

export function enabled() {
  const m = document.querySelector('meta[name="neo-keys-store"]');
  return !!m && m.content === 'on';
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'nk-store';
  dlg.setAttribute('aria-labelledby', 'nk-store-title');

  const head = el('div', 'nk-store__head');
  const title = el('h2', 'nk-store__title', 'Premium Store');
  title.id = 'nk-store-title';
  const bal = el('span', 'nk-store__balance', '0 coins');
  const close = el('button', 'nk-sheet__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  close.addEventListener('click', () => dlg.close());
  head.append(title, bal, close);

  const grid = el('div', 'nk-store__grid');
  for (const item of ITEMS) {
    const card = el('div', 'nk-store__item');
    card.appendChild(el('h3', 'nk-store__name', item.name));
    card.appendChild(el('p', 'nk-store__note', item.note));
    const buy = el('button', 'nk-store__buy', 'Already yours');
    buy.type = 'button';
    buy.disabled = true;
    card.appendChild(buy);
    grid.appendChild(card);
  }

  const honest = el('p', 'nk-store__honest',
    'This site is free, static, and collects nothing. There is no store. There never was.');

  dlg.append(head, grid, honest);
  document.body.appendChild(dlg);

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dlg.open) { e.stopPropagation(); dlg.close(); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  return dlg;
}

export function open() {
  if (!dlg) build();
  dlg.showModal();
}

export function toggle() {
  if (dlg?.open) dlg.close(); else open();
}
