/**
 * Neorgon Workspace Kit: the Settings sheet and the team banner
 * Canonical source: packages/neorgon-ui/workspace/workspace-sheet.js
 * Vendored as js/neorgon-workspace-sheet.js by packages/neorgon-ui/sync-workspace.sh
 *
 * Imported by workspace.js; a tool never imports this file itself. Every text
 * node is set with textContent and every colour passes colorFor() or inkOn(),
 * so nothing from a workspace, a cookie or the tool reaches HTML as markup.
 * The only innerHTML is the kit's own icon constants.
 *
 * Do not edit a vendored copy. Edit here and run sync-workspace.sh.
 */
import * as W from './neorgon-workspace-core.js'

const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>'
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WEEK_STARTS = [[1, 'Monday'], [6, 'Saturday'], [7, 'Sunday']]
const CLOCKS = [['', 'This device\'s'], ['h23', '24-hour (17:30)'], ['h12', '12-hour (5:30 pm)']]
const STATUS = {
  shared: 'Your team from neorgon.com, up to date.',
  cached: 'Your team, as this tool last loaded it.',
  stale: 'Your workspace changed since this copy. Load your team to bring it up to date.',
  none: 'No team here yet. Load it from your workspace, or create one there.',
  pending: 'Looking for your workspace...',
  away: 'Your team lives on neorgon.com, so it is only available on Neorgon sites.',
}

let dialog = null
let current = null       // { api, invoker, off: [unsubscribe] }

/** Builds an element: props set as attributes (text via `text`), children appended. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'text') el.textContent = String(v)
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn)
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
  return el
}
let uidN = 0
const uid = (p) => `neo-ws-${p}-${++uidN}`
const label = (v, fallback) => W.str(v, 80) || fallback
const pad = (n) => String(n).padStart(2, '0')
const toTime = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`
const fromTime = (s) => { const m = /^(\d{2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN }

export const isSheetOpen = () => !!(dialog && dialog.open)

// ── Shell ───────────────────────────────────────────────────
function shell() {
  if (dialog && dialog.isConnected) return dialog
  const title = h('h2', { class: 'neo-ws-title', id: uid('title'), text: 'Settings' })
  const lede = h('p', { class: 'neo-ws-lede', id: uid('lede') })
  const close = h('button', { type: 'button', class: 'neo-ws-close', 'aria-label': 'Close settings' })
  close.innerHTML = CLOSE
  const body = h('div', { class: 'neo-ws-body' })
  const foot = h('footer', { class: 'neo-ws-foot' }, h('p', { text: 'Kept in this browser. Nothing is sent anywhere.' }))
  dialog = h('dialog', { class: 'neo-ws-sheet', 'aria-labelledby': title.id, 'aria-describedby': lede.id },
    h('header', { class: 'neo-ws-head' }, h('div', {}, title, lede), close), body, foot)
  dialog.neoParts = { lede, body }
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') event.stopPropagation() })
  let downOutside = false
  const outside = (e) => { const b = dialog.getBoundingClientRect(); return e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom }
  dialog.addEventListener('pointerdown', (e) => { downOutside = e.target === dialog && outside(e) })
  dialog.addEventListener('click', (e) => { if (downOutside && e.target === dialog && outside(e)) dialog.close(); downOutside = false })
  dialog.addEventListener('close', () => {
    const was = current
    current = null
    if (was) for (const off of was.off) off()
    // The close event is queued: focus the visitor (or a script) already moved elsewhere stays there.
    const active = document.activeElement
    if (active && active !== document.body && active !== document.documentElement && !dialog.contains(active)) return
    const target = returnTarget(was && was.invoker)
    if (target) target.focus({ preventScroll: true })
  })
  document.body.append(dialog)
  return dialog
}

// Focus goes back to the opener while it can take it. An opener inside the
// Header Kit's phone menu, or a dialog, is hidden by now (the menu closed when
// it was pressed), so focus would land on <body>: then the menu's toggle, the
// gear or the site's own Settings button, whichever is on screen, takes it.
const shown = (el) => !!(el && el.isConnected && typeof el.focus === 'function' && el.getClientRects().length && !el.closest('dialog:not([open]), [hidden], [inert]'))
function returnTarget(invoker) {
  if (shown(invoker)) return invoker
  const near = invoker && invoker.isConnected && invoker.closest ? invoker.closest('.header-overflow') : null
  const picks = [near && near.querySelector('.header-overflow-toggle'), ...document.querySelectorAll('.neo-ws-gear, .header-actions [aria-keyshortcuts=","], .header-overflow-toggle')]
  return picks.find(shown) || null
}

function paintScheme(el) {
  let rgb = [11, 13, 20]
  for (const node of [document.body, document.documentElement]) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(node).backgroundColor || '')
    if (m && (m[4] === undefined || Number(m[4]) > 0.5)) { rgb = [m[1], m[2], m[3]].map(Number); break }
  }
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
  el.dataset.scheme = lum < 0.4 ? 'dark' : 'light'
  const bar = document.querySelector('.header-bar')
  const r = bar ? bar.getBoundingClientRect() : null
  el.style.setProperty('--ws-top', `${r && r.top <= 1 && r.bottom > 0 ? Math.round(r.bottom) : 0}px`)
}

/** Opens the sheet for a NeoWorkspace instance. Returns the dialog. */
export function openSheet(api, { invoker } = {}) {
  const el = shell()
  if (current) for (const off of current.off) off()
  current = { api, invoker, off: [] }
  el.neoParts.lede.textContent = `${api.name} and every Neorgon planning tool`
  const body = el.neoParts.body
  body.replaceChildren(youSection(api), teamSection(api), toolSection(api), keySection(api))
  paintScheme(el)
  if (!el.open) el.showModal()
  return el
}

