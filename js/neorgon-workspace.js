/**
 * Neorgon Workspace Kit: the browser client (NeoWorkspace)
 * Canonical source: packages/neorgon-ui/workspace/workspace.js
 * Vendored as js/neorgon-workspace.js by packages/neorgon-ui/sync-workspace.sh
 *
 *   // in a tool's own module, beside the vendored js/neorgon-workspace.js:
 *   //   import { NeoWorkspace } from <that file>
 *   const ws = NeoWorkspace.init({ tool: 'floorplan', name: 'Floorplan', onTeam, actions, section })
 *   ws.mountGear()
 *
 * Call init before the tool reads its own location.hash: a pick's answer
 * (#neo-ws=...) is read, cached and stripped here, and the tool's own fragment
 * from before the round trip is put back.
 *
 * Every value from the cookie, the cache, the frame and the address bar goes
 * through the core's readers. The sheet (workspace-sheet.js) builds its DOM
 * with textContent only.
 *
 * Do not edit a vendored copy. Edit here and run sync-workspace.sh.
 */
import * as W from './neorgon-workspace-core.js'
import { createStore, safeGet, safeSet } from './neorgon-persist.js'
import { openSheet, isSheetOpen, renderBanner } from './neorgon-workspace-sheet.js'

const HASH_KEY = 'neo-ws:return-hash'   // sessionStorage: { h, t, k }, the tool's own fragment across a round trip, and which trip
const HASH_TTL = 30 * 60 * 1000         // a save's way back carries no fragment; past this, a bare visit is a new one
const HASH_MAX = 16000                  // characters of the tool's own fragment kept across a trip
const STAMP_SKEW = 5 * 60 * 1000        // ms: an answer's stamp further in the future than this is no stamp
const KEY_OFF = 'neo-ws:comma-off'      // localStorage: '1' when the visitor turned the , key off (no NeoKeys)
const LOAD_CEILING = 5000               // ms: a frame that never loads is no frame (Firefox and WebKit fire no load for a refused connection)
const GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'

const readCookies = () => { try { return document.cookie } catch { return '' } }
const writeCookie = (s) => { if (s) { try { document.cookie = s } catch { /* cookies blocked: settings last this visit */ } } }
function session(op, value) {
  try {
    if (op === 'get') return sessionStorage.getItem(HASH_KEY)
    if (op === 'set') sessionStorage.setItem(HASH_KEY, value)
    else sessionStorage.removeItem(HASH_KEY)
  } catch { /* no session storage: the tool's own fragment is lost, the answer is not */ }
  return null
}
const where = () => ({ protocol: location.protocol, hostname: location.hostname })
const requestId = () => 'ws-' + Math.random().toString(36).slice(2, 12)
const sameTeam = (a, b) => a.status === b.status && a.stamp === b.stamp && a.ws === b.ws

let instance = null

export const NeoWorkspace = {
  /** The client for this page. A second call returns the first instance. Throws when `tool` is not in adopters.txt. */
  init(opts = {}) {
    if (!instance) instance = create(opts)
    return instance
  },
  /** The instance init made, or null. */
  get current() { return instance },
}

