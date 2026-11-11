// ── The Neorgon Workspace in Rama ────────────────────────────
// Reads the visitor's settings (zone for "ahead of you", working hours and
// days for day parts, time format) and the workspace's me.person (a fourth way
// to find your card); saves a manager's direct team or the whole org through
// the Workspace page's review. The client is the vendored kit
// (js/neorgon-workspace.js); the model mapping is ws-adapter.js.
// startWorkspace() runs before boot.js reads location.hash: a pick's answer is
// taken and stripped there first.

import { NeoWorkspace } from './neorgon-workspace.js'
import { initials } from './neorgon-workspace-core.js'
import { hueOf } from './people.js'
import { state, ui, person, refreshMe } from './state.js'
import { toWorkspace, meFromWorkspace, ramaPrefs, scopeSize, scopePeople, hasTeam, PEOPLE_MAX } from './ws-adapter.js'
import { showToast } from './utils.js'

let ws = null
let redraw = () => {}
let scope = 'team' // 'team' (the lead's direct team) or 'org', chosen in Rama's section of the sheet

/** Whose direct team a save covers: the focus when they manage anyone, else their manager. '' when neither has a team. */
export function teamLead() {
  const ix = state.ix
  if (!ix || !ui.focus) return ''
  if (hasTeam(ix, ui.focus)) return ui.focus
  const up = ix.parentOf(ui.focus)
  return up && hasTeam(ix, up) ? up : ''
}

/** The payload for a scope ('team' or 'org'), or null when there is nobody to save. */
export function payloadFor(which = scope) {
  const ix = state.ix
  if (!ix) return null
  const target = which === 'org' ? 'org' : teamLead()
  if (!target) return null
  const meId = state.me.source && state.me.source !== 'link' ? state.me.id : ''
  const out = toWorkspace(ix, target, { meId })
  return out.people.length ? out : null
}

export async function saveToWorkspace(which) {
  if (!ws) return
  const payload = payloadFor(which)
  if (!payload) return showToast('Nobody to save from this card yet', { duration: 3200 })
  const res = await ws.save(payload)
  if (res.ok) return
  if (res.reason === 'too-long') {
    ws.download(payload)
    showToast('Too many people for a link: saved neorgon-workspace.json. Import it on your workspace page', { duration: 5200 })
  } else showToast('Your workspace is not reachable from here', { duration: 3200 })
}

export const openSettings = (invoker) => ws && ws.open({ invoker })

function applyPrefs() {
  state.prefs = ramaPrefs(ws.prefs())
}

/** Hand the workspace's copy to state.js, whose refreshMe() reads its me.person. True when the card it names changed. */
function applyTeam() {
  const next = ws.team().ws || null
  const before = state.wsTeam && state.ix ? meFromWorkspace(state.wsTeam, state.ix) : ''
  state.wsTeam = next
  return before !== (next && state.ix ? meFromWorkspace(next, state.ix) : '')
}

// ── Rama's own section of the Settings sheet ─────────────────
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') el.textContent = v
    else el.setAttribute(k, v)
  }
  el.append(...kids.flat().filter(Boolean))
  return el
}

/** A person in the preview, drawn as the chart draws them (their division's hue), so one person has one colour on this page. */
function face(id) {
  const p = person(id)
  return p ? h('span', { class: 'ws-face', style: `--hue:${hueOf(id)}`, 'aria-hidden': 'true', text: initials(p.name) }) : null
}

