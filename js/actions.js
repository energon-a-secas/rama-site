// ── What the menus do ────────────────────────────────────────
// Export, hand off, import, the example and a blank org. Handoffs build the
// other tool's own document (handoff.js) and open it through that tool's
// published link contract; when a link would be too long, the file downloads.

import { state, ui, person, loadText, stashCurrent, previousDoc, clearPrevious, setPicked } from './state.js'
import { modelToText, shareLink, YAML_HEADER } from './docio.js'
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

/** Open a document as the current org, keeping the visitor's own one aside. */
export function openText(text, { source, name = '' }) {
  const before = state.text
  const stashed = before && before !== text ? stashCurrent(source) : false
  const read = loadText(text, { source, name })
  if (!read.model) {
    toast(`Could not open it: ${read.issues[0]?.msg || 'unreadable'}`, 4000)
    return null
  }
  ui.focus = state.me.id || state.ix.top
  replaceAt(ui.focus)
  drawAll()
  const words = `${plural(read.model.people.length, 'person', 'people')}${read.issues.length ? `, ${plural(read.issues.length, 'warning')}` : ''}`
  toast(stashed ? `Opened ${read.model.title}: ${words}. Your previous org is under Org > Restore` : `Opened ${read.model.title}: ${words}`, 3600)
  paintRestore()
  return read
}

export async function loadExample({ save = true } = {}) {
  try {
    const res = await fetch('examples/lanternfish.yaml', { cache: 'no-cache' })
    if (!res.ok) throw new Error(String(res.status))
    const text = await res.text()
    if (!save) return loadText(text, { source: 'example', save: false })
    return openText(text, { source: 'example' })
  } catch {
    toast('The example could not be fetched. Check the connection and try again', 3600)
    return null
  }
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

export function restorePrevious() {
  const prev = previousDoc()
  if (!prev) return toast('There is no previous org to bring back')
  const read = loadText(prev.text, { source: 'saved' })
  if (!read.model) return toast('The previous org could not be read')
  clearPrevious()
  ui.focus = state.me.id || state.ix.top
  replaceAt(ui.focus)
  drawAll()
  paintRestore()
  toast(`Back to ${read.model.title}`)
}

/** Offer Restore in the Org menu only while there is something to restore. */
export function paintRestore() {
  const menu = document.getElementById('orgMenu')
  let item = menu.querySelector('[data-action="restore"]')
  const prev = previousDoc()
  if (!prev) { item?.remove(); return }
  if (!item) {
    item = document.createElement('button')
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.dataset.action = 'restore'
    menu.querySelector('[data-action="blank"]').after(item)
  }
  item.textContent = `Restore ${prev.title || 'your previous org'}`
}

export function thisIsMe(id, yes) {
  if (!yes && state.me.source === 'account') {
    return toast('Your Neorgon account email is on this card, so Rama keeps finding you here. Sign out, or change the email in the document', 4200)
  }
  if (!yes && state.me.source === 'link') {
    state.param = ''
    const url = new URL(location.href)
    url.searchParams.delete('me')
    history.replaceState(history.state, '', url)
  }
  setPicked(yes ? id : '')
  draw()
  toast(yes ? `This browser opens ${state.model.title} on ${person(id).name} now` : 'Forgotten. Rama opens at the top until you pick a card')
}
