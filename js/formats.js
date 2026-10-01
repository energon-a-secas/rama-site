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
  let openedAt = 0
  const src = String(text).replace(/^\uFEFF/, '')
  const delim = sniffDelimiter(src)
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') { quoted = true; openedAt = rows.length + 1 }
    else if (c === delim) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  // A quote that never closes would swallow the rest of the file into one cell, silently.
  if (quoted) throw new Error(`The CSV has a quote that never closes, starting on row ${openedAt}`)
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

/** The separator the header row uses most, counting only outside quotes. Ties and none go to a comma. */
function sniffDelimiter(src) {
  const counts = { ',': 0, '\t': 0, ';': 0 }
  let quoted = false
  let started = false
  for (const c of src) {
    if (!started && (c === '\n' || c === '\r' || c === ' ')) continue // blank lines before the header
    started = true
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === '\n' || c === '\r')) break
    else if (!quoted && c in counts) counts[c]++
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best[1] > counts[','] ? best[0] : ','
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

/** An unknown header as a detail key: "Cost Centre" is costCentre, "Teléfono" is telefono, and a header with no Latin letters keeps its own text. */
/** Header aliases compared on letters and digits only: Full_Name, full-name and FullName are one header. */
const squash = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
const COLUMN_SQUASHED = () => {
  const out = {}
  for (const [k, v] of Object.entries(COLUMN)) out[squash(k)] = v
  Object.assign(out, { displayname: 'name', preferredname: 'name', fullname: 'name', jobtitle: 'title', businesstitle: 'title', workemail: 'email', emailaddress: 'email', reportsto: 'manager', managername: 'manager', manageremail: 'manager', managerid: 'manager', hiredate: 'start', startdate: 'start', employeeid: 'id', workertype: 'employment', employmenttype: 'employment' })
  return out
}

const camel = (h, i) => {
  const plain = h.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim()
  const key = plain.replace(/[^A-Za-z0-9]+(.)?/g, (_, ch) => (ch ? ch.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase()).slice(0, 60)
  return key || h.trim().slice(0, 60) || `column${i + 1}`
}

/** A CSV with a header row as a raw Rama document. Unknown columns become details. */
export function csvToDoc(text, title = 'Imported org') {
  const rows = parseCsv(text)
  if (rows.length < 2) throw new Error('A CSV needs a header row and at least one person')
  const aliases = COLUMN_SQUASHED()
  const header = rows[0].map((h, i) => {
    // manager_name, Manager-Name and ManagerName all read as "manager name": Rama's own export comes back in clean.
    const k = squash(h)
    return Object.hasOwn(aliases, k) ? aliases[k] : camel(h, i)
  })
  if (!header.includes('name')) throw new Error('The CSV header has no name column')
  const people = rows.slice(1).map((r) => {
    const p = {}
    header.forEach((k, i) => {
      // Undo the formula guard orgToCsv adds, so +2, a phone number or an @handle comes back as written.
      const v = (r[i] ?? '').trim().replace(/^'(?=[=+\-@])/, '')
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
  const fixed = ['id', 'name', 'email', 'title', 'manager', 'manager_name', 'team', 'location', 'country', 'tz', 'employment', 'status', 'tags', 'start']
  // The 200 most used detail keys: a document with thousands of one-off keys would otherwise make a file of thousands of columns.
  const use = new Map()
  for (const p of model.people) for (const k of Object.keys(p.extra)) if (!CORE_KEYS.includes(k) && !fixed.includes(k)) use.set(k, (use.get(k) || 0) + 1)
  const extras = [...use].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([k]) => k)
  const byId = new Map(model.people.map((p) => [p.id, p]))
  const teamName = new Map(model.teams.map((t) => [t.id, t.name]))
  const cols = [...fixed, ...extras]
  // Header cells pass the same guard as data: a detail key is free text from any document.
  const lines = [cols.map(cell).join(',')]
  for (const p of model.people) {
    const row = { ...p.extra, ...p, email: p.email[0] || '', manager_name: byId.get(p.manager)?.name || '', team: teamName.get(p.team) || '' }
    // Own keys only: a detail named toString must not print a function's source.
    lines.push(cols.map((c) => cell(Object.hasOwn(p.extra, c) && !fixed.includes(c) ? p.extra[c] : Object.hasOwn(row, c) ? row[c] : '')).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/** A Mermaid label: quotes, angle brackets and backticks (a backtick starts a markdown string) become apostrophes. */
const mm = (s) => str(s, 80).replace(/["<>`]/g, "'").replace(/[\r\n]+/g, ' ')
/** Mermaid refuses a diagram over 50,000 characters by default; stop short of it. */
const MERMAID_MAX = 45000

/** The reporting lines as a Mermaid flowchart, for a README or a wiki page. */
export function orgToMermaid(model, limit = 400) {
  const nodes = []
  const ids = new Map()
  let size = 0
  for (const p of model.people.slice(0, limit)) {
    const line = `  p${ids.size}["${mm(p.name)}${p.title ? `<br/><small>${mm(p.title)}</small>` : ''}"]`
    const edge = p.manager ? 30 : 0
    if (size + line.length + edge > MERMAID_MAX) break
    ids.set(p.id, `p${ids.size}`)
    nodes.push(line)
    size += line.length + 1 + edge
  }
  const lines = ['flowchart TB', ...nodes]
  for (const p of model.people) if (ids.has(p.id) && p.manager && ids.has(p.manager)) lines.push(`  ${ids.get(p.manager)} --> ${ids.get(p.id)}`)
  if (model.people.length > ids.size) lines.push(`  %% ${model.people.length - ids.size} more people left out`)
  return lines.join('\n') + '\n'
}

/** vCard text: backslash, comma and semicolon escaped, every line break (CRLF, CR, LF) as \n, other controls dropped. */
const vc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[\u0000-\u001f\u007f]/g, '').replace(/([,;])/g, '\\$1')

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
