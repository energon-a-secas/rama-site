// ── The Rama org document ────────────────────────────────────
// normalizeOrg(raw): a parsed YAML/JSON tree -> { model, issues }. The one gate
// in front of every entry point (saved text, #d=, ?src=, a file, a paste, CSV).
// orgToDoc(model): the model back to a canonical tree for export.
// The contract is written out for authors and agents in llms.txt; change one,
// change the other. Pure: no DOM, Node-tested in test/schema.test.mjs.

import { DEFAULT_ROLES, TRACKS, TRACK_COLORS, guessTrack } from './roles.js'
import { slug, safeColor, str, safeUrl, isEmail, editDistance, hash } from './core.js'
import { normalizeTeams, teamsToDoc } from './teams.js'

export const SCHEMA_VERSION = 1
export const MAX_PEOPLE = 5000
const MAX_PROFILE_DEPTH = 32
const MAX_EXTENDS = 20

export const CORE_KEYS = ['id', 'name', 'email', 'role', 'title', 'manager', 'dotted', 'team', 'location',
  'country', 'tz', 'employment', 'status', 'tags', 'photo', 'pronounced', 'notes', 'start', 'extends']
export const MANAGER_ALIASES = ['reportsTo', 'reports_to', 'reportsto', 'reports-to', 'boss', 'managerId', 'manager_id']
export const EMPLOYMENT = ['employee', 'contractor', 'vendor', 'intern']
export const STATUS = ['active', 'open', 'leave', 'incoming']
const EMPLOYMENT_ALIASES = {
  ee: 'employee', fte: 'employee', 'full-time': 'employee', fulltime: 'employee', staff: 'employee', permanent: 'employee',
  contract: 'contractor', consultant: 'contractor', freelance: 'contractor', freelancer: 'contractor',
  'non-ee': 'vendor', nonee: 'vendor', 'nonee/vendor': 'vendor', agency: 'vendor', internship: 'intern',
}
const STATUS_ALIASES = {
  vacancy: 'open', hiring: 'open', 'open role': 'open', backfill: 'open', 'on leave': 'leave', away: 'leave',
  starting: 'incoming', new: 'incoming', 'new hire': 'incoming',
}
export const FIELD_TYPES = ['text', 'url', 'email', 'date', 'tags', 'phone', 'markdown', 'handle']
const TOP_KEYS = new Set(['rama', 'title', 'notes', 'roles', 'fields', 'profiles', 'people', 'teams', 'groups'])
const FLOORPLAN_ONLY = new Set(['mode', 'display', 'bands', 'links', 'history'])
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const KNOWN_KEYS = [...CORE_KEYS, ...MANAGER_ALIASES]

/** Object.entries without the keys that can reach a prototype. */
export const ownEntries = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).filter(([k]) => !BAD_KEYS.has(k)) : [])

export function emptyModel(title = 'Untitled org') {
  return { v: SCHEMA_VERSION, title, notes: '', roles: { ...cloneRoles(DEFAULT_ROLES) }, declaredRoles: [], fields: {}, people: [], teams: [] }
}

const cloneRoles = (roles) => Object.fromEntries(ownEntries(roles).map(([id, r]) => [id, { id, color: '', notes: '', ...r }]))