// ── You ─────────────────────────────────────────────────────
function field(text, control, hint) {
  const id = control.id || (control.id = uid('f'))
  return h('div', { class: 'neo-ws-field' }, h('label', { for: id, text }), control, hint || null)
}

function zoneList() {
  let list = []
  try { list = Intl.supportedValuesOf('timeZone') } catch { list = [] }
  return list.map((z) => W.zone(z)).filter((z, i, all) => z && all.indexOf(z) === i)
}

function countryOptions(selected) {
  let names = null
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }) } catch { names = null }
  const out = []
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = W.country(String.fromCharCode(a, b))
    if (code !== String.fromCharCode(a, b)) continue
    let name = code
    try { name = (names && names.of(code)) || code } catch { name = code }
    out.push([code, name])
  }
  out.sort((x, y) => x[1].localeCompare(y[1]))
  return [h('option', { value: '', text: 'Not set' }), ...out.map(([c, n]) => h('option', { value: c, selected: c === selected, text: `${n} (${c})` }))]
}

function youSection(api) {
  const p = api.prefs()
  const set = (patch) => api.setPrefs(patch)
  const listId = uid('zones')
  const zoneMsg = h('p', { class: 'neo-ws-hint', id: uid('zmsg'), 'aria-live': 'polite' })
  const zoneIn = h('input', { type: 'text', class: 'neo-ws-input', list: listId, value: p.tz, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': zoneMsg.id })
  const commitZone = () => {
    const z = W.zone(zoneIn.value)
    zoneIn.toggleAttribute('aria-invalid', !z)
    zoneMsg.textContent = z ? '' : 'Not a time zone. Try a city, like America/Santiago, or an offset, like +2.'
    if (z) { zoneIn.value = z; set({ tz: z }) }
  }
  zoneIn.addEventListener('change', commitZone)
  const device = h('button', { type: 'button', class: 'neo-ws-btn', text: 'Use this device\'s' })
  device.addEventListener('click', () => { zoneIn.value = W.deviceDefaults().tz; commitZone() })

  const start = h('input', { type: 'time', class: 'neo-ws-input', value: toTime(p.h[0]), step: 900, 'aria-label': 'Start of the working day' })
  const end = h('input', { type: 'time', class: 'neo-ws-input', value: toTime(p.h[1]), step: 900, 'aria-label': 'End of the working day' })
  const hoursMsg = h('p', { class: 'neo-ws-hint', 'aria-live': 'polite' })
  const commitHours = () => {
    const a = fromTime(start.value), b = fromTime(end.value) || (end.value === '00:00' ? 1440 : NaN)
    const ok = W.hours([a, b])
    hoursMsg.textContent = ok ? '' : 'The day must end after it starts.'
    if (ok) set({ h: ok })
  }
  start.addEventListener('change', commitHours)
  end.addEventListener('change', commitHours)

  const order = [0, 1, 2, 3, 4, 5, 6].map((i) => ((p.w - 1 + i) % 7) + 1)   // from the week start
  const daysMsg = h('p', { class: 'neo-ws-hint', 'aria-live': 'polite' })
  const days = h('div', { class: 'neo-ws-days' }, order.map((d) => {
    const box = h('input', { type: 'checkbox', value: d, checked: p.d.includes(String(d)) })
    box.addEventListener('change', () => {
      const picked = [...days.querySelectorAll('input:checked')].map((x) => x.value).sort().join('')
      daysMsg.textContent = W.days(picked) ? '' : 'Keep at least one work day.'
      if (W.days(picked)) set({ d: picked })
      else box.checked = true
    })
    return h('label', { class: 'neo-ws-day', title: DAY_NAMES[d - 1] }, box, h('span', { 'aria-hidden': 'true', text: DAY_NAMES[d - 1].slice(0, 2) }), h('span', { class: 'neo-ws-sr', text: DAY_NAMES[d - 1] }))
  }))

  const week = h('select', { class: 'neo-ws-input' }, WEEK_STARTS.map(([v, t]) => h('option', { value: v, selected: v === p.w, text: t })))
  week.addEventListener('change', () => set({ w: Number(week.value) }))
  const clock = h('select', { class: 'neo-ws-input' }, CLOCKS.map(([v, t]) => h('option', { value: v, selected: v === p.c, text: t })))
  clock.addEventListener('change', () => set({ c: clock.value }))
  const cc = h('select', { class: 'neo-ws-input' }, countryOptions(p.cc))
  cc.addEventListener('change', () => set({ cc: cc.value || null }))

  const youId = uid('you')
  return h('section', { class: 'neo-ws-section', 'aria-labelledby': youId },
    h('h3', { class: 'neo-ws-section-title', id: youId, text: 'You' }),
    h('p', { class: 'neo-ws-note', text: 'Every Neorgon planning tool reads these. Never a name or an email.' }),
    field('Time zone', zoneIn, h('div', {}, zoneMsg, h('datalist', { id: listId }, zoneList().map((z) => h('option', { value: z }))))),
    h('div', { class: 'neo-ws-row' }, device),
    h('fieldset', { class: 'neo-ws-field neo-ws-fieldset' }, h('legend', { text: 'Working hours' }),
      h('div', { class: 'neo-ws-row' }, start, h('span', { class: 'neo-ws-to', text: 'to' }), end), hoursMsg),
    h('fieldset', { class: 'neo-ws-field neo-ws-fieldset' }, h('legend', { text: 'Work days' }), days, daysMsg),
    h('div', { class: 'neo-ws-grid' }, field('Week starts on', week), field('Time format', clock)),
    field('Country', cc, h('p', { class: 'neo-ws-hint', text: 'For public holidays.' })))
}

// ── Your team ───────────────────────────────────────────────
// 30px: the smallest disc whose initials (.4 of it) clear the 12px type floor.
const FACE_PX = 30
function face(person, px = FACE_PX) {
  const bg = W.colorFor(person)
  return h('span', { class: 'neo-ws-face', title: W.str(person.name, 120), style: { '--face': bg, '--face-ink': W.inkOn(bg), '--face-size': `${px}px` }, 'aria-hidden': 'true', text: W.initials(person.name) })
}

function teamCard(team, byId) {
  const members = team.members.map((m) => byId.get(m.person)).filter(Boolean)
  const lead = team.lead ? byId.get(team.lead) : null
  const shown = members.slice(0, 6)
  // The faces are drawings; a screen reader gets the names here.
  const names = members.slice(0, 12).map((p) => W.str(p.name, 120)).join(', ') + (members.length > 12 ? `, and ${members.length - 12} more` : '')
  return h('li', { class: 'neo-ws-team', style: { '--team': W.colorFor(team) } },
    h('div', { class: 'neo-ws-team-head' },
      h('span', { class: 'neo-ws-team-name', text: W.str(team.name, 120) }),
      h('span', { class: 'neo-ws-team-meta', text: `${members.length} ${members.length === 1 ? 'person' : 'people'}${lead ? `, led by ${W.str(lead.name, 120)}` : ''}` })),
    h('div', { class: 'neo-ws-faces' }, shown.map((p) => face(p)), members.length > shown.length ? h('span', { class: 'neo-ws-more', 'aria-hidden': 'true', text: `+${members.length - shown.length}` }) : null,
      members.length ? h('span', { class: 'neo-ws-sr', text: names }) : null))
}

/**
 * The team part of the sheet. The buttons are built once and only shown, hidden or
 * disabled afterwards: a frame answer that lands mid-click must not swap the button
 * under the pointer. The cards are rebuilt only when the copy itself changes.
 */
function teamSection(api) {
  const statusEl = h('p', { class: 'neo-ws-status', role: 'status' })
  const cards = h('div', { class: 'neo-ws-team-body' })
  const notice = h('div', { class: 'neo-ws-notice', 'aria-live': 'polite' })
  const row = h('div', { class: 'neo-ws-actions' })
  const use = api.actions.use && typeof api.actions.use.run === 'function' ? api.actions.use : null
  const sv = api.actions.save && typeof api.actions.save.payload === 'function' && api.origin ? api.actions.save : null
  let useBtn = null, loadBtn = null, shownWs = undefined
  if (use) {
    useBtn = h('button', { type: 'button', class: 'neo-ws-btn neo-ws-primary', text: label(use.label, `Use my team in ${api.name}`) })
    useBtn.addEventListener('click', () => {
      const cur = api.team().ws
      if (!cur) return
      try { use.run(cur) } catch (err) { console.error('[NeoWorkspace] use', err) }
      if (dialog) dialog.close()
    })
    row.append(useBtn)
  }
  if (sv) {
    const b = h('button', { type: 'button', class: 'neo-ws-btn', text: label(sv.label, 'Save to your workspace') })
    b.addEventListener('click', async () => {
      let payload = null
      try { payload = sv.payload() } catch (err) { console.error('[NeoWorkspace] save payload', err) }
      b.disabled = true
      const res = await api.save(payload)
      b.disabled = false
      if (res.ok) return
      notice.replaceChildren(h('p', { text: res.reason === 'too-long' ? 'Too many people for a link. Download them as a file, then import it on your workspace page.' : 'Nothing to save from here yet.' }))
      if (res.reason === 'too-long') {
        const dl = h('button', { type: 'button', class: 'neo-ws-btn', text: 'Download neorgon-workspace.json' })
        dl.addEventListener('click', () => api.download(payload))
        notice.append(dl)
      }
    })
    row.append(b)
  }
  if (api.origin) {
    loadBtn = h('button', { type: 'button', class: 'neo-ws-btn', text: 'Load your team' })
    loadBtn.addEventListener('click', () => api.load())
    row.append(loadBtn)
  }
  if (api.workspaceUrl) row.append(h('a', { class: 'neo-ws-btn neo-ws-link', href: api.workspaceUrl, target: '_blank', rel: 'noopener', text: 'Open your workspace' }))

  const update = () => {
    const t = api.team()
    const status = !api.origin ? 'away' : t.status === 'none' && t.frame === 'pending' ? 'pending' : t.status
    if (statusEl.dataset.status !== status) { statusEl.dataset.status = status; statusEl.textContent = STATUS[status] }
    if (useBtn) useBtn.disabled = !t.ws
    if (loadBtn) loadBtn.hidden = t.status === 'shared'
    if (t.ws === shownWs) return
    shownWs = t.ws
    cards.replaceChildren(...teamCards(t.ws))
  }
  update()
  if (current) current.off.push(api.on('team', update))
  // The actions come before the cards, so twelve teams never push them out of reach.
  return h('section', { class: 'neo-ws-section' }, h('h3', { class: 'neo-ws-section-title', text: 'Your team' }), statusEl, row, notice, cards)
}

function teamCards(ws) {
  if (!ws) return []
  const out = []
  const byId = new Map(ws.people.map((p) => [p.id, p]))
  const me = ws.me && ws.me.person ? byId.get(ws.me.person) : null
  if (me) out.push(h('p', { class: 'neo-ws-me' }, face(me), h('span', { text: `You are ${W.str(me.name, 120)}` })))
  if (ws.teams.length) out.push(h('ul', { class: 'neo-ws-teams' }, ws.teams.slice(0, 12).map((team) => teamCard(team, byId))))
  else out.push(h('p', { class: 'neo-ws-note', text: `${ws.people.length} ${ws.people.length === 1 ? 'person' : 'people'}, no teams yet.` }))
  if (ws.teams.length > 12) out.push(h('p', { class: 'neo-ws-note', text: `and ${ws.teams.length - 12} more teams in your workspace.` }))
  return out
}

// ── The tool's own section, and the , key ───────────────────
function toolSection(api) {
  if (!api.section) return ''
  const box = h('div', { class: 'neo-ws-tool' })
  try { api.section.render(box) } catch (err) { console.error('[NeoWorkspace] section', err) }
  return h('section', { class: 'neo-ws-section' }, h('h3', { class: 'neo-ws-section-title', text: label(api.section.title, api.name) }), box)
}

function keySection(api) {
  const k = api.keyState()
  if (k.neoKeys) return ''   // NeoKeys' own switch in the ? sheet turns every single key off
  const box = h('input', { type: 'checkbox', checked: !k.off })
  box.addEventListener('change', () => api.setKeyOff(!box.checked))
  return h('section', { class: 'neo-ws-section neo-ws-keys' },
    h('label', { class: 'neo-ws-check' }, box, h('span', { text: 'Open Settings with the , key' })))
}

// ── The team banner ─────────────────────────────────────────
/** Focus that was inside a banner about to disappear goes to the gear, or to the page's heading. */
function rehome(target) {
  if (!target.contains(document.activeElement)) return
  const next = document.querySelector('.neo-ws-gear') || document.querySelector('main h1, h1, main')
  if (!next) return
  if (!next.matches('button, a[href], input, select, textarea, [tabindex]')) next.setAttribute('tabindex', '-1')
  next.focus({ preventScroll: true })
}

/** A one-line banner in `target` offering the team; hidden when there is nothing to offer. Returns an unsubscribe. */
export function renderBanner(api, target) {
  if (!target || !target.replaceChildren) return () => {}
  let dismissed = false, drawn = ''
  const draw = () => {
    const t = api.team()
    const use = api.actions.use
    const key = `${dismissed}|${t.status}|${t.stamp}|${!!t.ws}`
    if (key === drawn) return   // the same offer: keep the buttons under the pointer
    drawn = key
    target.classList.add('neo-ws-banner')
    if (dismissed || !api.origin || (t.status !== 'stale' && !(t.ws && use && typeof use.run === 'function'))) { target.hidden = true; target.replaceChildren(); return }
    target.hidden = false
    const close = h('button', { type: 'button', class: 'neo-ws-close', 'aria-label': 'Dismiss' })
    close.innerHTML = CLOSE
    close.addEventListener('click', () => { dismissed = true; rehome(target); draw() })
    let text, act
    if (t.status === 'stale') {
      text = 'Your workspace changed since this tool last loaded it.'
      act = h('button', { type: 'button', class: 'neo-ws-btn', text: 'Load your team' })
      act.addEventListener('click', () => api.load())
    } else {
      const n = t.ws.people.length
      text = `Your workspace has ${n} ${n === 1 ? 'person' : 'people'}${t.ws.teams.length ? ` in ${t.ws.teams.length} ${t.ws.teams.length === 1 ? 'team' : 'teams'}` : ''}.`
      act = h('button', { type: 'button', class: 'neo-ws-btn neo-ws-primary', text: label(use.label, `Use my team in ${api.name}`) })
      act.addEventListener('click', () => { try { use.run(api.team().ws) } catch (err) { console.error('[NeoWorkspace] use', err) } dismissed = true; rehome(target); draw() })
    }
    target.replaceChildren(h('p', { class: 'neo-ws-banner-text', text }), act, close)
  }
  draw()
  return api.on('team', draw)
}
