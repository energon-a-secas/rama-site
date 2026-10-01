// ── Header menus ─────────────────────────────────────────────
// The kit styles .header-menu and closes its own ⋯ panel; the site opens and
// closes its menus (Reparto's pattern). Each closes only itself and its
// sibling, listens for outside clicks in the capture phase, and never stops
// propagation, so the kit's own closer still sees every click.

const menus = []

export function setupMenu(btn, menu) {
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter((el) => !el.hidden && !el.disabled)
  const close = (focusBtn = false) => {
    if (!menu.classList.contains('open')) return
    menu.classList.remove('open')
    btn.setAttribute('aria-expanded', 'false')
    if (focusBtn) btn.focus()
  }
  menus.push(close)
  btn.addEventListener('click', () => {
    const open = !menu.classList.contains('open')
    menus.forEach((c) => c())
    menu.classList.toggle('open', open)
    btn.setAttribute('aria-expanded', String(open))
    if (open) items()[0]?.focus()
  })
  document.addEventListener('click', (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) close() }, true)
  // Focus returns to the button before the item's action runs, so a dialog it opens returns there.
  menu.addEventListener('click', (e) => { if (e.target.closest('[role="menuitem"]')) close(true) })
  menu.addEventListener('keydown', (e) => {
    const list = items()
    const i = list.indexOf(document.activeElement)
    const move = (n) => { e.preventDefault(); list[(n + list.length) % list.length]?.focus() }
    if (e.key === 'ArrowDown') move(i + 1)
    else if (e.key === 'ArrowUp') move(i - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(list.length - 1)
    else if (e.key === 'Tab') close()
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
  })
}

export const closeMenus = () => menus.forEach((c) => c())
