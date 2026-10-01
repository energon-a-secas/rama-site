// ── Other formats ────────────────────────────────────────────
// CSV in and out (the shape an HR export arrives in), Mermaid for docs, and a
// vCard per person. Every import lands as a raw document for normalizeOrg, so
// there is still one gate. Pure: no DOM.

import { str, fieldHref } from './core.js'
import { CORE_KEYS } from './schema.js'

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF. Tab or semicolon separated works too. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = String(text).replace(/^\uFEFF/, '')
  const first = src.slice(0, src.search(/\r?\n|$/))
  const delim = first.includes(',') ? ',' : first.includes('\t') ? '\t' : first.includes(';') ? ';' : ','
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

const COLUMN = {
  name: 'name', 'full name': 'name', employee: 'name', 'employee name': 'name',
  id: 'id', 'employee id': 'id', username: 'id',
  email: 'email', 'work email': 'email', 'e-mail': 'email', mail: 'email',
  title: 'title', 'job title': 'title', position: 'title', role: 'role',
  manager: 'manager', 'reports to': 'manager', 'manager email': 'manager', 'manager name': 'manager', supervisor: 'manager', boss: 'manager', 'manager id': 'manager',
  team: 'team', department: 'team', group: 'team', squad: 'team',
  location: 'location', city: 'location', office: 'location', site: 'location',
  country: 'country', 'country code': 'country', tz: 'tz', timezone: 'tz', 'time zone': 'tz',
  employment: 'employment', type: 'employment', 'worker type': 'employment', 'employee type': 'employment',
  status: 'status', tags: 'tags', skills: 'tags', expertise: 'tags',
  start: 'start', 'start date': 'start', 'hire date': 'start',
  photo: 'photo', pronounced: 'pronounced', notes: 'notes', dotted: 'dotted',
}

const camel = (h) => h.trim().replace(/[^A-Za-z0-9]+(.)?/g, (_, ch) => (ch ? ch.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase()).slice(0, 60)

/** A CSV with a header row as a raw Rama document. Unknown columns become details. */
export function csvToDoc(text, title = 'Imported org') {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('A CSV needs a header row and at least one person')
  const header = rows[0].map((h) => {
    const k = h.trim().toLowerCase()
    return Object.hasOwn(COLUMN, k) ? COLUMN[k] : camel(h)
  })
  if (!header.includes('name')) throw new Error('The CSV header has no name column')
  const people = rows.slice(1).map((r) => {
    const p = {}
    header.forEach((k, i) => {
      const v = (r[i] ?? '').trim()
      if (!v || !k || Object.hasOwn(p, k)) return
      p[k] = k === 'tags' || k === 'dotted' ? v.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : v
    })
    return p
  })
  return { rama: 1, title, people }
}

/** A spreadsheet cell a formula-running app will not evaluate. */
const cell = (v) => {
  let s = Array.isArray(v) ? v.join('; ') : (v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join('; ') : String(v ?? ''))
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function orgToCsv(model) {
  const extras = [...new Set(model.people.flatMap((p) => Object.keys(p.extra)))].filter((k) => !CORE_KEYS.includes(k))
  const byId = new Map(model.people.map((p) => [p.id, p]))
  const cols = ['id', 'name', 'email', 'title', 'manager', 'manager_name', 'team', 'location', 'country', 'tz', 'employment', 'status', 'tags', 'start', ...extras]
  const lines = [cols.join(',')]
  for (const p of model.people) {
    const team = model.teams.find((t) => t.id === p.team)
    const row = { ...p, email: p.email[0] || '', manager_name: byId.get(p.manager)?.name || '', team: team?.name || '', ...p.extra }
    lines.push(cols.map((c) => cell(row[c])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

const mm = (s) => str(s, 80).replace(/["<>]/g, "'").replace(/[\r\n]+/g, ' ')

/** The reporting lines as a Mermaid flowchart, for a README or a wiki page. */
export function orgToMermaid(model, limit = 400) {
  const people = model.people.slice(0, limit)
  const ids = new Map(people.map((p, i) => [p.id, `p${i}`]))
  const lines = ['flowchart TB']
  for (const p of people) lines.push(`  ${ids.get(p.id)}["${mm(p.name)}${p.title ? `<br/><small>${mm(p.title)}</small>` : ''}"]`)
  for (const p of people) if (p.manager && ids.has(p.manager)) lines.push(`  ${ids.get(p.manager)} --> ${ids.get(p.id)}`)
  if (model.people.length > limit) lines.push(`  %% ${model.people.length - limit} more people left out`)
  return lines.join('\n') + '\n'
}

const vc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')

/** Fold at 75 octets, continuation lines start with a space (RFC 6350 3.2). */
function fold(line) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0 }
    cur += ch
    size += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

/** A vCard 3.0 contact for one person. */
export function personToVcard(p, { org = '', team = '', manager = '', fields = {} } = {}) {
  const parts = p.name.split(/\s+/)
  const last = parts.length > 1 ? parts.pop() : ''
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vc(last)};${vc(parts.join(' '))};;;`, `FN:${vc(p.name)}`]
  if (p.title) lines.push(`TITLE:${vc(p.title)}`)
  if (org || team) lines.push(`ORG:${vc(org)}${team ? `;${vc(team)}` : ''}`)
  p.email.forEach((e, i) => lines.push(`EMAIL;TYPE=${i ? 'INTERNET' : 'INTERNET,WORK,PREF'}:${vc(e)}`))
  for (const [k, def] of Object.entries(fields)) {
    const v = p.extra[k]
    if (typeof v !== 'string') continue
    if (def.type === 'phone') lines.push(`TEL;TYPE=WORK:${vc(v)}`)
    else if (def.type === 'url' && fieldHref(def, v)) lines.push(`URL:${fieldHref(def, v)}`)
  }
  if (p.location || p.country) lines.push(`ADR;TYPE=WORK:;;;${vc(p.location)};;;${vc(p.country)}`)
  if (p.photo) lines.push(`PHOTO;VALUE=URI:${p.photo}`)
  const note = [manager && `Reports to ${manager}`, p.pronounced && `Pronounced: ${p.pronounced}`].filter(Boolean).join('. ')
  if (note) lines.push(`NOTE:${vc(note)}`)
  lines.push('END:VCARD')
  return lines.map(fold).join('\r\n') + '\r\n'
}