function create(opts) {
  const tool = opts.tool
  if (!W.ADOPTERS.includes(tool)) throw new TypeError(`NeoWorkspace.init: "${String(tool)}" is not in workspace/adopters.txt`)
  const name = W.str(opts.name, 60) || W.toolName(tool)
  const actions = W.isMap(opts.actions) ? opts.actions : {}
  const section = W.isMap(opts.section) && typeof opts.section.render === 'function' ? opts.section : null
  const navigate = typeof opts.navigate === 'function' ? opts.navigate : (url) => location.assign(url)
  const cache = createStore({ key: W.CACHE_KEY, version: W.STORE_VERSION })
  const origin = W.workspaceOrigin({ hostname: location.hostname, devOrigin: safeGet(W.DEV_ORIGIN_KEY, '') || '' })
  const listeners = { prefs: new Set(), team: new Set() }
  let team = { status: 'none', ws: null, stamp: '' }
  let frame = { state: origin ? 'pending' : 'none', el: null, id: '' }
  let lastPrefs = ''
  let keyBound = false
  let started = false      // nothing is emitted until init has returned
  const issues = []

  const emit = (type, value) => {
    for (const fn of [...listeners[type]]) { try { fn(value) } catch (err) { console.error('[NeoWorkspace]', err) } }
  }

  // ── Settings (neo_me) ─────────────────────────────────────
  const rawPrefs = () => W.readMe(readCookies()) || {}
  const prefs = () => W.withDefaults(rawPrefs())

  function setPrefs(patch) {
    if (!W.isMap(patch)) return prefs()
    const next = { ...rawPrefs() }
    for (const k of ['tz', 'h', 'd', 'w', 'c', 'cc']) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue
      if (patch[k] === null || patch[k] === undefined) delete next[k]
      else next[k] = patch[k]
    }
    const clean = W.cleanPrefs(next)
    writeCookie(Object.keys(clean).length ? W.meCookie(clean, where()) : W.clearCookie(W.COOKIE_ME, where()))
    notePrefs(true)
    return prefs()
  }

  function notePrefs(force) {
    const now = JSON.stringify(prefs())
    if (now === lastPrefs && !force) return
    lastPrefs = now
    emit('prefs', JSON.parse(now))
  }

  // ── The team ──────────────────────────────────────────────
  function readCache() {
    const rec = W.normalizeRecord(cache.load(null))
    return rec && rec.ws ? rec : null
  }

  function settle(msg) {
    const cookie = W.readStamp(readCookies()) || ''
    const rec = readCache()
    let next
    if (msg && msg.status === 'shared') {
      if (msg.ws) {
        next = { status: 'shared', ws: msg.ws, stamp: msg.stamp }
        if (!rec || rec.stamp !== msg.stamp || !msg.stamp) cache.save({ stamp: msg.stamp, ws: msg.ws })
      } else {
        cache.clear()
        next = { status: 'none', ws: null, stamp: '' }
      }
    } else {
      // Not shared: this tool's copy, or the frame's when it is newer (a save the cookie has not caught up with).
      const age = (stamp) => W.stampTime(stamp) || 0
      const pick = msg && msg.ws && (!rec || age(msg.stamp) > age(rec.stamp)) ? { ws: msg.ws, stamp: msg.stamp } : rec
      if (!pick) next = { status: 'none', ws: null, stamp: '' }
      else next = { status: pick === rec && (!cookie || rec.stamp === cookie) ? 'cached' : 'stale', ws: pick.ws, stamp: pick.stamp }
    }
    // Keep the object the tool already holds when nothing it can see changed.
    if (team.ws && next.ws && next.stamp && next.stamp === team.stamp) next.ws = team.ws
    if (sameTeam(team, next)) return false
    const hadWs = team.ws, oldStamp = team.stamp
    team = next
    if (!started) return true
    emit('team', snapshot())
    if (team.ws && (team.ws !== hadWs || team.stamp !== oldStamp)) callOnTeam()
    return true
  }

  function callOnTeam() {
    if (typeof opts.onTeam !== 'function' || !team.ws) return
    try { opts.onTeam(team.ws, { status: team.status, stamp: team.stamp }) } catch (err) { console.error('[NeoWorkspace] onTeam', err) }
  }

  // A frame state change the team did not reflect still reaches the sheet's status line.
  const settleAndTell = (msg) => { if (!settle(msg) && started) emit('team', snapshot()) }

  const snapshot = () => ({ status: team.status, ws: team.ws, stamp: team.stamp, frame: frame.state, issues: issues.slice() })

  /** The round trip this tab left on, read once and forgotten: { hash, kind } ('save' | 'pick'), or null when none is pending. */
  function takeTrip() {
    let saved = null
    try { saved = JSON.parse(session('get') || 'null') } catch { saved = null }
    session('remove')
    if (!W.isMap(saved) || !(Date.now() - saved.t < HASH_TTL) || !(saved.t <= Date.now())) return null
    const h = saved.h
    const hash = typeof h === 'string' && h.length <= HASH_MAX && /^#[^\s]*$/.test(h) && !W.parseFragment(h) ? h : ''
    return { hash, kind: saved.k === 'pick' ? 'pick' : 'save' }
  }

  const putHash = (hash) => { try { history.replaceState(history.state, '', location.pathname + location.search + hash) } catch { /* sandboxed: the hash stays */ } }

  // A pick's answer: #neo-ws=<payload>&stamp=<stamp>. Taken only when this tab started a pick
  // (load() leaves a one-time marker in sessionStorage), so a link from anywhere else cannot
  // plant a team, and a replay from history finds the marker gone. Read once, cached, stripped,
  // and the tool's own fragment put back. Back from a save there is no fragment: the saved one returns.
  // A visit with a fragment of the tool's own means the trip was abandoned (Back): it is forgotten.
  function takeAnswer() {
    let hash = ''
    try { hash = location.hash } catch { return }
    const got = W.parseFragment(hash)
    if (!got || got.op !== 'answer') {
      const trip = takeTrip()
      if (trip && trip.hash && (hash === '' || hash === '#')) putHash(trip.hash)
      return
    }
    const trip = takeTrip()
    putHash(trip ? trip.hash : '')
    if (!trip || trip.kind !== 'pick') {
      issues.push({ level: 'warn', msg: 'A team link arrived that this tab did not ask for, so it was ignored.' })
      return
    }
    const read = W.decodePayload(got.payload)
    if (!read) { issues.push({ level: 'error', msg: 'The team that came back could not be read.' }); return }
    issues.push(...read.issues.slice(0, 20))
    // A stamp from the future would outrank every later copy: it counts as none.
    const stamp = got.stamp && W.stampTime(got.stamp) <= Date.now() + STAMP_SKEW ? got.stamp : ''
    cache.save({ stamp, ws: read.ws })
  }

  // ── The read-only frame ───────────────────────────────────
  function connect() {
    if (!origin || typeof document === 'undefined') return
    const el = document.createElement('iframe')
    el.className = 'neo-ws-frame'
    el.hidden = true
    el.tabIndex = -1
    el.title = 'Neorgon workspace (read-only)'
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('referrerpolicy', 'no-referrer')
    el.src = origin + W.VAULT_PATH
    frame.el = el
    let answerTimer = 0, retry = 0
    const giveUp = () => { if (frame.state === 'pending') { frame.state = 'none'; settleAndTell(null) } }
    const loadTimer = setTimeout(giveUp, LOAD_CEILING)
    window.addEventListener('message', (event) => {
      if (event.origin !== origin || !el.contentWindow || event.source !== el.contentWindow) return
      const msg = W.readFrameMessage(event.data, { id: frame.id })
      if (!msg) return
      if (msg.kind === 'refused') { frame.state = 'none'; return }
      clearTimeout(answerTimer)
      clearTimeout(loadTimer)
      frame.state = 'ready'
      if (msg.issues.length) issues.splice(0, issues.length, ...msg.issues.slice(0, 20))
      settleAndTell(msg)
      // A save writes the stamp cookie and the record one after the other; a push that
      // lands between the two reads as stale, so ask once more a moment later.
      if (msg.kind === 'changed' && msg.status !== 'shared') { clearTimeout(retry); retry = setTimeout(ask, 400) }
    })
    el.addEventListener('load', () => {
      ask()
      clearTimeout(answerTimer)
      answerTimer = setTimeout(giveUp, W.FRAME_TIMEOUT)
    })
    ;(document.body || document.documentElement).appendChild(el)
  }

  function ask() {
    if (!frame.el || !frame.el.contentWindow) return
    frame.id = requestId()
    try { frame.el.contentWindow.postMessage(W.frameRequest(frame.id, 'get'), origin) } catch { /* the frame went away */ }
  }

  function refresh() {
    notePrefs(false)
    if (frame.state === 'ready') ask()
    else settle(null)
  }

  // ── Round trips ───────────────────────────────────────────
  function rememberTrip(kind) {
    let hash = ''
    try { hash = location.hash } catch { /* none */ }
    session('set', JSON.stringify({ h: hash && hash.length <= HASH_MAX ? hash : '', t: Date.now(), k: kind }))
  }

  /** Sends the visitor to the Workspace page's review. { ok } or { ok: false, reason: 'no-workspace' | 'bad-payload' | 'too-long' }. */
  async function save(payload) {
    if (!origin) return { ok: false, reason: 'no-workspace' }
    if (!W.isMap(payload)) return { ok: false, reason: 'bad-payload' }
    let text
    try { text = await W.encodePayload(payload) } catch { return { ok: false, reason: 'bad-payload' } }
    const link = W.saveLink({ origin, payload: text, tool, returnUrl: location.href })
    if (!link) return { ok: false, reason: W.isPayloadText(text) ? 'too-long' : 'bad-payload' }
    rememberTrip('save')
    navigate(link)
    return { ok: true }
  }

  /** The round trip that brings the team back where the frame cannot. */
  function load() {
    const link = origin ? W.pickLink({ origin, tool, returnUrl: location.href }) : ''
    if (!link) return { ok: false, reason: 'no-workspace' }
    rememberTrip('pick')
    navigate(link)
    return { ok: true }
  }

  /** A save too long for a link, as neorgon-workspace.json for the Workspace page's import. */
  function download(payload) {
    if (!W.isMap(payload)) return false
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'neorgon-workspace.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return true
    } catch { return false }
  }

  // ── Header gear and the , key ─────────────────────────────
  function mountGear({ target = null, keepMobile = false } = {}) {
    const host = target || document.querySelector('.header-actions')
    if (!host) { bindKey(); return null }
    let btn = host.querySelector('.neo-ws-gear')
    if (!btn) {
      btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'neo-ws-gear'
      btn.setAttribute('aria-label', 'Settings')
      btn.setAttribute('aria-haspopup', 'dialog')
      if (keepMobile) btn.setAttribute('data-keep-mobile', '')
      btn.innerHTML = GEAR
      btn.addEventListener('click', () => open({ invoker: btn }))
      host.insertBefore(btn, host.querySelector(':scope > .header-overflow'))
      // The Header Kit built its phone menu before the gear existed: let it fold the gear in
      // too, or at 390 the gear squeezes the menu's toggle under the home link.
      if (!keepMobile) { try { window.NeoHeader && window.NeoHeader.syncOverflow && window.NeoHeader.syncOverflow() } catch { /* no header kit */ } }
    }
    bindKey()
    markGear()
    return btn
  }

  // The gear names the , key only while the key works.
  function markGear() {
    const on = !keyOff()
    for (const btn of document.querySelectorAll('.neo-ws-gear')) {
      if (on) btn.setAttribute('aria-keyshortcuts', ',')
      else btn.removeAttribute('aria-keyshortcuts')
      btn.title = on ? 'Settings (,)' : 'Settings'
    }
  }

  const keyOff = () => safeGet(KEY_OFF, '') === '1'
  // A site's own modal is open (a native dialog, or role=dialog with aria-modal): , stays out of it.
  const modal = (el) => { if (el.localName !== 'dialog') return true; try { return el.matches(':modal') } catch { return true } }
  const otherModal = () => [...document.querySelectorAll('dialog[open]:not(.neo-ws-sheet), [aria-modal="true"]')]
    .some((el) => modal(el) && el.getClientRects().length && !el.closest('[hidden]'))
  const typing = (target) => {
    const keys = window.NeoKeys
    if (keys && typeof keys.isTypingTarget === 'function') { try { return keys.isTypingTarget(target) } catch { /* fall through */ } }
    return !!(target && target.closest && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="searchbox"]'))
  }

  function bindKey() {
    if (keyBound) return
    keyBound = true
    document.addEventListener('keydown', (event) => {
      if (event.key !== ',' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || event.isComposing) return
      if (isSheetOpen() || keyOff() || otherModal() || typing(event.composedPath ? event.composedPath()[0] : event.target)) return
      const keys = window.NeoKeys
      if (keys) {
        try {
          if (keys.isDisabled && keys.isDisabled()) return
          if (keys.list && keys.list().some((e) => (keys.activeKey ? keys.activeKey(e) : e.key) === ',')) return
        } catch { /* a broken registry does not block Settings */ }
      }
      event.preventDefault()
      open({ invoker: document.querySelector('.neo-ws-gear') || document.activeElement })
    })
  }

  // ── The sheet ─────────────────────────────────────────────
  const api = {
    tool, name, origin, actions, section,
    prefs, setPrefs, save, load, download, mountGear,
    team: () => snapshot(),
    open: (o = {}) => open(o),
    on(type, fn) {
      if (!listeners[type] || typeof fn !== 'function') return () => {}
      listeners[type].add(fn)
      return () => listeners[type].delete(fn)
    },
    banner: (target) => renderBanner(api, target),
    workspaceUrl: origin ? origin + W.WORKSPACE_PATH : '',
    keyState: () => ({ neoKeys: !!window.NeoKeys, off: keyOff() }),
    setKeyOff: (off) => { safeSet(KEY_OFF, off ? '1' : ''); markGear() },
  }
  function open({ invoker } = {}) { return openSheet(api, { invoker: invoker || document.activeElement }) }

  // ── Start ─────────────────────────────────────────────────
  takeAnswer()
  const existing = W.readMe(readCookies())
  if (existing) writeCookie(W.meCookie(existing, where()))   // Safari caps a script cookie at about 7 days
  lastPrefs = JSON.stringify(prefs())
  settle(null)
  queueMicrotask(() => { started = true; emit('team', snapshot()); callOnTeam() })
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect, { once: true })
    else connect()
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
    // Safari delivers no storage event to the frame, so coming back to the tab is when it learns of a save.
    window.addEventListener('focus', refresh)
    // Back into this page from the Workspace page abandons any trip it left on.
    window.addEventListener('pageshow', (event) => { if (event.persisted) { session('remove'); refresh() } })
  }
  return api
}
