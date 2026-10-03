// ── The profile panel ────────────────────────────────────────
// Everything the document says about one person, in the order a colleague
// needs it: who they are, how to reach them, where they sit, what they know,
// and the extra details the org chose to add. Declared fields come first in
// their declared order with their labels; undeclared extras follow.

import { state, ui, person } from './state.js'
import { CORE_KEYS } from './schema.js'
import { escHtml, $ } from './utils.js'
import { avatar, statusWord, employmentWord, shortDate, hueOf } from './people.js'
import { renderMarkdown } from './markdown.js'
import { fieldHref, plural } from './core.js'
import { icon } from './icons.js'

const TAG_LIMIT = 6

export function renderPanel() {
  const panel = $('panel')
  const p = person(ui.focus)
  const open = ui.panel && !!p
  panel.hidden = !open
  document.body.classList.toggle('has-panel', open)
  if (!open) return
  $('panelBody').innerHTML = p.virtual ? orgSummary(p) : profile(p)
}

function profile(p) {
  const ix = state.ix
  const model = ix.model
  const manager = person(ix.parentOf(p.id))
  const reports = ix.kids(p.id)
  const isMe = p.id === state.me.id
  const status = statusWord(p)
  const emp = employmentWord(p)
  const role = model.roles[p.role]
  const teams = (ix.teamsOf.get(p.id) || []).map(({ team, pct }) => ({ t: ix.teamById.get(team), pct })).filter((x) => x.t)
  const levels = ix.chain(p.id).filter((id) => !person(id).virtual).length

  const hero = `<header class="panel__hero" style="--hue:${hueOf(p.id)}">
      <button type="button" class="btn btn--ghost btn--icon panel__close" data-action="close-panel" aria-label="Close the profile" aria-keyshortcuts="Escape">${icon('x')}</button>
      ${avatar(p, 'xl')}
      <h2 class="panel__name" id="panelName">${escHtml(p.name)}</h2>
      ${p.pronounced ? `<p class="panel__said">Pronounced <q>${escHtml(p.pronounced)}</q></p>` : ''}
      <p class="panel__title">${escHtml(p.title || 'No title yet')}</p>
      <p class="panel__meta">${[role?.level && `Level ${role.level}`, teams[0] && teams[0].t.name, typeof p.extra.pronouns === 'string' && p.extra.pronouns].filter(Boolean).map((x) => `<span>${escHtml(x)}</span>`).join('')}</p>
      <p class="panel__tags">${[isMe && '<span class="tag tag--you">You</span>', status && `<span class="tag tag--${p.status}">${escHtml(status)}</span>`, emp && `<span class="tag tag--ext">${escHtml(emp)}</span>`].filter(Boolean).join('')}</p>
    </header>`

  const contact = []
  p.email.forEach((e, i) => contact.push(row('mail', `<a href="mailto:${escHtml(e)}">${escHtml(e)}</a>`, i ? '' : `<button type="button" class="btn-icon" data-copy="${escHtml(e)}" aria-label="Copy ${escHtml(e)}">${icon('copy', { size: 14 })}</button>`)))
  if (!p.virtual && p.status !== 'open') contact.push(row('card', `<button type="button" class="btn-link" data-action="vcard">Download contact.vcf</button>`))
  if (p.location || p.country) contact.push(row('pin', escHtml(place(p))))
  if (p.tz) contact.push(row('clock', `<span data-localtime="${escHtml(p.tz)}">${escHtml(localTime(p.tz))}</span>`))

  const org = []
  if (manager) org.push(dl('Reports to', personLink(manager)))
  if (p.dotted.length) org.push(dl('Dotted line to', p.dotted.map((id) => personLink(person(id))).join(', ')))
  if (reports.length) {
    org.push(dl('Direct reports', `${reports.length}`))
    org.push(`<div class="chips">${reports.slice(0, 24).map((id) => chip(person(id))).join('')}${reports.length > 24 ? `<span class="chip chip--more">${reports.length - 24} more</span>` : ''}</div>`)
    org.push(dl('Their org', plural(ix.size.get(p.id), 'person', 'people')))
  }
  org.push(dl('Level from the top', `${levels} of ${ix.stats.levels}`))
  if (p.start) org.push(dl(p.status === 'incoming' ? 'Starts' : 'Joined', escHtml(tenure(p.start))))

  const teamHtml = teams.length ? `<ul class="teams">${teams.map(({ t, pct }) =>
    `<li><span class="swatch" style="--c:${t.color || 'var(--accent)'}"></span><span>${escHtml(t.name)}</span>${pct !== 100 ? `<span class="teams__pct">${pct}%</span>` : ''}${t.owns.length ? `<small>owns ${escHtml(t.owns.join(', '))}</small>` : ''}</li>`).join('')}</ul>` : ''

  const tags = p.tags.length ? `<div class="chips chips--tags" data-tags>${p.tags.map((t, i) => `<span class="chip chip--tag"${i >= TAG_LIMIT ? ' data-extra hidden' : ''}>${escHtml(t)}</span>`).join('')}${p.tags.length > TAG_LIMIT ? `<button type="button" class="chip chip--more" data-action="more-tags" data-more="+${p.tags.length - TAG_LIMIT}" aria-expanded="false">+${p.tags.length - TAG_LIMIT}</button>` : ''}</div>` : ''

  const details = extras(p, model)

  // The org's own notes live on the top card when there is one person at the top (the virtual top shows them otherwise).
  const orgNotes = p.id === ix.top && model.notes ? section('About this org', `<div class="prose">${renderMarkdown(model.notes)}</div>`) : ''
  return hero + orgNotes +
    section('Contact', contact.join('')) +
    section('Org', org.join('')) +
    (teamHtml ? section(teams.length > 1 ? 'Teams' : 'Team', teamHtml) : '') +
    (tags ? section('Expertise', tags) : '') +
    (details ? section('Details', details) : '') +
    (p.notes ? section('Notes', `<div class="prose">${renderMarkdown(p.notes)}</div>`) : '') +
    actions(p, isMe, reports.length)
}

