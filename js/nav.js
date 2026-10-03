// ── Moving around ────────────────────────────────────────────
// go(id) is the only way the focus changes. In the chart it runs inside a
// view transition: every card is named p-<id>, so the browser morphs each
// one from its old place to its new one, and cards that arrive or leave fade.
// Each move is a history entry (?at=<id>), so Back walks back through the org.

import { state, ui, person } from './state.js'
import { focusView } from './tree.js'
import { draw, announce } from './render.js'
import { focusEl } from './render-chart.js'
import { paintFocus } from './overview.js'
import { prefersReducedMotion } from './neorgon-dom.js'
import { $ } from './utils.js'
import { plural } from './core.js'

export function go(id, { push = true, focusDom = false } = {}) {
  const ix = state.ix
  if (!ix || !ix.has(id)) return
  if (id === ui.focus) {
    if (focusDom) focusEl()?.focus({ preventScroll: true })
    return
  }
  ui.moved = true
  if (push) pushAt(id)
  const p = person(id)
  const n = ix.kids(id).length
  announce(`${p.name}${p.title ? `, ${p.title}` : ''}${n ? `, ${plural(n, 'direct report')}` : ''}`)

  // The focus moves now, not inside the transition: a second key pressed mid-flight steps from here.
  const wasCards = document.querySelectorAll('#chart .node').length
  ui.focus = id
  if (ui.view === 'overview') {
    paintFocus()
    draw()
    return
  }
  const apply = () => {
    draw()
    center('instant')
  }
  const after = () => { if (focusDom) focusEl()?.focus({ preventScroll: true }) }
  // Every card is a named transition element; past a few hundred the browser stalls, so a wide org just cuts.
  const small = wasCards <= MAX_MORPH && cardsFor(ix, id) <= MAX_MORPH
  if (small && document.startViewTransition && !prefersReducedMotion() && !document.hidden) {
    const lift = liftFrame()
    document.startViewTransition(apply).finished.finally(() => { lift(); after() })
  } else {
    apply()
    after()
  }
}

const MAX_MORPH = 150

/** How many cards the chart draws around id: the chain, the lead, the row, and each column up to its fold. */
function cardsFor(ix, id) {
  const v = focusView(ix, id)
  return v.chain.length + 1 + v.row.length + v.columns.reduce((n, c) => n + Math.min(c.people.length, 9) + Math.min(c.external.length, 1) + Math.min(c.open.length, 1), 0)
}

/**
 * The page's frame (header, stage bar, panel, footer) gets a transition name
 * of its own for the length of one move, so chart.css can stack it above the
 * cards in flight: a card leaving the stage slides under the frame instead
 * of across it. Set inline and removed after, so no site CSS styles the
 * kit's header.
 */
const FRAME = ['.header-bar', '.stagebar', '.panel', '.neo-footer']
function liftFrame() {
  // Visible, not offsetParent: the phone sheet is position: fixed, whose offsetParent is always null.
  const els = FRAME.map((sel) => document.querySelector(sel)).filter((el) => el && !el.hidden && el.getClientRects().length > 0)
  els.forEach((el, i) => { el.style.viewTransitionName = `rama-frame-${i}` })
  return () => els.forEach((el) => { el.style.viewTransitionName = '' })
}

/** Put the focused card a third of the way down the stage, centred across. */
export function center(behavior = 'smooth') {
  const stage = $('stage')
  const el = focusEl()
  if (!el || ui.view !== 'chart') return
  const s = stage.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  stage.scrollTo({
    left: stage.scrollLeft + (r.left + r.width / 2) - (s.left + s.width / 2),
    top: stage.scrollTop + (r.top - s.top) - Math.max(24, s.height * 0.32),
    behavior: prefersReducedMotion() ? 'instant' : behavior,
  })
}

function pushAt(id) {
  const url = new URL(location.href)
  url.searchParams.set('at', id)
  url.hash = ''
  history.pushState({ at: id }, '', url)
}

export function replaceAt(id) {
  const url = new URL(location.href)
  if (id) url.searchParams.set('at', id)
  else url.searchParams.delete('at')
  history.replaceState({ at: id || null }, '', url)
}

/** Arrow-key moves: up to the manager, down to the first report, across to peers. */
export function step(dir) {
  const ix = state.ix
  if (!ix) return
  const id = ui.focus || ix.top
  let to = null
  if (dir === 'up') to = ix.parentOf(id)
  else if (dir === 'down') to = ix.kids(id)[0] || null
  else {
    const parent = ix.parentOf(id)
    const peers = parent ? ix.kids(parent) : [id]
    const i = peers.indexOf(id)
    to = peers[i + (dir === 'left' ? -1 : 1)] || null
  }
  if (to) go(to, { focusDom: true })
  else announce(dir === 'up' ? 'Already at the top' : dir === 'down' ? 'No reports below' : 'No more peers that way')
}