export function normalizeOrg(input) {
  const issues = []
  const ctx = {
    warn: (msg) => issues.push({ level: 'warn', msg }),
    error: (msg) => issues.push({ level: 'error', msg }),
  }
  let raw = input
  if (Array.isArray(raw)) raw = { people: raw }
  if (!raw || typeof raw !== 'object') {
    return { model: emptyModel(), issues: [{ level: 'error', msg: 'A Rama document is a map with a people: list' }] }
  }
  const version = Number(raw.rama ?? SCHEMA_VERSION)
  if (Number.isFinite(version) && version > SCHEMA_VERSION) ctx.warn(`Written for Rama schema ${version}; this page reads ${SCHEMA_VERSION}, so newer keys are shown as details`)
  const floorplanKeys = Object.keys(raw).filter((k) => FLOORPLAN_ONLY.has(k))
  if (floorplanKeys.length) ctx.warn(`Floorplan-only keys left out: ${floorplanKeys.join(', ')}`)
  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.has(k) && !FLOORPLAN_ONLY.has(k)) ctx.warn(`Unknown top-level key "${k}" ignored`)
  }

  const model = emptyModel(str(raw.title, 120) || 'Untitled org')
  model.notes = str(raw.notes, 8000)
  normalizeRoles(raw.roles, model, ctx)
  model.fields = normalizeFields(raw.fields, ctx)
  const profiles = resolveProfiles(Object.fromEntries(ownEntries(raw.profiles)), ctx)
  ctx.nearMemo = new Map()
  ctx.nearWarned = new Set()
  ctx.applyTeamProfile = (t, who) => applyTeamProfile(t, profiles, ctx, who)

  // Pass 1: people. A map (`people: { ada: {...} }`) reads as a list with ids.
  let list = raw.people
  if (list && typeof list === 'object' && !Array.isArray(list)) list = ownEntries(list).map(([id, p]) => (p && typeof p === 'object' ? { id, ...p } : { id, name: p }))
  if (list != null && !Array.isArray(list)) { ctx.error('people: must be a list'); list = [] }
  list = list || []
  if (list.length > MAX_PEOPLE) ctx.warn(`Only the first ${MAX_PEOPLE} people are read`)
  const taken = new Set()
  const nextSuffix = new Map() // base id -> the next suffix to try, so many duplicates stay linear
  const pending = []
  list.slice(0, MAX_PEOPLE).forEach((entry, i) => {
    const e = typeof entry === 'string' || typeof entry === 'number' ? { name: String(entry) } : entry
    if (!e || typeof e !== 'object' || Array.isArray(e)) { ctx.error(`people[${i}] is not a person`); return }
    const merged = applyProfiles(e, profiles, ctx, e.name ? `"${str(e.name, 80)}"` : `people[${i}]`)
    const person = buildPerson(merged, i, model, ctx)
    if (!person) return
    let id = person.id
    if (taken.has(id)) {
      const base = id.slice(0, 42).replace(/-+$/, '')
      let n = nextSuffix.get(base) || 2
      while (taken.has(`${base}-${n}`)) n++
      nextSuffix.set(base, n + 1)
      ctx.warn(`Two people share the id "${id}"; the second is "${base}-${n}"`)
      id = `${base}-${n}`
      person.id = id
    }
    taken.add(id)
    model.people.push(person)
    pending.push({ person, manager: managerOf(merged), dotted: merged.dotted, team: merged.team })
  })

  // Pass 2: reporting lines, dotted lines and team membership, now every id exists.
  const find = personFinder(model.people)
  for (const { person, manager, dotted } of pending) {
    if (manager != null && manager !== '') {
      const hit = find(manager)
      if (!hit) ctx.warn(`${person.name}: manager "${str(manager, 80)}" is not in people, so they are shown at the top`)
      else if (hit === person.id) ctx.warn(`${person.name} cannot manage themselves`)
      else person.manager = hit
    }
    for (const d of [].concat(dotted ?? []).slice(0, 10)) {
      const hit = find(d)
      if (hit && hit !== person.id && !person.dotted.includes(hit)) person.dotted.push(hit)
      else if (!hit) ctx.warn(`${person.name}: dotted-line "${str(d, 80)}" is not in people`)
    }
  }
  breakCycles(model.people, ctx)

  const rawTeams = raw.teams ?? raw.groups
  model.teams = normalizeTeams(rawTeams, pending, find, ctx)
  return { model, issues }
}

