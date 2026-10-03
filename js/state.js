// ── State ────────────────────────────────────────────────────
// One document at a time. The saved form is the document TEXT the visitor
// wrote (comments and all), never the model: readDoc() rebuilds the model on
// every load, so a saved session, a link and a file pass the same gate.
// `ui` fields are view state and are never saved with the document.

import { createStore } from './neorgon-persist.js'
import { readDoc, modelToText } from './docio.js'
import { indexOrg } from './tree.js'
import { resolveMe } from './me.js'
import { slug, hash } from './core.js'

const docStore = createStore({ key: 'rama-site:doc', version: 1 })
// Version 2 is a list; version 1 held one org, which becomes the first entry.
const previousStore = createStore({
  key: 'rama-site:previous',
  version: 2,
  migrate: (data) => (data && typeof data.text === 'string' ? [data] : null),
})
const KEEP_PREVIOUS = 8
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
      // The 50 most recent picks: setPicked moves a pick to the end, so the oldest fall off.
      picked: Object.fromEntries(Object.entries(picked).filter(([k, v]) => typeof k === 'string' && typeof v === 'string').slice(-50)),
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
const orgKey = () => {
  const title = state.model?.title || ''
  return slug(title) || `org-${hash(title).toString(36)}`
}
export const pickedFor = () => prefs.picked[orgKey()] || ''
export function setPicked(id) {
  const key = orgKey()
  delete prefs.picked[key]
  if (id) prefs.picked[key] = id
  savePrefs()
  refreshMe()
}

// ── The document ─────────────────────────────────────────────
// Every org that arrives (a link, an import, the example, a blank org, a
// ?src= file, a restore) first puts the visitor's saved org on the Restore
// list, so nothing they wrote is ever lost to the next thing they open.
// Links, imports, blank orgs and restores are kept at once; the example and a
// ?src= file are kept only when the visitor edits them.

const KEPT_AT_ONCE = new Set(['link', 'import', 'blank', 'restore'])
let lineageSaved = false // rama-site:doc holds the org on screen
state.storageOk = true
state.foreign = false

/**
 * Read text into the state. Returns readDoc's result; on an unreadable
 * document nothing changes (nothing is stashed either) and the caller shows the issues.
 * source: 'saved' | 'link' | 'import' | 'blank' | 'restore' | 'example' | 'src' | 'editor'
 */
export function openDoc(text, { source = 'editor', name = '', foreign = false } = {}) {
  const read = readDoc(text, { name })
  if (!read.model) return read
  const before = orgKey()
  // A CSV becomes YAML once read, so it can be saved, stashed and edited like any other org.
  state.text = read.format === 'csv' ? modelToText(read.model, 'yaml') : String(text)
  state.format = read.format === 'json' ? 'json' : 'yaml'
  state.model = read.model
  state.ix = indexOrg(read.model)
  state.issues = read.issues
  ui.expanded.clear()
  if (source === 'editor') {
    // Renaming the org in the editor keeps the card this browser picked in it.
    const after = orgKey()
    if (after !== before && prefs.picked[before] && !prefs.picked[after]) {
      prefs.picked[after] = prefs.picked[before]
      delete prefs.picked[before]
      savePrefs()
    }
  } else {
    state.source = source
    // Someone else's document (a link, a ?src= file) stays foreign until the visitor says otherwise:
    // its photo URLs are not fetched, because which ones load would tell their host whose card this is.
    state.foreign = source === 'link' || source === 'src' || ((source === 'saved' || source === 'restore') && !!foreign)
    if (source === 'saved') lineageSaved = true
    else {
      lineageSaved = false
      stashSaved(state.text)
    }
  }
  refreshMe()
  if (ui.focus && !state.ix.has(ui.focus)) ui.focus = null
  if (source === 'editor' || KEPT_AT_ONCE.has(source)) commit()
  return read
}

/** Put the saved org on the Restore list, unless it is the org arriving. */
function stashSaved(incoming) {
  const saved = savedDoc()
  if (!saved || saved.text === incoming) return
  pushPrevious({ text: saved.text, title: saved.title || '', savedAt: saved.savedAt || '', foreign: !!saved.foreign })
}

function commit() {
  if (!lineageSaved) stashSaved(state.text)
  const ok = docStore.save({ text: state.text, format: state.format, title: state.model?.title || '', foreign: !!state.foreign, savedAt: new Date().toISOString() })
  lineageSaved = ok
  state.storageOk = ok
  if (ok && state.source !== 'saved') state.source = 'saved'
  return ok
}

/** The visitor chose to show this document's photos: it is theirs to view now, and stays so when saved. */
export function trustDoc() {
  state.foreign = false
  if (lineageSaved) commit()
}

export function savedDoc() {
  const d = docStore.load(null)
  return d && typeof d.text === 'string' && d.text.trim() ? d : null
}

export function previousDocs() {
  const list = previousStore.load([])
  return Array.isArray(list) ? list.filter((d) => d && typeof d.text === 'string' && d.text.trim()).slice(0, KEEP_PREVIOUS) : []
}

/**
 * Put an org on the Restore list. When storage is full, the oldest entries go
 * first, one at a time, until the list fits; if even the new entry alone does
 * not fit, restoreFull is set so the visitor is told once (warnIfUnsaved).
 */
function pushPrevious(entry) {
  const list = [entry, ...previousDocs().filter((d) => d.text !== entry.text)].slice(0, KEEP_PREVIOUS)
  while (list.length) {
    if (previousStore.save(list)) return true
    list.pop()
  }
  state.restoreFull = true
  return false
}

/** Take one org off the Restore list (it is about to be opened). */
export function takePrevious(i) {
  const list = previousDocs()
  const [entry] = list.splice(i, 1)
  previousStore.save(list)
  return entry || null
}

export function refreshMe() {
  if (!state.ix) return
  state.me = resolveMe(state.ix, { param: state.param, picked: pickedFor(), emails: state.emails })
}

export const person = (id) => state.ix?.byId.get(id) || null
