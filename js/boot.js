// ── The first document and the first card ───────────────────
// Which org opens, strongest first: a #d= link (someone sent it), a ?src= URL
// (a team keeps its org in a repo), what this browser saved, then the example.
// Which card opens: ?at=, then the visitor's own card, then the top.

import { state, ui, loadText, savedDoc, stashCurrent, refreshMe } from './state.js'
import { textFromHash, srcUrl, fetchText } from './docio.js'
import { loadExample, paintRestore } from './actions.js'
import { replaceAt } from './nav.js'
import { showToast } from './utils.js'
import { VIEWS } from './state.js'

const toast = (msg) => showToast(msg, { duration: 4200 })

export async function openFirstDocument() {
  const params = new URLSearchParams(location.search)
  state.param = (params.get('me') || '').slice(0, 254)
  const saved = savedDoc()

  let shared = null
  try { shared = textFromHash() } catch { toast('That link is damaged, so your own org opened instead') }
  if (location.hash) history.replaceState(history.state, '', location.pathname + location.search)
  if (shared != null) {
    if (saved) {
      loadText(saved.text, { source: 'saved', save: false })
      if (saved.text !== shared) stashCurrent('link')
    }
    const read = loadText(shared, { source: 'link' })
    if (read.model) {
      toast(`Opened ${read.model.title} from the link${saved && saved.text !== shared ? '. Your own org is under Org > Restore' : ''}`)
      paintRestore()
      return
    }
    toast(`The link's org could not be read: ${read.issues[0]?.msg || 'unknown error'}`)
  }

  const src = srcUrl()
  if (src) {
    try {
      const read = loadText(await fetchText(src), { source: 'src', name: src.split('/').pop(), save: false })
      if (read.model) return
      toast(`The org at ?src= could not be read: ${read.issues[0]?.msg || 'unknown error'}`)
    } catch (e) {
      toast(`Could not fetch the org at ?src= (${e.message}). The host must allow CORS`)
    }
  }

  if (saved) {
    const read = loadText(saved.text, { source: 'saved', save: false })
    if (read.model) { paintRestore(); return }
  }
  await loadExample({ save: false })
  paintRestore()
}

export function firstFocus() {
  const ix = state.ix
  if (!ix) return
  const params = new URLSearchParams(location.search)
  const view = params.get('view')
  if (VIEWS.includes(view)) ui.view = view
  refreshMe()
  const at = params.get('at')
  ui.focus = at && ix.has(at) ? at : state.me.id || ix.top
  replaceAt(ui.focus)
}
