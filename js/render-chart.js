// ── The chart view ───────────────────────────────────────────
// Around one person: the chain above their manager as small pills, the
// manager as the lead card, the manager's reports in a row with the person
// among them, and under each of those their own reports. Contractors, open
// roles and long lists fold into buckets that open in place.
// Every card carries view-transition-name p-<id>, so moving to someone else
// morphs each card from where it was to where it lands (nav.js).

import { state, ui, person } from './state.js'
import { focusView } from './tree.js'
import { escHtml, $ } from './utils.js'
import { avatar, cardLabel, statusWord, employmentWord, hueOf } from './people.js'
import { drawWires } from './wires.js'
import { icon } from './icons.js'
import { plural } from './core.js'

const COLUMN_LIMIT = 8
export const vtName = (id) => `p-${String(id).replace(/[^a-z0-9_-]/gi, '_')}`
const narrow = () => matchMedia('(max-width: 700px)').matches

const CHAIN_KEEP = 4 // ancestors kept above the lead when a chain is folded, besides the top
const ROW_WINDOW = 12 // peers kept around the focus when a row is folded

/**
 * Exactly what the chart will draw around one person: which ancestors, which
 * peers, which reports, and how many cards that is. renderChart() draws from
 * it and nav.js counts from it, so the view-transition gate can never
 * disagree with what lands on the page. Long chains and long rows fold the
 * way a column's reports do; the overview always shows the whole org.
 */
export function plan(ix, focusId) {
  const v = focusView(ix, focusId)
  const chainOpen = ui.expanded.has('chain')
  const chain = !chainOpen && v.chain.length > CHAIN_KEEP + 1
    ? { ids: [v.chain[0], ...v.chain.slice(-CHAIN_KEEP)], folded: v.chain.length - 1 - CHAIN_KEEP }
    : { ids: v.chain, folded: 0, open: chainOpen && v.chain.length > CHAIN_KEEP + 1 }
  const rowKey = `${v.parent}:row`
  let start = 0
  let end = v.row.length
  if (!ui.expanded.has(rowKey) && v.row.length > ROW_WINDOW) {
    const at = Math.max(0, v.row.indexOf(v.focus))
    start = Math.min(Math.max(0, at - Math.floor(ROW_WINDOW / 2)), v.row.length - ROW_WINDOW)
    end = start + ROW_WINDOW
  }
  const phone = narrow()
  const cols = []
  let cards = chain.ids.length + 1
  for (let i = start; i < end; i++) {
    const id = v.row[i]
    const split = v.columns[i]
    cards++
    if (phone && id !== v.focus) { cols.push({ id, split, collapsed: true }); continue }
    const people = ui.expanded.has(`${id}:more`) ? split.people : split.people.slice(0, COLUMN_LIMIT)
    const shows = (kind) => split[kind].length && (ui.expanded.has(`${id}:${kind}`) || split[kind].includes(state.me.id))
    cards += people.length + (shows('external') ? split.external.length : 0) + (shows('open') ? split.open.length : 0)
    cols.push({ id, split, people, external: shows('external'), open: shows('open') })
  }
  return { v, chain, row: { cols, before: start, after: v.row.length - end, key: rowKey, open: ui.expanded.has(rowKey) && v.row.length > ROW_WINDOW }, cards }
}

export function renderChart() {
  const el = $('chart')
  const ix = state.ix
  if (!ix || !ix.model.people.length) {
    el.innerHTML = emptyState()
    return null
  }
  const pl = plan(ix, ui.focus)
  const { v, chain, row } = pl
  ui.focus = v.focus
  const lead = person(v.parent)
  const chainItems = chain.ids.map((id) => `<li>${card(id, 'mini', v)}</li>`)
  if (chain.folded) chainItems.splice(1, 0, `<li><button type="button" class="bucket bucket--chain" data-bucket="chain" aria-expanded="false">${icon('up', { size: 14 })}${plural(chain.folded, 'more level')}</button></li>`)
  else if (chain.open) chainItems.push(`<li><button type="button" class="bucket bucket--fold" data-bucket="chain" aria-expanded="true">${icon('down', { size: 14 })}Fold the levels</button></li>`)
  const rowFold = (n, words) => `<li class="col col--fold"><button type="button" class="bucket bucket--row" data-bucket="${escHtml(row.key)}" aria-expanded="false">${escHtml(words(n))}</button></li>`
  const rowItems = row.cols.map((c) => column(c, v))
  if (row.before) rowItems.unshift(rowFold(row.before, (n) => `${n} earlier`))
  if (row.after) rowItems.push(rowFold(row.after, (n) => `${n} more`))
  if (row.open) rowItems.push(`<li class="col col--fold"><button type="button" class="bucket bucket--fold" data-bucket="${escHtml(row.key)}" aria-expanded="true">Fold the row</button></li>`)
  el.innerHTML = `
    ${chainItems.length ? `<ol class="chain" aria-label="Above ${escHtml(lead.name)}">${chainItems.join('')}</ol>` : ''}
    <div class="lead">${card(v.parent, 'lead', v)}</div>
    ${v.row.length
      ? `<ol class="row" aria-label="${escHtml(lead.virtual ? 'The top of the org' : `Reports to ${lead.name}`)}">${rowItems.join('')}</ol>`
      : `<p class="row-empty">${escHtml(lead.name)} has no reports in this document.</p>`}
    <svg class="wires" id="wires" aria-hidden="true" focusable="false"></svg>`
  drawWires(el, v)
  return v
}

