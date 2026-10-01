// ── Wiring ───────────────────────────────────────────────────
// One delegated click handler (data-person, data-action, data-export,
// data-handoff, data-bucket, data-view), the keys, history, drops, the
// overview's pointer, and the Auth Kit. No inline handlers: the CSP forbids them.

import { state, ui, person, savePrefs, refreshMe, COLOR_BY } from './state.js'
import { go, step, center } from './nav.js'
import { draw, renderHeader } from './render.js'
import { renderChart } from './render-chart.js'
import { bindOverview, fitOverview, renderOverview, dotRect } from './overview.js'
import { bindSearch, openSearch, openPicker } from './search.js'
import { openEditor, applyEditor, switchFormat, bindEditor, editorReceive } from './editor.js'
import { exportAs, handoff, downloadVcard, copyPersonLink, openText, loadExample, BLANK, restorePrevious, thisIsMe } from './actions.js'
import { setupMenu } from './menus.js'
import { accountEmails } from './me.js'
import { bindDialog, openDialog } from './dialogs.js'
import { fillIcons } from './icons.js'
import { NeoAuth } from './neorgon-auth.js'
import { escHtml, debounce, copyText, showToast, $ } from './utils.js'
import { plural } from './core.js'

let fileTarget = 'app'

export function bindEvents() {
  fillIcons()
  setupMenu($('orgBtn'), $('orgMenu'))
  setupMenu($('handBtn'), $('handMenu'))
  for (const id of ['searchDialog', 'whoDialog', 'editorDialog', 'helpDialog']) bindDialog($(id), $('stage'))
  bindSearch()
  bindEditor()
  bindOverview({ onPick: pickDot, onHover: hoverDot })

  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKey)
  window.addEventListener('popstate', () => {
    const at = new URLSearchParams(location.search).get('at')
    if (at && state.ix?.has(at)) go(at, { push: false })
  })
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#d=')) location.reload() })
  window.addEventListener('resize', debounce(() => { if (ui.view === 'chart') renderChart() }, 150))
  $('colorBy').addEventListener('change', (e) => {
    if (!COLOR_BY.includes(e.target.value)) return
    ui.colorBy = e.target.value
    savePrefs()
    renderOverview()
  })
  $('colorBy').value = ui.colorBy
  $('fileInput').addEventListener('change', onFile)
  document.addEventListener('error', (e) => { if (e.target.matches?.('.avatar__img')) e.target.closest('.avatar').classList.add('avatar--broken') }, true)
  bindSpotlight()
  bindPan()
  bindDrop()
  startAuth()
}

function onClick(e) {
  const t = e.target
  const personBtn = t.closest('[data-person]')
  if (personBtn && !t.closest('#overviewSvg')) {
    const id = personBtn.dataset.person
    if (id === ui.focus && personBtn.classList.contains('node')) { ui.panel = !ui.panel; savePrefs(); draw(); return }
    go(id, { focusDom: personBtn.classList.contains('node') })
    return
  }
  const bucket = t.closest('[data-bucket]')
  if (bucket) {
    const key = bucket.dataset.bucket
    if (ui.expanded.has(key)) ui.expanded.delete(key)
    else ui.expanded.add(key)
    renderChart()
    return
  }
  const view = t.closest('button[data-view]')
  if (view) return setView(view.dataset.view)
  const fmt = t.closest('[data-format]')
  if (fmt) return switchFormat(fmt.dataset.format)
  const exp = t.closest('[data-export]')
  if (exp) return exportAs(exp.dataset.export)
  const hand = t.closest('[data-handoff]')
  if (hand) return handoff(hand.dataset.handoff)
  const copy = t.closest('[data-copy]')
  if (copy) return copyText(copy.dataset.copy).then((ok) => showToast(ok ? 'Copied' : 'Could not copy'))
  const act = t.closest('[data-action]')
  if (act) return action(act.dataset.action, act)
}

function action(name, el) {
  const focus = ui.focus
  switch (name) {
    case 'search': return openSearch(el)
    case 'me': return goMe(el)
    case 'top': return state.ix && go(state.ix.top, { focusDom: true })
    case 'help': return openHelp(el)
    case 'edit': return openEditor({ opener: el })
    case 'edit-person': return openEditor({ opener: el, personId: focus })
    case 'apply': return applyEditor()
    case 'import': fileTarget = 'app'; return $('fileInput').click()
    case 'editor-import': fileTarget = 'editor'; return $('fileInput').click()
    case 'example': return loadExample()
    case 'blank': return openEditor({ opener: el, text: BLANK })
    case 'restore': return restorePrevious()
    case 'close-panel': ui.panel = false; savePrefs(); draw(); return $('stage').focus({ preventScroll: true })
    case 'vcard': return downloadVcard(focus)
    case 'copy-person-link': return copyPersonLink(focus)
    case 'this-is-me': return thisIsMe(focus, true)
    case 'not-me': return thisIsMe(focus, false)
    case 'fit': return fitOverview()
    case 'signin': $('whoDialog').close(); return NeoAuth.openSignIn({ reason: 'Sign in and Rama finds your card by the email on your account.' })
    case 'more-tags':
      for (const x of document.querySelectorAll('[data-tags] [data-extra]')) x.hidden = false
      return el.remove()
    default: return undefined
  }
}