function orgSummary(p) {
  const s = state.ix.stats
  const tops = state.ix.kids(p.id)
  return `<header class="panel__hero">
      <button type="button" class="btn btn--ghost btn--icon panel__close" data-action="close-panel" aria-label="Close the profile">${icon('x')}</button>
      ${avatar(p, 'xl')}
      <h2 class="panel__name">${escHtml(p.name)}</h2>
      <p class="panel__title">${escHtml(tops.length ? `${plural(tops.length, 'person', 'people')} at the top, nobody above them` : 'No people yet')}</p>
    </header>` +
    (state.ix.model.notes ? section('About', `<div class="prose">${renderMarkdown(state.ix.model.notes)}</div>`) : '') +
    section('At a glance', [dl('People', s.people), dl('Managers', s.managers), dl('Levels', s.levels), dl('Countries', s.countries), dl('Open roles', s.open), dl('Contractors and vendors', s.external), dl('Teams', s.teams)].join(''))
}

function extras(p, model) {
  const declared = Object.entries(model.fields).filter(([k, f]) => !f.hidden && p.extra[k] != null).sort((a, b) => a[1].order - b[1].order)
  const rest = Object.keys(p.extra).filter((k) => !Object.hasOwn(model.fields, k) && !CORE_KEYS.includes(k) && k !== 'pronouns' && k !== 'avatar')
  const out = []
  for (const [k, f] of declared) {
    if (k === 'pronouns') continue
    out.push(dl(f.label, value(p.extra[k], f)))
  }
  for (const k of rest) out.push(dl(humanize(k), value(p.extra[k], null)))
  return out.join('')
}

function value(v, def) {
  if (Array.isArray(v)) return `<span class="chips">${v.map((x) => `<span class="chip">${escHtml(x)}</span>`).join('')}</span>`
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${escHtml(humanize(k))}: ${linkOr(x, null)}`).join('<br>')
  if (def?.type === 'markdown') return `<div class="prose">${renderMarkdown(v)}</div>`
  if (def?.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return escHtml(shortDate(v))
  if (def?.type === 'handle') return escHtml(v.startsWith('@') ? v : `@${v}`)
  return linkOr(v, def)
}

function linkOr(v, def) {
  const href = fieldHref(def, String(v))
  if (!href) return escHtml(v)
  const external = href.startsWith('https:')
  return `<a href="${escHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escHtml(v)}${external ? icon('external', { size: 12 }) : ''}</a>`
}

