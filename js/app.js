// ── Entry point ──────────────────────────────────────────────
// Preferences, the first document, the first card, one paint, then wiring.
// Kept under 50 lines: everything else lives in its own module.

import { ui, loadPrefs } from './state.js'
import { openFirstDocument, firstFocus } from './boot.js'
import { drawAll } from './render.js'
import { center } from './nav.js'
import { bindEvents } from './events.js'

async function init() {
  const fresh = loadPrefs()
  // A phone opens on the chart; the profile is one tap on the focused card away.
  if (fresh && matchMedia('(max-width: 700px)').matches) ui.panel = false
  await openFirstDocument()
  firstFocus()
  drawAll()
  center('instant')
  bindEvents()
  document.body.classList.add('is-ready')
}

init()