function renderSection(box) {
  const ix = state.ix
  if (!ix) { box.append(h('p', { class: 'ws-note', text: 'Open an org first, then save its people here.' })); return }
  const lead = teamLead()
  if (!lead && scope === 'team') scope = 'org'
  const radios = h('fieldset', { class: 'ws-scope' }, h('legend', { text: 'What "Save to your workspace" sends' }))
  const choice = (value, text, disabled) => {
    const input = h('input', { type: 'radio', name: 'ws-scope', value })
    input.checked = scope === value
    input.disabled = !!disabled
    input.addEventListener('change', () => { if (input.checked) { scope = value; paint() } })
    return h('label', { class: 'ws-radio' }, input, h('span', { text }))
  }
  radios.append(
    choice('team', lead ? `${person(lead).name}'s team: them and their ${ix.kids(lead).length} direct reports` : 'A manager\'s team: stand on a manager\'s card first', !lead),
    choice('org', `The whole org: ${scopeSize(ix, 'org')} people, its teams and reporting lines`),
  )
  const preview = h('div', { class: 'ws-preview', 'aria-live': 'polite' })
  const paint = () => {
    const payload = payloadFor()
    if (!payload) { preview.replaceChildren(h('p', { class: 'ws-note', text: 'Nobody to save from this card.' })); return }
    const n = payload.people.length
    const left = scope === 'org' ? scopeSize(ix, 'org') - n : 0
    preview.replaceChildren(
      h('p', { class: 'ws-faces' }, scopePeople(ix, scope === 'org' ? 'org' : teamLead()).slice(0, 8).map(face)),
      h('p', { class: 'ws-note', text: `${n} ${n === 1 ? 'person' : 'people'} and ${payload.teams.length} ${payload.teams.length === 1 ? 'team' : 'teams'}. Your workspace shows you a review before anything is saved, and saving never deletes anyone.${left > 0 ? ` It keeps ${PEOPLE_MAX} people, so ${left} are left out.` : ''}` }),
    )
  }
  paint()
  const me = person(state.me.id)
  const meLine = h('p', { class: 'ws-note', text: me ? `Your card here: ${me.name}${state.me.source === 'workspace' ? ', found through your workspace' : ''}.` : 'Rama does not know your card in this org yet. Pick it with Me, or set who you are on your workspace page.' })
  box.append(radios, preview, meLine)
}

/**
 * index.html moves a pick's answer (#neo-ws=...) out of the address before the
 * Header Kit's analytics can read it. Put it back for the one synchronous
 * moment the client needs: NeoWorkspace.init reads it, checks it against this
 * tab's pick marker and strips it again before any other script runs. As in
 * Reparto and Floorplan.
 */
function holdBackAnswer() {
  const held = window.__neoWsAnswer
  try { delete window.__neoWsAnswer } catch { window.__neoWsAnswer = undefined }
  if (typeof held !== 'string' || !/^#neo-ws=[^\s]*$/.test(held) || held.length > 410000) return
  try {
    if (location.hash === '' || location.hash === '#') history.replaceState(history.state, '', location.pathname + location.search + held)
  } catch { /* sandboxed: the answer is lost, the team still comes from the frame */ }
}

/**
 * Start the client. onChange(kind) redraws: 'prefs' for new settings, 'me'
 * when the workspace names a different card.
 */
export function startWorkspace(onChange) {
  redraw = typeof onChange === 'function' ? onChange : redraw
  holdBackAnswer()
  try {
    ws = NeoWorkspace.init({
      tool: 'rama',
      name: 'Rama',
      actions: { save: { label: 'Save to your workspace', payload: () => payloadFor() } },
      section: {
        title: 'Rama',
        render: renderSection,
      },
    })
  } catch (err) {
    console.error('[Rama] workspace', err)
    return null
  }
  applyPrefs()
  state.wsTeam = ws.team().ws || null // a cached copy is ready at once; boot's refreshMe reads it
  ws.on('prefs', () => { applyPrefs(); redraw('prefs') })
  ws.on('team', () => {
    if (!applyTeam()) return
    refreshMe()
    redraw('me')
  })
  return ws
}

/**
 * After the first document is open: read the cached team's "me". Rama does not
 * call ws.mountGear(): its Settings button is in the markup (index.html) so the
 * Header Kit can fold it into the phone menu, and , is a Keys kit shortcut
 * (events.js), which the sheet's own key switch defers to.
 */
export function mountWorkspace() {
  if (!ws) return
  if (applyTeam()) refreshMe()
}

/** The , key moved or turned off in the ? sheet: the button says what opens it now. */
export function markSettingsKey(key) {
  const btn = document.getElementById('settingsBtn')
  if (!btn) return
  if (key) btn.setAttribute('aria-keyshortcuts', key)
  else btn.removeAttribute('aria-keyshortcuts')
  btn.title = key ? `Settings (${key})` : 'Settings'
}
