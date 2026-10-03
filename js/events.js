// ── Wiring ───────────────────────────────────────────────────
// One delegated click handler (data-person, data-action, data-export,
// data-handoff, data-bucket, data-view), the keys, history, drops, the
// overview's pointer, and the Auth Kit. No inline handlers: the CSP forbids them.

import { state, ui, person, savePrefs, refreshMe, trustDoc, COLOR_BY } from './state.js'
import { go, step, center, replaceAt } from './nav.js'
import { draw, drawAll, renderHeader, announce, paintEdges } from './render.js'
import { renderChart } from './render-chart.js'
import { bindOverview, fitOverview, zoomOverview, renderOverview, dotRect } from './overview.js'
import { bindSearch, openSearch, openPicker } from './search.js'
import { openEditor, applyEditor, switchFormat, bindEditor, editorReceive } from './editor.js'
import { exportAs, handoff, downloadVcard, copyPersonLink, openText, loadExample, BLANK, restorePrevious, thisIsMe } from './actions.js'
import { setupMenu } from './menus.js'
import { accountEmails } from './me.js'
import { bindDialog, openDialog } from './dialogs.js'
import { fillIcons } from './icons.js'
import { NeoAuth } from './neorgon-auth.js'
import { init as initKeys } from './neokeys/index.js'
import { escHtml, debounce, copyText, showToast, $ } from './utils.js'
import { plural } from './core.js'
import { localTime } from './panel.js'

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
    // That card is gone (renamed in the editor, say): make the URL say what the screen shows.
    else if (state.ix) replaceAt(ui.focus)
  })
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#d=')) location.reload() })
  // The overview rebuilds when its size changed, so dots and labels keep their screen size.
  window.addEventListener('resize', debounce(() => { if (ui.view === 'chart') renderChart(); else renderOverview(); paintEdges() }, 150))
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
  bindKeys()
  startAuth()
}

function onClick(e) {
  const t = e.target
  const personBtn = t.closest('[data-person]')
  if (personBtn && !t.closest('#overviewSvg')) {
    const id = personBtn.dataset.person
    if (id === ui.focus && personBtn.classList.contains('node')) {
      ui.panel = !ui.panel
      savePrefs()
      draw()
      refocus(`.node[data-person="${CSS.escape(id)}"]`)
      return
    }
    // Focus follows the move from anywhere (a card, a chip in the panel, a phone's "N reports"), never dropping to <body>.
    go(id, { focusDom: true })
    return
  }
  const bucket = t.closest('[data-bucket]')
  if (bucket) {
    const key = bucket.dataset.bucket
    const opening = !ui.expanded.has(key)
    if (opening) ui.expanded.add(key)
    else ui.expanded.delete(key)
    renderChart()
    // Keep the keyboard where it was: on the bucket's fold button, or the bucket itself once folded.
    refocus(`[data-bucket="${CSS.escape(key)}"]`)
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
    case 'blank': return openEditor({ opener: el, text: BLANK, source: 'blank' })
    case 'restore': return restorePrevious(Number(el.dataset.index) || 0)
    case 'close-panel': return togglePanel(false)
    case 'vcard': return downloadVcard(focus)
    case 'copy-person-link': return copyPersonLink(focus)
    case 'this-is-me': thisIsMe(focus, true); return refocus('[data-action="not-me"], [data-action="this-is-me"]')
    case 'not-me': thisIsMe(focus, false); return refocus('[data-action="this-is-me"], [data-action="not-me"]')
    case 'fit': return fitOverview()
    case 'zoom-in': return zoomOverview(1.3)
    case 'zoom-out': return zoomOverview(1 / 1.3)
    case 'allow-photos': trustDoc(); return drawAll()
    case 'signin': $('whoDialog').close(); return NeoAuth.openSignIn({ reason: 'Sign in and Rama finds your card by the email on your account.' })
    case 'more-tags': {
      // A toggle rather than a button that removes itself, so focus has somewhere to stay.
      const open = el.getAttribute('aria-expanded') !== 'true'
      for (const x of document.querySelectorAll('[data-tags] [data-extra]')) x.hidden = !open
      el.setAttribute('aria-expanded', String(open))
      el.textContent = open ? 'Fewer' : el.dataset.more
      return undefined
    }
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
  const hadFocus = document.activeElement
  ui.view = v
  savePrefs()
  draw()
  if (v === 'chart') center('instant')
  // A card hidden by the switch takes focus with it: land on the focused card, or the stage.
  if (!hadFocus || hadFocus === document.body || !hadFocus.isConnected || !hadFocus.getClientRects().length) {
    const card = v === 'chart' ? document.querySelector('.node.is-focus') : null
    ;(card || $('stage')).focus({ preventScroll: true })
  }
}

const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

/**
 * Keys that are not shortcuts in the WCAG 2.1.4 sense stay here: Ctrl or Cmd+K
 * (a modifier chord) and Escape. Every single-key shortcut is registered with
 * the Keys kit below, whose ? sheet lists them, turns them off, and remaps them.
 */
function onKey(e) {
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); return openSearch(document.activeElement) }
  if (e.key === 'Escape' && !$('tip').hidden) { $('tip').hidden = true; return }
  if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('dialog[open]')) return
  if (document.querySelector('.header-menu.open')) return
  if (ui.panel && !$('panel').hidden) { e.preventDefault(); togglePanel(false) }
}