function normalizeRoles(raw, model, ctx) {
  let entries = []
  // A role a slug cannot name (a non-Latin title) gets an id from its own text, never dropped.
  const idOf = (rawId) => slug(rawId) || (str(rawId, 120) ? `r-${hash(str(rawId, 120)).toString(36)}` : '')
  if (Array.isArray(raw)) entries = raw.map((r) => (typeof r === 'string' ? [r, { title: r }] : [r?.id ?? r?.title, r]))
  else if (raw != null) entries = ownEntries(raw)
  if (raw != null && !Array.isArray(raw) && typeof raw !== 'object') { ctx.error('roles: must be a map of id: { title, track, level }'); return }
  for (const [rawId, r] of entries.slice(0, 500)) {
    const id = idOf(rawId)
    if (!id) continue
    const given = typeof r === 'string' ? { title: r } : (r && typeof r === 'object' ? r : {})
    const base = model.roles[id] || {}
    const title = str(given.title, 120) || base.title || id.replace(/-/g, ' ')
    let track = str(given.track, 20).toLowerCase() || base.track || guessTrack(title)
    if (!TRACKS.includes(track)) { ctx.warn(`Role "${id}": track "${track}" is not one of ${TRACKS.join(', ')}`); track = base.track || guessTrack(title) }
    model.roles[id] = { id, title, track, level: str(given.level ?? base.level, 20), color: safeColor(given.color, base.color || ''), notes: str(given.notes, 2000) }
    if (!model.declaredRoles.includes(id)) model.declaredRoles.push(id)
  }
}

function normalizeFields(raw, ctx) {
  const out = {}
  let order = 0
  for (const [key, f] of ownEntries(raw).slice(0, 100)) {
    const def = typeof f === 'string' ? { label: f } : (f && typeof f === 'object' ? f : {})
    let type = str(def.type, 20).toLowerCase() || 'text'
    if (!FIELD_TYPES.includes(type)) { ctx.warn(`Field "${key}": type "${type}" is not one of ${FIELD_TYPES.join(', ')}`); type = 'text' }
    out[key] = { label: str(def.label, 60) || key, type, prefix: safeUrl(def.prefix), hidden: def.hidden === true, order: order++ }
  }
  return out
}

/**
 * Every profile resolved once, in the order the document declares them, before
 * any person reads one. Resolving on demand made a cycle come out differently
 * depending on who extended it first, and a diamond of shared parents was
 * exponential. Chains stop at 32 deep, so a long chain warns instead of
 * overflowing the stack.
 */
function resolveProfiles(raw, ctx) {
  const done = new Map()
  const resolve = (name, stack) => {
    if (done.has(name)) return done.get(name)
    const p = Object.hasOwn(raw, name) ? raw[name] : null
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null
    if (stack.includes(name)) { ctx.warn(`Profile cycle: ${[...stack, name].join(' > ')}`); return {} }
    if (stack.length >= MAX_PROFILE_DEPTH) { ctx.warn(`Profiles extend each other more than ${MAX_PROFILE_DEPTH} deep; "${name}" is read without its parents`); return {} }
    const parents = [].concat(p.extends ?? []).map((n) => str(n, 60)).filter(Boolean)
    if (parents.length > MAX_EXTENDS) ctx.warn(`Profile "${name}" extends ${parents.length} profiles; the first ${MAX_EXTENDS} are read`)
    let merged = {}
    for (const parent of parents.slice(0, MAX_EXTENDS)) {
      const r = resolve(parent, [...stack, name])
      if (r) merged = mergeProfile(merged, r)
      else ctx.warn(`Profile "${name}" extends unknown profile "${parent}"`)
    }
    merged = mergeProfile(merged, p)
    done.set(name, merged)
    return merged
  }
  for (const name of Object.keys(raw)) resolve(name, [])
  return done
}

