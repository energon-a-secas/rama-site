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

export function renderChart() {
  const el = $('chart')
  const ix = state.ix
  if (!ix || !ix.model.people.length) {
    el.innerHTML = emptyState()
    return null
  }
  const v = focusView(ix, ui.focus)
  ui.focus = v.focus
  const lead = person(v.parent)
  el.innerHTML = `
    ${v.chain.length ? `<ol class="chain" aria-label="Above ${escHtml(lead.name)}">${v.chain.map((id) => `<li>${card(id, 'mini', v)}</li>`).join('')}</ol>` : ''}
    <div class="lead">${card(v.parent, 'lead', v)}</div>
    ${v.row.length
      ? `<ol class="row" aria-label="${escHtml(lead.virtual ? 'The top of the org' : `Reports to ${lead.name}`)}">${v.row.map((id, i) => column(id, v.columns[i], v)).join('')}</ol>`
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

function column(id, split, v) {
  const ix = state.ix
  const n = ix.kids(id).length
  const focusCol = id === v.focus
  // On a phone only the person's own reports open; the rest stay a count to tap.
  if (narrow() && !focusCol) {
    return `<li class="col">${card(id, 'row', v)}${n ? `<button type="button" class="bucket bucket--count" data-person="${escHtml(id)}">${icon('down', { size: 14 })}${plural(n, 'report')}</button>` : ''}</li>`
  }
  const items = []
  const more = `${id}:more`
  const shown = ui.expanded.has(more) ? split.people : split.people.slice(0, COLUMN_LIMIT)
  for (const r of shown) items.push(`<li>${card(r, 'compact', v)}</li>`)
  if (shown.length < split.people.length) {
    items.push(`<li><button type="button" class="bucket" data-bucket="${escHtml(more)}">${icon('down', { size: 14 })}${split.people.length - shown.length} more</button></li>`)
  }
  items.push(...bucket(id, 'external', split.external, v, (k) => `${plural(k, 'contractor or vendor', 'contractors and vendors')}`, 'briefcase'))
  items.push(...bucket(id, 'open', split.open, v, (k) => plural(k, 'open role'), 'plus'))
  return `<li class="col${focusCol ? ' col--focus' : ''}">${card(id, 'row', v)}` +
    (items.length ? `<ol class="reports" aria-label="Reports to ${escHtml(person(id).name)}">${items.join('')}</ol>` : '') + '</li>'
}

/** Folded people open in place; a bucket holding the visitor opens by itself. */
function bucket(id, kind, ids, v, words, glyph) {
  if (!ids.length) return []
  const key = `${id}:${kind}`
  const open = ui.expanded.has(key) || ids.includes(state.me.id)
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
