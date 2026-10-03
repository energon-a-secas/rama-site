// ── What the menus do ────────────────────────────────────────
// Export, hand off, import, the example and a blank org. Handoffs build the
// other tool's own document (handoff.js) and open it through that tool's
// published link contract; when a link would be too long, the file downloads.

import { state, ui, person, openDoc, savedDoc, previousDocs, takePrevious, setPicked } from './state.js'
import { modelToText, shareLink, headcount } from './docio.js'
import { orgToCsv, orgToMermaid, personToVcard } from './formats.js'
import { toFloorplanDoc, toRepartoDoc, floorplanLink, repartoLink, REPARTO_MAX } from './handoff.js'
import { dumpYaml } from './yaml.js'
import { slug, plural } from './core.js'
import { showToast, copyText, downloadText } from './utils.js'
import { drawAll, draw } from './render.js'
import { replaceAt } from './nav.js'

const filename = (ext) => `${slug(state.model?.title) || 'org'}.${ext}`
const toast = (msg, duration = 2800) => showToast(msg, { duration })

/** The document as YAML text: the visitor's own text when it is YAML, comments kept. */
export const currentYaml = () => (state.format === 'yaml' && state.text ? state.text : modelToText(state.model, 'yaml'))

export async function exportAs(kind) {
  const m = state.model
  if (!m) return
  if (kind === 'yaml') downloadText(currentYaml(), filename('yaml'), 'text/yaml')
  else if (kind === 'json') downloadText(modelToText(m, 'json'), filename('json'), 'application/json')
  else if (kind === 'csv') downloadText(orgToCsv(m), filename('csv'), 'text/csv')
  else if (kind === 'mermaid') downloadText(orgToMermaid(m), filename('mmd'), 'text/plain')
  else if (kind === 'link') {
    const ok = await copyText(shareLink(currentYaml()))
    toast(ok ? 'Copied a link that carries the whole org. Anyone who opens it sees this document' : 'Could not copy the link')
  } else if (kind === 'prompt') {
    const ok = await copyText(prompt())
    toast(ok ? 'Copied. Paste it to Claude and describe the change' : 'Could not copy the prompt')
  }
}

function prompt() {
  return [
    'Here is my organization as a Rama org document (schema: https://rama.neorgon.com/llms.txt).',
    'Change it as described below and return the whole document in one YAML code block, in the same format.',
    '',
    'Change: <describe the change: a new hire, a reorg, a manager swap>',
    '',
    '```yaml',
    currentYaml().trimEnd(),
    '```',
  ].join('\n')
}

/** The person whose org a handoff covers: the focus if they manage anyone, else their manager. */
function scopeFor(id) {
  const ix = state.ix
  return ix.kids(id).length ? id : ix.parentOf(id) || ix.top
}

