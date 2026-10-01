// ── The document editor ──────────────────────────────────────
// A dialog over the document text. It validates as you type (the same
// readDoc() every other entry point uses) and changes nothing until Apply.
// YAML comments survive an Apply; switching to JSON rewrites the text.

import { state, ui, loadText, person } from './state.js'
import { readDoc, convertText, modelToText } from './docio.js'
import { escHtml, debounce, showToast, $ } from './utils.js'
import { openDialog } from './dialogs.js'
import { drawAll } from './render.js'
import { replaceAt } from './nav.js'
import { plural } from './core.js'
import { icon } from './icons.js'

let format = 'yaml'

export function openEditor({ opener, personId = null, text = null } = {}) {
  const area = $('editorText')
  format = state.format
  area.value = text ?? (state.text || (state.model ? modelToText(state.model, format) : ''))
  if (text != null) format = readDoc(text).format === 'json' ? 'json' : 'yaml'
  paintFormat()
  validate()
  openDialog($('editorDialog'), opener)
  if (personId) selectPerson(personId)
  else {
    // Open at the top: setting the value leaves the caret, and the scroll, at the end.
    area.setSelectionRange(0, 0)
    area.scrollTop = 0
    area.focus({ preventScroll: true })
  }
}

function paintFormat() {
  for (const b of document.querySelectorAll('[data-format]')) b.setAttribute('aria-pressed', String(b.dataset.format === format))
}

/** Put the caret on the person's line and scroll it into view. */
function selectPerson(id) {
  const area = $('editorText')
  const p = person(id)
  const lines = area.value.split('\n')
  const names = [p.name, p.id].map((s) => s.toLowerCase())
  let at = lines.findIndex((l) => /(^|\s|")(name|id)"?\s*:/.test(l) && names.some((n) => l.toLowerCase().includes(n)))
  if (at < 0) at = 0
  const start = lines.slice(0, at).join('\n').length + (at ? 1 : 0)
  area.focus()
  area.setSelectionRange(start, start + lines[at].length)
  const lh = parseFloat(getComputedStyle(area).lineHeight) || 20
  area.scrollTop = Math.max(0, at * lh - area.clientHeight / 3)
}

const validate = debounce(() => {
  const { model, issues } = readDoc($('editorText').value)
  const box = $('editorIssues')
  if (!model) {
    box.innerHTML = `<p class="issue issue--error">${icon('alert', { size: 14 })}${escHtml(issues[0]?.msg || 'Could not read the document')}</p>`
    return
  }
  const open = model.people.filter((p) => p.status === 'open').length
  const counts = [plural(model.people.length - open, 'person', 'people'), open && plural(open, 'open role'), model.teams.length && plural(model.teams.length, 'team')].filter(Boolean).join(', ')
  const head = `<p class="issue issue--ok">${icon('check', { size: 14 })}${escHtml(counts)}${issues.length ? `, ${escHtml(plural(issues.length, 'thing'))} to look at` : ', nothing to fix'}</p>`
  box.innerHTML = head + issues.slice(0, 40).map((i) => `<p class="issue issue--${i.level}">${icon('alert', { size: 14 })}${escHtml(i.msg)}</p>`).join('') +
    (issues.length > 40 ? `<p class="issue">${issues.length - 40} more</p>` : '')
}, 250)

export function applyEditor() {
  const text = $('editorText').value
  const read = loadText(text, { source: 'editor' })
  if (!read.model) {
    validate()
    showToast('Nothing changed: the document could not be read', { duration: 3000 })
    return
  }
  $('editorDialog').close()
  if (!state.ix.has(ui.focus)) { ui.focus = state.me.id || state.ix.top; replaceAt(ui.focus) }
  drawAll()
  showToast(`Applied: ${plural(read.model.people.length, 'person', 'people')}${read.issues.length ? `, ${plural(read.issues.length, 'warning')}` : ''}`, { duration: 2600 })
}

export function switchFormat(to) {
  if (to === format) return
  const area = $('editorText')
  const { text, issues } = convertText(area.value, to)
  if (text == null) {
    showToast(`Fix the document first: ${issues[0]?.msg || 'it could not be read'}`, { duration: 3200 })
    return
  }
  const hadComments = format === 'yaml' && /^\s*#/m.test(area.value)
  area.value = text
  format = to
  paintFormat()
  validate()
  if (hadComments) showToast('Rewritten as JSON. YAML comments do not carry over', { duration: 3000 })
}

export function bindEditor() {
  const area = $('editorText')
  area.addEventListener('input', validate)
  area.addEventListener('keydown', (e) => {
    // Tab is left alone on purpose: capturing it would trap keyboard users in the field.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); applyEditor() }
  })
}

/** Text from a file, dropped into the open editor rather than applied. */
export function editorReceive(text) {
  $('editorText').value = text
  format = readDoc(text).format === 'json' ? 'json' : 'yaml'
  paintFormat()
  validate()
}