function card(id, size, v) {
  const p = person(id)
  const ix = state.ix
  const n = ix.kids(id).length
  const cls = ['node', `node--${size}`,
    id === v.focus && 'is-focus',
    v.path.has(id) && id !== v.focus && 'is-path',
    id === state.me.id && 'is-me',
    p.virtual && 'is-org',
    p.status !== 'active' && `is-${p.status}`,
    employmentWord(p) && 'is-external',
  ].filter(Boolean).join(' ')
  const status = statusWord(p)
  const sub = size === 'mini'
    ? escHtml(p.title || '')
    : escHtml(p.title || (p.virtual ? '' : 'No title yet'))
  const badges = [
    id === state.me.id ? '<span class="tag tag--you">You</span>' : '',
    status && size !== 'mini' ? `<span class="tag tag--${p.status}">${escHtml(status)}</span>` : '',
  ].join('')
  return `<button type="button" class="${cls}" data-person="${escHtml(id)}" style="--hue:${hueOf(id)};view-transition-name:${vtName(id)}"${id === v.focus ? ' aria-current="true"' : ''} aria-label="${escHtml(cardLabel(p))}">` +
    avatar(p, size === 'mini' ? 'sm' : size === 'compact' ? 'sm' : 'md') +
    `<span class="node__text"><span class="node__name">${escHtml(p.name)}</span><span class="node__title">${sub}</span>${badges ? `<span class="node__tags">${badges}</span>` : ''}</span>` +
    (n && size !== 'mini' ? `<span class="node__count" aria-hidden="true">${icon('users', { size: 12 })}${n}</span>` : '') +
    '</button>'
}

function column(c, v) {
  const { id, split } = c
  const n = state.ix.kids(id).length
  const focusCol = id === v.focus
  // On a phone only the person's own reports open; the rest stay a count to tap.
  if (c.collapsed) {
    return `<li class="col">${card(id, 'row', v)}${n ? `<button type="button" class="bucket bucket--count" data-person="${escHtml(id)}">${icon('down', { size: 14 })}${plural(n, 'report')}</button>` : ''}</li>`
  }
  const items = c.people.map((r) => `<li>${card(r, 'compact', v)}</li>`)
  if (c.people.length < split.people.length) {
    items.push(`<li><button type="button" class="bucket" data-bucket="${escHtml(`${id}:more`)}" aria-expanded="false">${icon('down', { size: 14 })}${split.people.length - c.people.length} more</button></li>`)
  }
  items.push(...bucket(id, 'external', split.external, c.external, v, (k) => `${plural(k, 'contractor or vendor', 'contractors and vendors')}`, 'briefcase'))
  items.push(...bucket(id, 'open', split.open, c.open, v, (k) => plural(k, 'open role'), 'plus'))
  return `<li class="col${focusCol ? ' col--focus' : ''}">${card(id, 'row', v)}` +
    (items.length ? `<ol class="reports" aria-label="Reports to ${escHtml(person(id).name)}">${items.join('')}</ol>` : '') + '</li>'
}

/** Folded people open in place; a bucket holding the visitor opens by itself. */
function bucket(id, kind, ids, open, v, words, glyph) {
  if (!ids.length) return []
  const key = `${id}:${kind}`
  if (!open) {
    return [`<li><button type="button" class="bucket bucket--${kind}" data-bucket="${escHtml(key)}" aria-expanded="false">${icon(glyph, { size: 14 })}${escHtml(words(ids.length))}</button></li>`]
  }
  return [
    ...ids.map((r) => `<li>${card(r, 'compact', v)}</li>`),
    ids.includes(state.me.id) && !ui.expanded.has(key) ? '' : `<li><button type="button" class="bucket bucket--fold" data-bucket="${escHtml(key)}" aria-expanded="true">${icon('up', { size: 14 })}Fold ${escHtml(words(ids.length))}</button></li>`,
  ].filter(Boolean)
}

function emptyState() {
  return `<div class="empty">
    <h3>No one here yet</h3>
    <p>An org in Rama is one document: a list of people and who each reports to. Start from the example, write your own, or import a CSV from your HR tool.</p>
    <div class="empty__actions">
      <button type="button" class="btn btn--primary" data-action="example">${icon('sparkles')}<span>Load the example org</span></button>
      <button type="button" class="btn btn--secondary" data-action="edit">${icon('pencil')}<span>Write the document</span></button>
      <button type="button" class="btn btn--ghost" data-action="import">${icon('upload')}<span>Import a file</span></button>
    </div>
  </div>`
}

/** The focused card's element, for scrolling and keyboard focus. */
export const focusEl = () => $('chart').querySelector('.node.is-focus')