export async function handoff(kind) {
  const ix = state.ix
  if (!ix) return
  const focus = ui.focus || ix.top
  if (kind.startsWith('floorplan')) {
    const scope = kind === 'floorplan-all' ? ix.top : scopeFor(focus)
    const doc = toFloorplanDoc(ix, scope)
    const text = `# Floorplan document. Schema and examples: https://floorplan.neorgon.com/llms.txt\n# Handed over by Rama (rama.neorgon.com)\n${dumpYaml(doc)}`
    const name = `${slug(doc.title) || 'org'}-floorplan.yaml`
    if (kind === 'floorplan-file') {
      downloadText(text, name, 'text/yaml')
      return toast('Downloaded. Import it in Floorplan from the Examples menu')
    }
    const link = floorplanLink(text)
    if (!link) {
      downloadText(text, name, 'text/yaml')
      return toast(`${plural(doc.people.length, 'person', 'people')} is too many for a Floorplan link, so the YAML downloaded instead. Import it in Floorplan`, 4200)
    }
    window.open(link, '_blank', 'noopener')
    return toast(`Opened ${plural(doc.people.length, 'person', 'people')} in Floorplan`)
  }
  const { plan, lead, dropped } = toRepartoDoc(ix, focus)
  const cut = dropped ? `. ${dropped} more did not fit: Reparto plans up to ${REPARTO_MAX} people` : ''
  if (!plan.people.length) return toast('There is nobody to plan yet')
  if (kind === 'reparto-file') {
    downloadText(`${JSON.stringify(plan, null, 2)}\n`, `${slug(plan.title) || 'team'}-reparto.json`, 'application/json')
    return toast(`Downloaded. Import it in Reparto from the Plans menu${cut}`, cut ? 4200 : 2800)
  }
  window.open(repartoLink(plan), '_blank', 'noopener')
  toast(`Opened ${person(lead).virtual ? 'the top level' : `${person(lead).name}'s team`} in Reparto, ${plural(plan.people.length, 'person', 'people')}${cut}`, cut ? 4200 : 2800)
}

export function downloadVcard(id) {
  const p = person(id)
  if (!p) return
  const ix = state.ix
  const team = ix.teamById.get(p.team)?.name || ''
  const manager = person(ix.parentOf(id))
  downloadText(personToVcard(p, { org: ix.model.title, team, manager: manager && !manager.virtual ? manager.name : '', fields: ix.model.fields }), `${slug(p.name) || 'contact'}.vcf`, 'text/vcard')
}

export async function copyPersonLink(id) {
  const base = new URL(location.href)
  base.search = ''
  base.hash = ''
  base.searchParams.set('at', id)
  const ok = await copyText(shareLink(currentYaml(), base.href))
  toast(ok ? `Copied a link that opens this org on ${person(id).name}` : 'Could not copy the link')
}

// ── Documents in ─────────────────────────────────────────────

/**
 * Open a document as the current org. state.openDoc puts the visitor's saved
 * org on the Restore list first, so nothing they wrote is lost to it.
 */
export function openText(text, { source, name = '' }) {
  const before = savedDoc()
  const read = openDoc(text, { source, name })
  if (!read.model) {
    toast(`Could not open it: ${read.issues[0]?.msg || 'unreadable'}`, 4000)
    return null
  }
  ui.focus = state.me.id || state.ix.top
  replaceAt(ui.focus)
  drawAll()
  const words = `${headcount(read.model)}${read.issues.length ? `, ${plural(read.issues.length, 'warning')}` : ''}`
  const kept = before && before.text !== state.text && source !== 'saved'
  toast(kept ? `Opened ${read.model.title}: ${words}. Your previous org is under Org > Restore` : `Opened ${read.model.title}: ${words}`, 3600)
  warnIfUnsaved()
  paintRestore()
  return read
}

/** The example is shown, never saved over the visitor's org; it is kept only once they edit it. */
export async function loadExample({ first = false } = {}) {
  try {
    const res = await fetch('examples/lanternfish.yaml', { cache: 'no-cache' })
    if (!res.ok) throw new Error(String(res.status))
    const text = await res.text()
    if (first) return openDoc(text, { source: 'example' })
    return openText(text, { source: 'example' })
  } catch {
    toast('The example could not be fetched. Check the connection and try again', 3600)
    return null
  }
}

let warned = false
/** Once per visit: storage is blocked, so nothing outlives the tab. */
export function warnIfUnsaved() {
  if (state.storageOk || warned) return
  warned = true
  toast('This browser is not keeping anything (storage is blocked), so this org lasts until you close the tab. Download it from the Org menu to keep it', 6000)
}

export const BLANK = `# Rama org document. Schema and examples: https://rama.neorgon.com/llms.txt
rama: 1
title: My org
people:
  - name: Your Name
    email: you@example.com
    role: eng-manager
    manager: your-manager
    location: Santiago, Chile
    country: CL
    tz: America/Santiago
  - name: Your Manager
    id: your-manager
    role: eng-director
  - name: A Teammate
    role: senior-engineer
    manager: your-name
  - name: Open role
    role: engineer
    manager: your-name
    status: open
`

export function restorePrevious(i = 0) {
  const prev = takePrevious(i)
  if (!prev) return toast('There is no previous org to bring back')
  const read = openDoc(prev.text, { source: 'restore', foreign: prev.foreign })
  if (!read.model) { paintRestore(); return toast('The previous org could not be read') }
  ui.focus = state.me.id || state.ix.top
  replaceAt(ui.focus)
  drawAll()
  paintRestore()
  toast(`Back to ${read.model.title}. The org it replaced is on the Restore list`, 3200)
}

/** One Restore row per org this browser kept aside, newest first. */
export function paintRestore() {
  const menu = document.getElementById('orgMenu')
  for (const old of menu.querySelectorAll('[data-action="restore"]')) old.remove()
  const list = previousDocs()
  let at = menu.querySelector('[data-action="blank"]')
  list.forEach((prev, i) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.dataset.action = 'restore'
    item.dataset.index = String(i)
    item.textContent = `Restore ${prev.title || 'an earlier org'}`
    at.after(item)
    at = item
  })
}

export function thisIsMe(id, yes) {
  if (!yes && state.me.source === 'account') {
    return toast('Your Neorgon account email is on this card, so Rama keeps finding you here. Sign out, or change the email in the document', 4200)
  }
  // A ?me= in the link names the visitor until they say otherwise, either way.
  if (state.param && (!yes || state.me.id !== id)) {
    state.param = ''
    const url = new URL(location.href)
    url.searchParams.delete('me')
    history.replaceState(history.state, '', url)
  }
  setPicked(yes ? id : '')
  draw()
  toast(yes ? `This browser opens ${state.model.title} on ${person(id).name} now` : 'Forgotten. Rama opens at the top until you pick a card')
}