/** The page's single-key shortcuts, as data for the Keys kit. A key declines (returns false) under a dialog or an open menu. */
function bindKeys() {
  const keys = initKeys({})
  const busy = () => !!document.querySelector('dialog[open], .header-menu.open')
  const when = (fn) => (e) => (busy() ? false : fn(e))
  // An arrow inside the panel scrolls the panel, like any other scroll box.
  const walk = (dir) => when((e) => (e.target.closest?.('.panel') ? false : step(dir)))
  keys.register([
    { key: 'ArrowUp', label: 'Their manager', group: 'Moving around', run: walk('up') },
    { key: 'ArrowDown', label: 'Their first report', group: 'Moving around', run: walk('down') },
    { key: 'ArrowLeft', label: 'The previous peer', group: 'Moving around', run: walk('left') },
    { key: 'ArrowRight', label: 'The next peer', group: 'Moving around', run: walk('right') },
    { key: 'Home', label: 'The top of the org', group: 'Moving around', run: when(() => state.ix && go(state.ix.top, { focusDom: true })) },
    { key: 'm', label: 'Your own card', hint: 'Or pick it, the first time', group: 'Moving around', run: when(() => goMe(document.activeElement)) },
    { key: '/', label: 'Search people', hint: 'Ctrl or Cmd+K works too', run: when(() => openSearch(document.activeElement)) },
    { key: 'o', label: 'Chart or Overview', run: when(() => setView(ui.view === 'chart' ? 'overview' : 'chart')) },
    { key: 'p', label: 'Show or hide the profile', run: when(() => togglePanel()) },
    { key: 'd', label: 'Edit the document', run: when(() => openEditor({ opener: document.activeElement })) },
  ])
}

/**
 * Show or hide the profile. Focus that was inside the panel, or on a card the
 * re-render replaced, lands on the focused card instead of falling to <body>.
 */
function togglePanel(open = !ui.panel) {
  const inside = $('panel').contains(document.activeElement)
  ui.panel = open
  savePrefs()
  draw()
  announce(open ? 'Profile open' : 'Profile closed')
  if (inside || !document.activeElement || document.activeElement === document.body) {
    const card = ui.view === 'chart' ? document.querySelector('.node.is-focus') : null
    ;(card || $('stage')).focus({ preventScroll: true })
  }
}

/** A re-render replaced the control that had focus: put focus on its replacement. */
function refocus(selector) {
  if (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected) return
  document.querySelector(selector)?.focus({ preventScroll: true })
}

// ── Overview pointer ─────────────────────────────────────────
function pickDot(id) {
  ui.panel = true
  savePrefs()
  // The person already in focus: go() would do nothing, and the panel would stay shut.
  if (id === ui.focus) draw()
  else go(id)
}

let tipTimer = 0
function hoverDot(id) {
  const tip = $('tip')
  clearTimeout(tipTimer)
  // It lingers a moment so the pointer can reach it, and Escape dismisses it (WCAG 1.4.13).
  if (!id) { tipTimer = setTimeout(() => { if (!tip.matches(':hover')) tip.hidden = true }, 350); return }
  const p = person(id)
  const r = dotRect(id)
  const box = $('overview').getBoundingClientRect()
  if (!p || !r) return
  const n = state.ix.size.get(id)
  const clock = ui.colorBy === 'time' && p.tz ? `<span class="tip__n">${escHtml(localTime(p.tz))}</span>` : ''
  tip.innerHTML = `<strong>${escHtml(p.name)}</strong><span>${escHtml(p.title || '')}</span>${clock}${n ? `<span class="tip__n">${escHtml(plural(n, 'person', 'people'))} in their org</span>` : ''}`
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
  // The edge fades follow the scroll, once a frame at most.
  let queued = false
  stage.addEventListener('scroll', () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; paintEdges() })
  }, { passive: true })
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
    if ($('editorDialog').open) editorReceive(await file.text(), file.name)
    else openText(await file.text(), { source: 'import', name: file.name })
  })
}

async function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (file.size > 3_000_000) return showToast('That file is over 3 MB; Rama reads up to 3 MB', { duration: 3200 })
  const text = await file.text()
  if (fileTarget === 'editor') editorReceive(text, file.name)
  else openText(text, { source: 'import', name: file.name })
}

// ── Accounts: only to find the visitor's card by email ───────
function startAuth() {
  NeoAuth.onChange((auth) => {
    const before = state.me.id
    state.emails = accountEmails(auth)
    refreshMe()
    if (state.me.id === before) return renderHeader()
    // A late sign-in moves the view only if the visitor has not started exploring,
    // and never off a card the opening link named (?at=).
    if (state.me.source === 'account' && !ui.moved && !ui.atLink && state.me.id) {
      showToast(`Found you by your Neorgon email: ${person(state.me.id).name}`, { duration: 3200 })
      ui.panel = true
      go(state.me.id, { push: false })
      replaceAt(state.me.id)
      ui.moved = false
    } else draw()
  })
  NeoAuth.start({ siteName: 'Rama' }).catch(() => { /* no key or blocked: Rama works signed out */ })
}
