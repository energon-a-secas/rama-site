// ── The first document and the first card ───────────────────
// Which org opens, strongest first: a #d= link (someone sent it), a ?src= URL
// (a team keeps its org in a repo), what this browser saved, then the example.
// Which card opens: ?at=, then the visitor's own card, then the top.

import { state, ui, openDoc, savedDoc, refreshMe } from './state.js'
import { textFromHash, srcUrl, fetchText } from './docio.js'
import { loadExample, paintRestore } from './actions.js'
import { replaceAt } from './nav.js'
import { showToast } from './utils.js'
import { VIEWS } from './state.js'

const toast = (msg) => showToast(msg, { duration: 4200 })

export async function openFirstDocument() {
  const params = new URLSearchParams(location.search)
  state.param = (params.get('me') || '').slice(0, 254)

  let shared = null
  try { shared = textFromHash() } catch { toast('That link is damaged, so your own org opened instead') }
  if (location.hash) history.replaceState(history.state, '', location.pathname + location.search)
  if (shared != null) {
    // openDoc stashes the visitor's org only once the link has been read: a broken link changes nothing.
    const before = savedDoc()
    const read = openDoc(shared, { source: 'link' })
    if (read.model) {
      toast(`Opened ${read.model.title} from the link${before && before.text !== shared ? '. Your own org is under Org > Restore' : ''}`)
      paintRestore()
      return
    }
    toast(`The link's org could not be read: ${read.issues[0]?.msg || 'unknown error'}`)
  }

  const src = srcUrl()
  if (src) {
    try {
      // A ?src= org is shown, not kept: it is saved only once edited, and the visitor's own org stays saved and on the Restore list.
      const read = openDoc(await fetchText(src), { source: 'src', name: src.split('/').pop() })
      if (read.model) { paintRestore(); return }
      toast(`The org at ?src= could not be read: ${read.issues[0]?.msg || 'unknown error'}`)
    } catch (e) {
      toast(`Could not fetch the org at ?src= (${e.message}). The host must allow CORS`)
    }
  }

  const saved = savedDoc()
  if (saved) {
    const read = openDoc(saved.text, { source: 'saved', foreign: saved.foreign })
    if (read.model) { paintRestore(); return }
  }
  await loadExample({ first: true })
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
  // A link that names a card keeps it: a sign-in that settles later must not move the visitor off it.
  ui.atLink = !!(at && ix.has(at))
  ui.focus = ui.atLink ? at : state.me.id || ix.top
  replaceAt(ui.focus)
}
