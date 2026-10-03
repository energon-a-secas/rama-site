// ── A person, drawn ──────────────────────────────────────────
// The pieces every view shares: the avatar, the colour a person carries,
// the short status words, and the label a screen reader hears. The chart,
// the overview, the panel and search all draw people through here.

import { state } from './state.js'
import { isExternal } from './tree.js'
import { initials, hash, plural } from './core.js'
import { escHtml } from './utils.js'
import { icon } from './icons.js'

/** One hue per division (the people right under the top), so a division reads as one family. */
const DIVISION_HUES = [158, 199, 262, 328, 32, 186, 286, 12, 222, 98]
const ACCENT_HUE = 158

let memo = { ix: null, hues: new Map() }

export function hueOf(id) {
  const ix = state.ix
  if (!ix) return ACCENT_HUE
  if (memo.ix !== ix) memo = { ix, hues: new Map() }
  if (memo.hues.has(id)) return memo.hues.get(id)
  let hue = ACCENT_HUE
  if (id !== ix.top) {
    const branch = ix.branchOf(id)
    const i = ix.kids(ix.top).indexOf(branch)
    const base = DIVISION_HUES[(i < 0 ? 0 : i) % DIVISION_HUES.length]
    hue = id === branch ? base : base + ((hash(id) % 25) - 12)
  }
  memo.hues.set(id, hue)
  return hue
}

export const divisionHue = (i) => DIVISION_HUES[i % DIVISION_HUES.length]

const MARKS = {
  contractor: ['C', 'Contractor'],
  vendor: ['V', 'Vendor'],
  intern: ['I', 'Intern'],
}

/** Where someone's day is (core.js dayPart), in words and as a colour. */
export const DAY_WORDS = { work: 'Working hours', edge: 'Before or after work', night: 'Night', weekend: 'Weekend' }
export const DAY_COLORS = { work: '#34d399', edge: '#fbbf24', night: '#818cf8', weekend: '#f472b6' }

/** Status words for a card's badge, or ''. */
export function statusWord(p) {
  if (p.status === 'open') return 'Open role'
  if (p.status === 'leave') return 'On leave'
  if (p.status === 'incoming') return p.start ? `Starts ${shortDate(p.start)}` : 'Starting soon'
  return ''
}

export function employmentWord(p) {
  return MARKS[p.employment]?.[1] || (p.employment === 'employee' ? '' : p.employment)
}

export function shortDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : 'numeric' })
}

export function avatar(p, size = 'md') {
  if (p.virtual) return `<span class="avatar avatar--${size} avatar--org" aria-hidden="true">${icon('network', { size: size === 'xl' ? 34 : 18 })}</span>`
  if (p.status === 'open') return `<span class="avatar avatar--${size} avatar--open" aria-hidden="true">${icon('plus', { size: size === 'xl' ? 30 : 16 })}</span>`
  const mark = MARKS[p.employment]
  const corner = p.status === 'leave' ? `<span class="avatar__mark avatar__mark--leave">${icon('moon', { size: 10 })}</span>`
    : p.status === 'incoming' ? `<span class="avatar__mark avatar__mark--new">${icon('sparkles', { size: 10 })}</span>`
      : mark ? `<span class="avatar__mark avatar__mark--ext">${mark[0]}</span>` : ''
  // A foreign document's photos wait for the visitor's say-so (state.foreign): see openDoc.
  const img = p.photo && !state.foreign ? `<img class="avatar__img" src="${escHtml(p.photo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''
  return `<span class="avatar avatar--${size}${p.status === 'leave' ? ' avatar--dim' : ''}" style="--hue:${hueOf(p.id)}" aria-hidden="true">` +
    `<span class="avatar__initials">${escHtml(initials(p.name))}</span>${img}${corner}</span>`
}

/** What a screen reader hears for a card. */
export function cardLabel(p) {
  const ix = state.ix
  const n = ix.kids(p.id).length
  const parts = [p.name]
  if (p.title) parts.push(p.title)
  if (p.id === state.me.id) parts.push('you')
  const status = statusWord(p)
  if (status && p.status !== 'open') parts.push(status)
  const emp = employmentWord(p)
  if (emp) parts.push(emp)
  if (n) parts.push(`${plural(n, 'direct report')}, ${plural(ix.size.get(p.id), 'person', 'people')} in their org`)
  return parts.join(', ')
}

export { isExternal }
