// ── Teams ────────────────────────────────────────────────────
// A document's `teams:` (or Floorplan's `groups:`) as a flat list with parent
// ids. The shape is Floorplan's on purpose: name, id, color, owns, members
// with pct, nested groups. A person's `team:` joins them at 100%, and an
// unknown team name creates the team rather than dropping the person.
// Pure: no DOM.

import { slug, safeColor, str } from './core.js'

const MAX_TEAMS = 1000
const MAX_DEPTH = 6
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function normalizeTeams(raw, pending, find, ctx) {
  const teams = []
  const ids = new Set()
  const byKey = new Map()
  const key = (t) => { for (const k of [t.id, slug(t.name), t.name.toLowerCase()]) if (!byKey.has(k)) byKey.set(k, t) }

  const walk = (list, parent, depth) => {
    if (list == null) return
    if (!Array.isArray(list)) { ctx.error('teams: must be a list'); return }
    list.forEach((entry, i) => {
      if (teams.length >= MAX_TEAMS) return
      const t = typeof entry === 'string' ? { name: entry } : entry
      if (!t || typeof t !== 'object' || Array.isArray(t)) { ctx.warn(`teams[${i}] is not a team`); return }
      const name = str(t.name, 120)
      if (!name) { ctx.warn('A team with no name was skipped'); return }
      let id = slug(t.id) || slug(name) || `team-${teams.length + 1}`
      if (ids.has(id)) {
        let n = 2
        while (ids.has(`${id}-${n}`)) n++
        ctx.warn(`Two teams share the id "${id}"; the second is "${id}-${n}"`)
        id = `${id}-${n}`
      }
      ids.add(id)
      const lead = t.lead != null ? find(t.lead) : null
      if (t.lead != null && !lead) ctx.warn(`Team ${name}: lead "${str(t.lead, 80)}" is not in people`)
      const team = {
        id, name, parent, color: safeColor(t.color), lead: lead || '',
        owns: (Array.isArray(t.owns) ? t.owns : []).map((o) => str(o, 80)).filter(Boolean).slice(0, 20),
        notes: str(t.notes, 4000), members: [], floorplan: floorplanKeys(t),
      }
      for (const m of Array.isArray(t.members) ? t.members.slice(0, 500) : []) {
        const { ref, pct } = readMember(m)
        const person = ref != null ? find(ref) : null
        if (!person) { ctx.warn(`Team ${name}: member "${str(ref, 80)}" is not in people`); continue }
        const had = team.members.find((x) => x.person === person)
        if (had) had.pct = pct
        else team.members.push({ person, pct, implied: false })
      }
      teams.push(team)
      key(team)
      const children = t.groups ?? t.teams
      if (children != null && depth + 1 >= MAX_DEPTH) ctx.warn(`Team ${name}: teams nest at most ${MAX_DEPTH} deep`)
      else walk(children, id, depth + 1)
    })
  }
  walk(raw, '', 0)

  for (const { person, team } of pending) {
    if (team == null || team === '') continue
    const ref = str(team, 120)
    let t = byKey.get(ref) || byKey.get(slug(ref)) || byKey.get(ref.toLowerCase())
    if (!t && ref && teams.length < MAX_TEAMS) {
      let id = slug(ref) || `team-${teams.length + 1}`
      while (ids.has(id)) id += '-x'
      ids.add(id)
      t = { id, name: ref, parent: '', color: '', lead: '', owns: [], notes: '', members: [], floorplan: {} }
      teams.push(t)
      key(t)
    }
    if (!t) continue
    person.team = t.id
    if (!t.members.some((m) => m.person === person.id)) t.members.push({ person: person.id, pct: 100, implied: true })
  }
  return teams
}

/** Floorplan's member forms: an id or name, { person, pct }, or { id: pct }. */
function readMember(m) {
  if (typeof m === 'string' || typeof m === 'number') return { ref: String(m), pct: 100 }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ref: null, pct: 100 }
  if (m.person != null) return { ref: m.person, pct: pct(m.pct) }
  const keys = Object.keys(m).filter((k) => !BAD_KEYS.has(k))
  if (keys.length === 1) return { ref: keys[0], pct: pct(m[keys[0]]) }
  return { ref: null, pct: 100 }
}

const pct = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(100, Math.max(1, Math.round(n))) : 100
}

/** The keys only Floorplan draws, carried through untouched for the Floorplan export. */
function floorplanKeys(t) {
  const out = {}
  const cap = Number(t.capacity)
  if (Number.isFinite(cap) && cap > 0) out.capacity = Math.min(200, Math.round(cap))
  if (Array.isArray(t.needs)) out.needs = t.needs.map((n) => str(n, 40)).filter(Boolean).slice(0, 20)
  const l = t.layout
  if (l && typeof l === 'object' && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(Number(l[k])))) {
    out.layout = { x: Number(l.x), y: Number(l.y), w: Number(l.w), h: Number(l.h) }
  }
  return out
}

/** The flat list back to a nested tree. Members a person's `team:` implies are left out. */
export function teamsToDoc(model) {
  const kids = new Map()
  for (const t of model.teams) {
    if (!kids.has(t.parent)) kids.set(t.parent, [])
    kids.get(t.parent).push(t)
  }
  const emit = (t) => {
    const out = { name: t.name }
    if (t.id !== slug(t.name)) out.id = t.id
    if (t.color) out.color = t.color
    if (t.lead) out.lead = t.lead
    if (t.owns.length) out.owns = [...t.owns]
    if (t.notes) out.notes = t.notes
    Object.assign(out, structuredClone(t.floorplan))
    const members = t.members.filter((m) => !m.implied).map((m) => (m.pct === 100 ? m.person : { person: m.person, pct: m.pct }))
    if (members.length) out.members = members
    const children = kids.get(t.id) || []
    if (children.length) out.teams = children.map(emit)
    return out
  }
  return (kids.get('') || []).map(emit)
}
