// ── State ────────────────────────────────────────────────────
// One document at a time. The saved form is the document TEXT the visitor
// wrote (comments and all), never the model: readDoc() rebuilds the model on
// every load, so a saved session, a link and a file pass the same gate.
// `ui` fields are view state and are never saved with the document.

import { createStore } from './neorgon-persist.js'
import { readDoc } from './docio.js'
import { indexOrg } from './tree.js'
import { resolveMe } from './me.js'
import { slug } from './core.js'

const docStore = createStore({ key: 'rama-site:doc', version: 1 })
const previousStore = createStore({ key: 'rama-site:previous', version: 1 })
const prefStore = createStore({ key: 'rama-site:preferences', version: 1 })

export const VIEWS = ['chart', 'overview']
export const COLOR_BY = ['branch', 'team', 'track', 'employment', 'country']

export const state = {
  text: '',
  format: 'yaml',
  source: '',          // 'saved' | 'example' | 'link' | 'src' | 'import' | 'editor' | 'blank'
  model: null,
  ix: null,
  issues: [],
  me: { id: null, source: null },
  emails: [],          // the signed-in account's addresses
  param: '',           // ?me= from the link
}

export const ui = {
  focus: null,
  view: 'chart',
  panel: true,         // the visitor's choice; the panel also needs a focus to show
  colorBy: 'branch',
  expanded: new Set(), // "<manager id>:<bucket>" for opened contractor, open-role and overflow buckets
  moved: false,        // the visitor navigated, so a late sign-in must not yank the view
}

// ── Preferences: per viewer, never part of a document ────────
let prefs = { picked: {}, view: 'chart', panel: true, colorBy: 'branch' }

/** Returns true when this browser had no preferences saved yet. */
export function loadPrefs() {
  const saved = prefStore.load(null)
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    const picked = saved.picked && typeof saved.picked === 'object' && !Array.isArray(saved.picked) ? saved.picked : {}
    prefs = {
      picked: Object.fromEntries(Object.entries(picked).filter(([k, v]) => typeof k === 'string' && typeof v === 'string').slice(0, 50)),
      view: VIEWS.includes(saved.view) ? saved.view : 'chart',
      panel: saved.panel !== false,
      colorBy: COLOR_BY.includes(saved.colorBy) ? saved.colorBy : 'branch',
    }
  }
  ui.view = prefs.view
  ui.panel = prefs.panel
  ui.colorBy = prefs.colorBy
  return !saved
}

export function savePrefs() {
  prefs.view = ui.view
  prefs.panel = ui.panel
  prefs.colorBy = ui.colorBy
  return prefStore.save(prefs)
}

/** The picked card is remembered per org, by the org's title. */
const orgKey = () => slug(state.model?.title || '') || 'org'
export const pickedFor = () => prefs.picked[orgKey()] || ''
export function setPicked(id) {
  if (id) prefs.picked[orgKey()] = id
  else delete prefs.picked[orgKey()]
  savePrefs()
  refreshMe()
}

// ── The document ─────────────────────────────────────────────

/**
 * Read text into the state. Returns readDoc's result; on an unreadable
 * document nothing changes and the caller shows the issues.
 */
export function loadText(text, { source = 'editor', name = '', save = true } = {}) {
  const read = readDoc(text, { name })
  if (!read.model) return read
  state.text = read.format === 'csv' ? '' : String(text)
  state.format = read.format === 'json' ? 'json' : 'yaml'
  state.source = source
  state.model = read.model
  state.ix = indexOrg(read.model)
  state.issues = read.issues
  ui.expanded.clear()
  refreshMe()
  if (ui.focus && !state.ix.has(ui.focus)) ui.focus = null
  if (save && state.text) saveDoc()
  return read
}

export function saveDoc() {
  return docStore.save({ text: state.text, format: state.format, savedAt: new Date().toISOString() })
}

export function savedDoc() {
  const d = docStore.load(null)
  return d && typeof d.text === 'string' && d.text.trim() ? d : null
}

/** Keep the visitor's own org aside before a link or an example replaces it. */
export function stashCurrent(reason) {
  if (!state.text || state.source === 'example') return false
  return previousStore.save({ text: state.text, title: state.model?.title || '', reason, savedAt: new Date().toISOString() })
}

export function previousDoc() {
  const d = previousStore.load(null)
  return d && typeof d.text === 'string' && d.text.trim() ? d : null
}

export const clearPrevious = () => previousStore.clear()

export function refreshMe() {
  if (!state.ix) return
  state.me = resolveMe(state.ix, { param: state.param, picked: pickedFor(), emails: state.emails })
}

export const person = (id) => state.ix?.byId.get(id) || null