/** A person's profiles, applied left to right; the person's own keys win. */
function applyProfiles(entry, profiles, ctx, who) {
  const names = [].concat(entry.extends ?? []).map((n) => str(n, 60)).filter(Boolean)
  if (!names.length) return entry
  if (names.length > MAX_EXTENDS) ctx.warn(`${who} extends ${names.length} profiles; the first ${MAX_EXTENDS} are read`)
  let base = {}
  for (const n of names.slice(0, MAX_EXTENDS)) {
    if (profiles.has(n)) base = mergeProfile(base, profiles.get(n))
    else ctx.warn(`${who} extends unknown profile "${n}"`)
  }
  return mergeProfile(base, entry)
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

/** Floorplan's rule for a group: scalars override, `members` and `owns` add up. */
function applyTeamProfile(t, profiles, ctx, who) {
  if (!t || typeof t !== 'object' || Array.isArray(t) || t.extends == null) return t
  const base = applyProfiles({ extends: t.extends }, profiles, ctx, who)
  const out = mergeProfile(base, t)
  out.owns = [...new Set([...asList(base.owns), ...asList(t.owns)])]
  out.members = [...asList(base.members), ...asList(t.members)]
  return out
}

const asTags = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : null)

function mergeProfile(a, b) {
  const out = { ...a }
  for (const [k, v] of ownEntries(b)) {
    if (k === 'extends') continue
    const both = k === 'tags' && asTags(out.tags) && asTags(v)
    out[k] = both ? [...new Set([...asTags(out.tags), ...asTags(v)])] : v
  }
  return out
}

const managerOf = (e) => {
  if (e.manager != null) return e.manager
  for (const k of MANAGER_ALIASES) if (e[k] != null) return e[k]
  return null
}

/** Resolve a person reference: id, slug of a name, a name, or an email. */
export function personFinder(people) {
  const byKey = new Map()
  const add = (k, id) => { if (k && !byKey.has(k)) byKey.set(k, id) }
  for (const p of people) add(p.id, p.id)
  for (const p of people) { add(slug(p.name), p.id); add(p.name.toLowerCase(), p.id); for (const e of p.email) add(e, p.id) }
  return (ref) => {
    const s = str(ref, 200)
    if (!s) return null
    return byKey.get(s) || byKey.get(s.toLowerCase()) || byKey.get(slug(s)) || null
  }
}

function findRole(roles, raw) {
  const id = slug(raw)
  if (Object.hasOwn(roles, raw)) return raw
  if (id && Object.hasOwn(roles, id)) return id
  const lower = raw.toLowerCase()
  return Object.values(roles).find((r) => r.title.toLowerCase() === lower)?.id || ''
}

function norm(value, known, aliases, fallback, label, who, ctx) {
  const s = str(value, 40).toLowerCase()
  if (!s) return fallback
  if (known.includes(s)) return s
  if (Object.hasOwn(aliases, s)) return aliases[s]
  ctx.warn(`${who}: ${label} "${s}" is not one of ${known.join(', ')}`)
  return fallback
}

const TEXT_KEYS = ['name', 'role', 'title', 'location', 'country', 'tz', 'employment', 'status', 'photo', 'pronounced', 'notes', 'start']

/** A real zone, by asking Intl when there is one; offsets like +2 and -3:30 by shape. Memoized: 5000 people share a handful of zones, and each Intl formatter costs tens of microseconds. */
const zoneMemo = new Map()
function validZone(tz) {
  if (zoneMemo.has(tz)) return zoneMemo.get(tz)
  let ok
  if (/^[+-]\d{1,2}(:\d{2})?$/.test(tz) || tz === 'UTC') ok = true
  else if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(tz)) ok = false
  else { try { new Intl.DateTimeFormat('en', { timeZone: tz }); ok = true } catch { ok = false } }
  if (zoneMemo.size < 2000) zoneMemo.set(tz, ok)
  return ok
}