function goMe(el) {
  if (state.me.id) {
    ui.panel = true
    if (ui.focus === state.me.id) { draw(); center() } else go(state.me.id, { focusDom: true })
    return
  }
  openPicker(el)
}

function openHelp(el) {
  openDialog($('helpDialog'), el)
}

export function setView(v) {
  if (v === ui.view || !['chart', 'overview'].includes(v)) return
  ui.view = v
  savePrefs()
  draw()
  if (v === 'chart') center('instant')
}

const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

function onKey(e) {
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); return openSearch(document.activeElement) }
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('dialog[open]')) return
  if (document.querySelector('.header-menu.open')) return
  const keys = {
    ArrowUp: () => step('up'), ArrowDown: () => step('down'), ArrowLeft: () => step('left'), ArrowRight: () => step('right'),
    Home: () => state.ix && go(state.ix.top, { focusDom: true }),
    '/': () => openSearch(document.activeElement),
    m: () => goMe(document.activeElement), M: () => goMe(document.activeElement),
    o: () => setView(ui.view === 'chart' ? 'overview' : 'chart'), O: () => setView(ui.view === 'chart' ? 'overview' : 'chart'),
    p: () => { ui.panel = !ui.panel; savePrefs(); draw() }, P: () => { ui.panel = !ui.panel; savePrefs(); draw() },
    e: () => openEditor({ opener: document.activeElement }), E: () => openEditor({ opener: document.activeElement }),
    '?': () => openHelp(document.activeElement),
    Escape: () => { if (ui.panel && !$('panel').hidden) { ui.panel = false; savePrefs(); draw() } },
  }
  const fn = keys[e.key]
  if (!fn) return
  // Arrows scroll a page; here they walk the org, except inside the panel's own scroll box.
  if (e.key.startsWith('Arrow') && e.target.closest?.('.panel')) return
  e.preventDefault()
  fn()
}

// ── Overview pointer ─────────────────────────────────────────
function pickDot(id) {
  ui.panel = true
  go(id)
}

function hoverDot(id) {
  const tip = $('tip')
  if (!id) { tip.hidden = true; return }
  const p = person(id)
  const r = dotRect(id)
  const box = $('overview').getBoundingClientRect()
  if (!p || !r) return
  const n = state.ix.size.get(id)
  tip.innerHTML = `<strong>${escHtml(p.name)}</strong><span>${escHtml(p.title || '')}</span>${n ? `<span class="tip__n">${escHtml(plural(n, 'person', 'people'))} in their org</span>` : ''}`
  tip.hidden = false
  tip.style.left = `${Math.min(box.width - 220, Math.max(8, r.left - box.left + r.width / 2 - 100))}px`
  tip.style.top = `${Math.max(8, r.top - box.top - 64)}px`
}

// ── Small effects ────────────────────────────────────────────
/** The light that follows the pointer across a card: two custom properties, no layout. */
function bindSpotlight() {
  $('chart').addEventListener('pointermove', (e) => {
    const node = e.target.closest('.node')
    if (!node) return
    const r = node.getBoundingClientRect()
    node.style.setProperty('--mx', `${e.clientX - r.left}px`)
    node.style.setProperty('--my', `${e.clientY - r.top}px`)
  })
}

/** Drag the empty stage to pan the chart, like a map. */
function bindPan() {
  const stage = $('stage')
  let pan = null
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || ui.view !== 'chart' || e.pointerType === 'touch' || e.target.closest('button, a, input, .panel')) return
    pan = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop, id: e.pointerId }
  })
  stage.addEventListener('pointermove', (e) => {
    if (!pan) return
    if (!stage.classList.contains('is-panning')) {
      if (Math.hypot(e.clientX - pan.x, e.clientY - pan.y) < 4) return
      stage.setPointerCapture(pan.id)
      stage.classList.add('is-panning')
    }
    stage.scrollLeft = pan.left - (e.clientX - pan.x)
    stage.scrollTop = pan.top - (e.clientY - pan.y)
  })
  const end = () => { pan = null; stage.classList.remove('is-panning') }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', end)
}

function bindDrop() {
  document.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return
    e.preventDefault()
    document.body.classList.add('is-dropping')
  })
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('is-dropping') })
  document.addEventListener('drop', async (e) => {
    document.body.classList.remove('is-dropping')
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    e.preventDefault()
    if ($('editorDialog').open) editorReceive(await file.text())
    else openText(await file.text(), { source: 'import', name: file.name })
  })
}

async function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (file.size > 3_000_000) return showToast('That file is over 3 MB; Rama reads up to 3 MB', { duration: 3200 })
  const text = await file.text()
  if (fileTarget === 'editor') editorReceive(text)
  else openText(text, { source: 'import', name: file.name })
}

// ── Accounts: only to find the visitor's card by email ───────
function startAuth() {
  NeoAuth.onChange((auth) => {
    const before = state.me.id
    state.emails = accountEmails(auth)
    refreshMe()
    if (state.me.id === before) return renderHeader()
    // A late sign-in moves the view only if the visitor has not started exploring.
    if (state.me.source === 'account' && !ui.moved && state.me.id) {
      showToast(`Found you by your Neorgon email: ${person(state.me.id).name}`, { duration: 3200 })
      ui.panel = true
      go(state.me.id, { push: false })
      ui.moved = false
    } else draw()
  })
  NeoAuth.start({ siteName: 'Rama' }).catch(() => { /* no key or blocked: Rama works signed out */ })
}