function actions(p, isMe, reports) {
  const team = reports || state.ix.parentOf(p.id)
  return `<footer class="panel__actions">
    ${p.status === 'open' || p.virtual ? '' : `<button type="button" class="btn btn--${isMe ? 'ghost' : 'secondary'} btn--sm" data-action="${isMe ? 'not-me' : 'this-is-me'}">${icon(isMe ? 'x' : 'locate')}<span>${isMe ? 'This is not me' : 'This is me'}</span></button>`}
    <button type="button" class="btn btn--ghost btn--sm" data-handoff="floorplan">${icon('rooms')}<span>${reports ? 'Their org in Floorplan' : 'Floorplan'}</span></button>
    ${team ? `<button type="button" class="btn btn--ghost btn--sm" data-handoff="reparto">${icon('calendar')}<span>${reports ? 'Plan their team in Reparto' : 'Plan this team in Reparto'}</span></button>` : ''}
    <button type="button" class="btn btn--ghost btn--sm" data-action="copy-person-link">${icon('link')}<span>Link to this card</span></button>
    <button type="button" class="btn btn--ghost btn--sm" data-action="edit-person">${icon('pencil')}<span>Edit in the document</span></button>
  </footer>`
}

const section = (title, body) => (body ? `<section class="panel__section"><h3>${escHtml(title)}</h3>${body}</section>` : '')
const row = (glyph, body, after = '') => `<p class="panel__row">${icon(glyph, { size: 15 })}<span>${body}</span>${after}</p>`
/** valueHtml is markup the caller already escaped, or a number. */
const dl = (label, valueHtml) => `<div class="panel__dl"><span class="panel__dt">${escHtml(label)}</span><span class="panel__dd">${valueHtml}</span></div>`
const personLink = (q) => (q ? `<button type="button" class="btn-link" data-person="${escHtml(q.id)}">${escHtml(q.name)}</button>` : '')
const chip = (q) => `<button type="button" class="chip chip--person" data-person="${escHtml(q.id)}" style="--hue:${hueOf(q.id)}">${escHtml(q.name)}</button>`

export const humanize = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** "Lagos, Nigeria": the country's name is added only when the location does not already say it. */
function place(p) {
  let country = p.country
  try { country = new Intl.DisplayNames(['en'], { type: 'region' }).of(p.country) || p.country } catch { /* keep the code */ }
  if (!p.location) return country
  if (!p.country || p.location.toLowerCase().includes(country.toLowerCase()) || p.location.includes(p.country)) return p.location
  return `${p.location}, ${country}`
}

/** "14:32 there, 3 hours ahead of you". */
export function localTime(tz) {
  try {
    const now = new Date()
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tzName(tz) }).format(now)
    const offset = (zone) => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(now).find((x) => x.type === 'timeZoneName')?.value || 'GMT'
      const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(parts)
      return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0
    }
    const diff = (offset(tzName(tz)) - offset(Intl.DateTimeFormat().resolvedOptions().timeZone)) / 60
    const rel = diff === 0 ? 'same time as you' : `${Math.abs(diff) % 1 ? Math.abs(diff).toFixed(1) : Math.abs(diff)} ${Math.abs(diff) === 1 ? 'hour' : 'hours'} ${diff > 0 ? 'ahead of' : 'behind'} you`
    return `${time} there, ${rel}`
  } catch {
    return tz
  }
}

/** "+2" and "-3:30" become Etc zones Intl understands; IANA names pass through. */
function tzName(tz) {
  const m = /^([+-])(\d{1,2})(?::(\d{2}))?$/.exec(tz)
  if (!m) return tz
  if (m[3] && m[3] !== '00') throw new Error('Intl has no half-hour Etc zones')
  return `Etc/GMT${m[1] === '+' ? '-' : '+'}${Number(m[2])}`
}

function tenure(iso) {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  const months = Math.round((Date.now() - d.getTime()) / (30.44 * 864e5))
  if (months < 0) return shortDate(iso)
  const years = Math.floor(months / 12)
  const span = years ? `${plural(years, 'year')}${months % 12 ? `, ${plural(months % 12, 'month')}` : ''}` : plural(Math.max(1, months), 'month')
  return `${shortDate(iso)}, ${span} ago`
}