/** YYYY-MM-DD and a day that exists: 2024-02-30 is not a date. */
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function buildPerson(e, i, model, ctx) {
  const who = e.name ? str(e.name, 80) : `people[${i}]`
  for (const k of TEXT_KEYS) {
    if (e[k] != null && typeof e[k] === 'object' && !(e[k] instanceof Date)) ctx.warn(`${who}: ${k} should be text, not a ${Array.isArray(e[k]) ? 'list' : 'map'}, so it was left out`)
  }
  const status = norm(e.status, STATUS, STATUS_ALIASES, 'active', 'status', who, ctx)
  const roleRaw = str(e.role, 120)
  let title = str(e.title, 120)
  let role = ''
  if (roleRaw) {
    role = findRole(model.roles, roleRaw)
    if (!role && !title) title = roleRaw
  }
  if (!title && role) title = model.roles[role].title
  let name = str(e.name, 120)
  if (!name && status === 'open') name = 'Open role'
  if (!name) { ctx.error(`people[${i}] has no name`); return null }
  // A name with no Latin letters still gets a stable id from its own text, never its position.
  const id = slug(e.id) || (status === 'open' ? slug(`open-${title || 'role'}-${i + 1}`) : slug(name)) || `p-${hash(name).toString(36)}`

  const email = [...new Set([].concat(e.email ?? []).map((x) => str(x, 254).toLowerCase()).filter(Boolean))]
  const goodEmail = email.filter(isEmail)
  if (goodEmail.length < email.length) ctx.warn(`${who}: "${email.find((x) => !isEmail(x))}" is not an email address`)

  // The whole value is checked before anything is cut: "Chile" must not become CH.
  let country = str(e.country, 40).toUpperCase()
  if (e.country != null && e.country !== '' && !/^[A-Z]{2}$/.test(country)) { ctx.warn(`${who}: country "${str(e.country, 40)}" should be a two-letter code (CL, US, DE)`); country = '' }
  let tz = str(e.tz, 60)
  if (tz && !validZone(tz)) { ctx.warn(`${who}: tz "${tz}" is not an IANA zone (America/Santiago) or an offset (+2)`); tz = '' }
  const photo = safeUrl(e.photo)
  if (e.photo && !photo) ctx.warn(`${who}: photo must be an https:// URL`)
  const start = validDate(dateStr(e.start)) ? dateStr(e.start) : ''
  if (e.start != null && e.start !== '' && !start) ctx.warn(`${who}: start "${str(dateStr(e.start), 40)}" is not a date written YYYY-MM-DD`)
  const employment = norm(e.employment, EMPLOYMENT, EMPLOYMENT_ALIASES, 'employee', 'employment', who, ctx)

  const person = {
    id, name, email: goodEmail, role, title, track: role ? model.roles[role].track : guessTrack(title),
    manager: '', dotted: [], team: '', location: str(e.location, 120), country, tz,
    employment, status, tags: tagList(e.tags), photo, pronounced: str(e.pronounced, 120),
    notes: str(e.notes, 4000), start, extra: {},
  }
  for (const [rawKey, v] of ownEntries(e)) {
    // The key is cleaned before any check: " name" and " __proto__" are name and __proto__.
    const k = str(rawKey, 60)
    if (!k || BAD_KEYS.has(k) || KNOWN_KEYS.includes(k)) continue
    const value = extraValue(v)
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue
    person.extra[k] = value
    if (!Object.hasOwn(model.fields, k) && k.length > 3) {
      if (!ctx.nearMemo.has(k)) ctx.nearMemo.set(k, KNOWN_KEYS.find((c) => editDistance(k.toLowerCase(), c.toLowerCase(), 2) <= 2) || '')
      const near = ctx.nearMemo.get(k)
      // Once per key: a typo in a 5000-row import is one warning, not 5000.
      if (near && !ctx.nearWarned.has(k)) { ctx.nearWarned.add(k); ctx.warn(`${who}: "${k}" is kept as a detail. Did you mean "${near}"?`) }
    }
  }
  return person
}

const dateStr = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : str(v, 10))

function tagList(v) {
  const list = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[,;|]/) : [])
  return [...new Set(list.map((t) => str(t, 40)).filter(Boolean))].slice(0, 40)
}

