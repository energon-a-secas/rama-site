// ── The overview ─────────────────────────────────────────────
// The whole org at once: the top person at the centre, each level a ring
// further out, each division a wedge sized by how many people it holds. The
// path from the centre to the focused person is drawn bright; the visitor's
// own dot pulses. The rings and dots are built once per document and colour
// mode; a focus change only repaints the path and three classes.

import { state, ui, person } from './state.js'
import { isExternal } from './tree.js'
import { TRACK_COLORS } from './roles.js'
import { hash, safeColor } from './core.js'
import { escHtml, $ } from './utils.js'
import { hueOf } from './people.js'
import { plural } from './core.js'

const RING = 92
const TAU = Math.PI * 2
const EMPLOYMENT_COLORS = { employee: '#34d399', contractor: '#fbbf24', vendor: '#fb923c', intern: '#38bdf8' }
const OTHER = '#64748b'

let built = { key: '', pos: null, extent: 0 }
let view = { x: 0, y: 0, k: 1 }

/** Radial tidy layout: a wedge per subtree proportional to its leaves. */
function layout(ix) {
  const leaves = new Map()
  for (let i = ix.order.length - 1; i >= 0; i--) {
    const id = ix.order[i]
    const kids = ix.kids(id)
    leaves.set(id, kids.length ? kids.reduce((n, c) => n + leaves.get(c), 0) : 1)
  }
  const pos = new Map()
  const span = new Map([[ix.top, [0, TAU]]])
  let maxDepth = 0
  for (const id of ix.order) {
    const [a0, a1] = span.get(id)
    const d = ix.depth.get(id)
    maxDepth = Math.max(maxDepth, d)
    const a = (a0 + a1) / 2
    const r = d * RING
    pos.set(id, { a, r, x: d ? Math.sin(a) * r : 0, y: d ? -Math.cos(a) * r : 0, d })
    let cur = a0
    const total = leaves.get(id)
    for (const c of ix.kids(id)) {
      const w = (a1 - a0) * (leaves.get(c) / total)
      span.set(c, [cur, cur + w])
      cur += w
    }
  }
  return { pos, extent: maxDepth * RING + 70, maxDepth }
}

function colorOf(p) {
  const by = ui.colorBy
  if (by === 'track') return TRACK_COLORS[p.track] || OTHER
  if (by === 'employment') return p.status === 'open' ? OTHER : EMPLOYMENT_COLORS[p.employment] || OTHER
  if (by === 'country') return p.country ? `hsl(${hash(p.country) % 360} 72% 62%)` : OTHER
  if (by === 'team') {
    const t = state.ix.teamById.get(p.team) || state.ix.teamById.get((state.ix.teamsOf.get(p.id) || [])[0]?.team)
    return t ? safeColor(t.color, `hsl(${hash(t.id) % 360} 70% 62%)`) : OTHER
  }
  return `hsl(${hueOf(p.id)} 72% 62%)`
}

const linkPath = (a, b) => {
  if (!a.d) return `M0 0L${b.x} ${b.y}`
  const rm = (a.r + b.r) / 2
  const c1 = { x: Math.sin(a.a) * rm, y: -Math.cos(a.a) * rm }
  const c2 = { x: Math.sin(b.a) * rm, y: -Math.cos(b.a) * rm }
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
}

export function renderOverview() {
  const ix = state.ix
  const svg = $('overviewSvg')
  if (!ix) return
  const key = `${ix.model.people.length}|${ix.order.join(',').length}|${ui.colorBy}|${state.me.id}`
  if (built.key !== key || built.ix !== ix) build(ix, svg, key)
  paintFocus()
  renderLegend()
}

function build(ix, svg, key) {
  const { pos, extent, maxDepth } = layout(ix)
  built = { key, ix, pos, extent }
  const rings = Array.from({ length: maxDepth }, (_, i) => `<circle class="ov-ring" r="${(i + 1) * RING}"/>`).join('')
  const links = []
  const dots = []
  const labels = []
  for (const id of ix.order) {
    const p = person(id)
    const at = pos.get(id)
    const parent = ix.parentOf(id)
    if (parent) links.push(`<path class="ov-link" d="${linkPath(pos.get(parent), at)}"/>`)
    const size = ix.size.get(id)
    const r = Math.min(15, 3.2 + Math.sqrt(size) * 1.25)
    const cls = ['ov-dot', p.status === 'open' && 'is-open', isExternal(p) && 'is-external', p.virtual && 'is-org', id === state.me.id && 'is-me'].filter(Boolean).join(' ')
    dots.push(`<circle class="${cls}" data-person="${escHtml(id)}" cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="${r.toFixed(1)}" style="--c:${colorOf(p)};--d:${(hash(id) % 4000) / 1000}s"/>`)
    if (at.d <= 1 || id === state.me.id) {
      const right = at.x >= -1
      const dx = at.d ? (right ? r + 6 : -(r + 6)) : 0
      const dy = at.d ? 4 : r + 16
      labels.push(`<text class="ov-label${at.d ? '' : ' ov-label--top'}${id === state.me.id ? ' ov-label--me' : ''}" x="${(at.x + dx).toFixed(1)}" y="${(at.y + dy).toFixed(1)}" text-anchor="${at.d ? (right ? 'start' : 'end') : 'middle'}">${escHtml(p.name)}</text>`)
    }
  }
  svg.setAttribute('viewBox', `${-extent} ${-extent} ${extent * 2} ${extent * 2}`)
  const title = svg.querySelector('title')?.outerHTML || ''
  svg.innerHTML = `${title}<g id="ovWorld"><g class="ov-rings">${rings}</g><g class="ov-links">${links.join('')}</g>` +
    `<g id="ovPath"></g><g class="ov-dots">${dots.join('')}</g><g class="ov-labels">${labels.join('')}</g><g id="ovFocus"></g></g>`
  applyView()
}