/** An extra detail: a string, a list of strings, or a flat map of strings. Nothing deeper survives. */
function extraValue(v) {
  if (v == null) return null
  if (v instanceof Date) return dateStr(v)
  if (typeof v !== 'object') return str(v, 2000)
  if (Array.isArray(v)) return v.slice(0, 50).filter((x) => x != null && typeof x !== 'object').map((x) => str(x, 200)).filter(Boolean)
  const out = {}
  for (const [k, x] of ownEntries(v).slice(0, 30)) if (x != null && typeof x !== 'object') out[str(k, 60)] = str(x, 500)
  return Object.keys(out).length ? out : null
}

/** A reporting line that loops back is cut where the walk first meets it again. */
function breakCycles(people, ctx) {
  const byId = new Map(people.map((p) => [p.id, p]))
  const done = new Set()
  for (const start of people) {
    const path = new Set()
    let p = start
    while (p && !done.has(p.id)) {
      if (path.has(p.id)) {
        ctx.warn(`Reporting loop through ${p.name}; their manager line was cut so the chart has a top`)
        p.manager = ''
        break
      }
      path.add(p.id)
      p = p.manager ? byId.get(p.manager) : null
    }
    for (const id of path) done.add(id)
  }
}

// ── Back to a document ───────────────────────────────────────

/** The model as a canonical tree: defaults left out, profiles already applied. */
export function orgToDoc(model) {
  const doc = { rama: SCHEMA_VERSION, title: model.title }
  if (model.notes) doc.notes = model.notes
  if (model.declaredRoles.length) {
    doc.roles = Object.fromEntries(model.declaredRoles.map((id) => {
      const r = model.roles[id]
      const out = { title: r.title, track: r.track }
      // A level cleared on purpose ('') has to survive, or a built-in's level comes back on re-import.
      if (r.level || r.level !== (DEFAULT_ROLES[id]?.level ?? '')) out.level = r.level
      if (r.color) out.color = r.color
      if (r.notes) out.notes = r.notes
      return [id, out]
    }))
  }
  if (Object.keys(model.fields).length) {
    doc.fields = Object.fromEntries(Object.entries(model.fields).map(([k, f]) => {
      const out = { label: f.label }
      if (f.type !== 'text') out.type = f.type
      if (f.prefix) out.prefix = f.prefix
      if (f.hidden) out.hidden = true
      return [k, out]
    }))
  }
  doc.people = model.people.map((p) => personToDoc(p, model))
  const teams = teamsToDoc(model)
  if (teams.length) doc.teams = teams
  return doc
}

function personToDoc(p, model) {
  const out = { name: p.name }
  // An open role's id is never derived from its name ("Open role"), so it always travels.
  if (p.id !== slug(p.name) || p.status === 'open') out.id = p.id
  if (p.email.length) out.email = p.email.length === 1 ? p.email[0] : [...p.email]
  if (p.role) {
    out.role = p.role
    if (p.title && p.title !== model.roles[p.role]?.title) out.title = p.title
  } else if (p.title) out.title = p.title // as title, never role: a role is matched against the catalogue on the way back in
  if (p.manager) out.manager = p.manager
  if (p.dotted.length) out.dotted = [...p.dotted]
  if (p.team) out.team = p.team
  for (const k of ['location', 'country', 'tz']) if (p[k]) out[k] = p[k]
  if (p.employment !== 'employee') out.employment = p.employment
  if (p.status !== 'active') out.status = p.status
  if (p.tags.length) out.tags = [...p.tags]
  for (const k of ['photo', 'pronounced', 'start', 'notes']) if (p[k]) out[k] = p[k]
  for (const [k, v] of Object.entries(p.extra)) out[k] = Array.isArray(v) ? [...v] : (typeof v === 'object' ? { ...v } : v)
  return out
}

/** A role's colour: its own, else its track's. */
export const roleColor = (model, p) => safeColor(model.roles[p.role]?.color, TRACK_COLORS[p.track] || TRACK_COLORS.ic)