/** The bright path, the focus ring and the focused label: cheap enough for every move. */
export function paintFocus() {
  const ix = state.ix
  if (!ix || !built.pos) return
  const chain = ix.chain(ui.focus || ix.top)
  const segs = []
  for (let i = 1; i < chain.length; i++) segs.push(linkPath(built.pos.get(chain[i - 1]), built.pos.get(chain[i])))
  const g = $('ovPath')
  if (!g) return
  const d = segs.join('')
  g.innerHTML = d ? `<path class="ov-path" d="${d}"/><path class="ov-path ov-path--pulse" d="${d}"/>` : ''
  const glow = g.querySelector('.ov-path')
  if (glow) glow.style.setProperty('--len', String(Math.ceil(glow.getTotalLength())))
  for (const el of $('overviewSvg').querySelectorAll('.ov-dot.is-focus, .ov-dot.is-path')) el.classList.remove('is-focus', 'is-path')
  const onPath = new Set(chain)
  for (const id of onPath) {
    const el = $('overviewSvg').querySelector(`.ov-dot[data-person="${CSS.escape(id)}"]`)
    if (el) el.classList.add(id === ui.focus ? 'is-focus' : 'is-path')
  }
  const f = built.pos.get(ui.focus)
  const p = person(ui.focus)
  $('ovFocus').innerHTML = f && p && f.d > 1
    ? `<circle class="ov-halo" cx="${f.x.toFixed(1)}" cy="${f.y.toFixed(1)}" r="22"/><text class="ov-label ov-label--focus" x="${f.x.toFixed(1)}" y="${(f.y - 26).toFixed(1)}" text-anchor="middle">${escHtml(p.name)}</text>`
    : ''
}

function renderLegend() {
  const ix = state.ix
  const counts = new Map()
  const add = (label, color) => {
    const k = `${label}|${color}`
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  for (const p of ix.model.people) {
    const by = ui.colorBy
    if (by === 'branch') {
      const b = ix.branchOf(p.id)
      add(b === ix.top ? person(b).name : person(b).name, `hsl(${hueOf(b)} 72% 62%)`)
    } else if (by === 'track') add(p.track, colorOf(p))
    else if (by === 'employment') add(p.status === 'open' ? 'open role' : p.employment, colorOf(p))
    else if (by === 'country') add(p.country || 'no country', colorOf(p))
    else {
      const t = ix.teamById.get(p.team) || ix.teamById.get((ix.teamsOf.get(p.id) || [])[0]?.team)
      add(t ? t.name : 'no team', colorOf(p))
    }
  }
  const rows = [...counts].sort((a, b) => b[1] - a[1])
  const shown = rows.slice(0, 9)
  const rest = rows.slice(9).reduce((n, [, c]) => n + c, 0)
  $('legend').innerHTML = shown.map(([k, n]) => {
    const [label, color] = k.split('|')
    return `<li><span class="swatch" style="--c:${color}"></span>${escHtml(label)} <span class="legend__n">${n}</span></li>`
  }).join('') + (rest ? `<li class="legend__rest">${plural(rest, 'more')}</li>` : '')
}

// ── Pan and zoom ─────────────────────────────────────────────
function applyView() {
  const g = $('ovWorld')
  if (g) g.setAttribute('transform', `translate(${view.x.toFixed(1)} ${view.y.toFixed(1)}) scale(${view.k.toFixed(3)})`)
}

export function fitOverview() {
  view = { x: 0, y: 0, k: 1 }
  applyView()
}

function svgPoint(svg, e) {
  const m = svg.getScreenCTM()
  if (!m) return { x: 0, y: 0 }
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
  return { x: p.x, y: p.y }
}

export function bindOverview({ onPick, onHover }) {
  const svg = $('overviewSvg')
  svg.addEventListener('wheel', (e) => {
    e.preventDefault()
    const pt = svgPoint(svg, e)
    const k = Math.min(6, Math.max(0.5, view.k * Math.exp(-e.deltaY * 0.0016)))
    view.x = pt.x - ((pt.x - view.x) * k) / view.k
    view.y = pt.y - ((pt.y - view.y) * k) / view.k
    view.k = k
    applyView()
  }, { passive: false })
  let drag = null
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    drag = { start: svgPoint(svg, e), x: view.x, y: view.y, moved: false, id: e.pointerId }
  })
  svg.addEventListener('pointermove', (e) => {
    if (drag) {
      const pt = svgPoint(svg, e)
      const dx = pt.x - drag.start.x
      const dy = pt.y - drag.start.y
      if (!drag.moved && Math.hypot(dx, dy) < 4) return
      if (!drag.moved) svg.setPointerCapture(drag.id)
      drag.moved = true
      view.x = drag.x + dx
      view.y = drag.y + dy
      applyView()
      return
    }
    onHover(e.target.closest?.('.ov-dot')?.dataset.person || null, e)
  })
  const end = (e) => {
    const was = drag
    drag = null
    if (was && !was.moved) {
      const id = e.target.closest?.('.ov-dot')?.dataset.person
      if (id) onPick(id)
    }
  }
  svg.addEventListener('pointerup', end)
  svg.addEventListener('pointercancel', () => { drag = null })
  svg.addEventListener('pointerleave', () => onHover(null))
}

/** Where a person's dot is on screen, for the tooltip. */
export function dotRect(id) {
  return $('overviewSvg').querySelector(`.ov-dot[data-person="${CSS.escape(id)}"]`)?.getBoundingClientRect() || null
}
