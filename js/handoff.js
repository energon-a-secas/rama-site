// ── Handing an org to other Neorgon tools ────────────────────
// Rama owns the org; Floorplan and Reparto each read one slice of it through
// the link contract they already publish, so neither site changes:
//   Floorplan: https://floorplan.neorgon.com/#d=<base64url YAML>  (llms.txt there)
//   Reparto:   https://reparto.neorgon.com/#p=<base64url JSON>
// These build the documents; yaml.js turns the Floorplan one into text.
// Pure: no DOM.

import { slug, toBase64Url } from './core.js'
import { ORG_ROOT, isExternal } from './tree.js'

export const FLOORPLAN_URL = 'https://floorplan.neorgon.com/'
export const REPARTO_URL = 'https://reparto.neorgon.com/'
/** Floorplan refuses a #d= payload over this; past it, hand over the file instead. */
export const FLOORPLAN_LINK_MAX = 32000
const NEST_LIMIT = 3

/** Everyone at or under id, top first; the virtual org root is never a person. */
export function scopeOf(ix, id) {
  const out = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()
    if (cur !== ORG_ROOT) out.push(cur)
    stack.push(...[...ix.kids(cur)].reverse())
  }
  return out
}

/** Every id is written out: Floorplan slugs names its own way (NFD, not NFKD), so an id left to it can land on someone else. */
const floorplanPerson = (p) => {
  const out = { name: p.name, id: p.id }
  if (p.title) out.role = p.title
  if (p.location) out.location = p.location
  if (p.tz) out.tz = p.tz
  if (p.tags.length) out.tags = [...p.tags]
  if (typeof p.extra.avatar === 'string') out.avatar = p.extra.avatar
  return out
}

const known = (ix, id) => {
  if (!ix.has(id)) throw new Error(`No one with the id "${id}" is in this org`)
}

/**
 * A Floorplan document for everyone at or under scopeId. A manager who leads
 * a team hands over as that team (teams already have Floorplan's shape, splits
 * included); every other manager becomes a group holding them and their
 * reports, nested along the reporting line down to three levels, below which
 * a subtree folds into its group. Anyone left over sits in Floorplan's roster.
 */
export function toFloorplanDoc(ix, scopeId = ix.top, { today = new Date().toISOString().slice(0, 10) } = {}) {
  known(ix, scopeId)
  const scope = scopeOf(ix, scopeId)
  const inScope = new Set(scope)
  const head = ix.byId.get(scopeId)
  const whole = scopeId === ix.top
  const { groups, usedTeams } = buildGroups(ix, scopeId, inScope)
  const doc = {
    title: whole ? ix.model.title : `${head.name}'s org`,
    notes: `Exported from Rama on ${today}: ${scope.length} ${scope.length === 1 ? 'person' : 'people'}${whole ? '' : ` at or under ${head.name}`}. ` +
      (usedTeams ? 'A manager who leads a team became that team; every other manager became a group with their reports.' : 'Each manager became a group with their reports.'),
    mode: 'diagram',
    people: scope.map((id) => floorplanPerson(ix.byId.get(id))),
  }
  if (groups.length) doc.groups = groups
  return doc
}

function buildGroups(ix, scopeId, inScope) {
  const teams = ix.model.teams
  const teamKids = new Map()
  for (const t of teams) {
    if (!teamKids.has(t.parent)) teamKids.set(t.parent, [])
    teamKids.get(t.parent).push(t)
  }
  // The top-most teams each person leads: a sub-team with the same lead as its parent travels inside the parent.
  const led = new Map()
  for (const t of teams) {
    if (!t.lead || !inScope.has(t.lead)) continue
    if (ix.teamById.get(t.parent)?.lead === t.lead) continue
    if (!led.has(t.lead)) led.set(t.lead, [])
    led.get(t.lead).push(t)
  }
  const isLeader = (id) => led.has(id) && !ix.byId.get(id).virtual
  const hasReports = (id) => ix.kids(id).length > 0
  // A lone person with no reports and no team is not a room.
  if (!hasReports(scopeId) && !isLeader(scopeId)) return { groups: [], usedTeams: false }
  // A subtree folded below the third level still hands its teams over: they bring their own shape.
  const leadersIn = (id) => scopeOf(ix, id).filter(isLeader)

  // Pass 1: which teams will be handed over, and so who they already seat.
  const emitted = new Set()
  const walk = (id, depth) => {
    if (isLeader(id)) {
      const mark = (t) => { if (!emitted.has(t.id)) { emitted.add(t.id); (teamKids.get(t.id) || []).forEach(mark) } }
      led.get(id).forEach(mark)
    }
    for (const r of ix.kids(id)) {
      if (isLeader(r) || (hasReports(r) && depth + 1 < NEST_LIMIT)) walk(r, depth + 1)
      else if (hasReports(r)) leadersIn(r).forEach((l) => walk(l, NEST_LIMIT))
    }
  }
  const virtualTop = ix.byId.get(scopeId).virtual
  walk(scopeId, virtualTop ? -1 : 0)
  const seatedByTeams = new Set()
  for (const t of teams) if (emitted.has(t.id)) for (const m of t.members) if (inScope.has(m.person)) seatedByTeams.add(m.person)
  const free = (id) => !seatedByTeams.has(id)

  // Pass 2: the groups, in reporting order.
  const done = new Set()
  const team = (t) => {
    if (done.has(t.id)) return null
    done.add(t.id)
    const g = { name: t.name }
    if (t.id !== slug(t.name)) g.id = t.id
    if (t.color) g.color = t.color
    if (t.owns.length) g.owns = [...t.owns]
    Object.assign(g, structuredClone(t.floorplan))
    const members = t.members.filter((m) => inScope.has(m.person)).map((m) => (m.pct === 100 ? m.person : { person: m.person, pct: m.pct }))
    if (members.length) g.members = members
    const sub = (teamKids.get(t.id) || []).map(team).filter(Boolean)
    if (sub.length) g.groups = sub
    return members.length || sub.length ? g : null
  }
  const line = (id, depth) => {
    const p = ix.byId.get(id)
    const out = []
    const members = []
    const sub = []
    if (isLeader(id)) out.push(...led.get(id).map(team).filter(Boolean))
    else if (!p.virtual && free(id)) members.push(id)
    for (const r of ix.kids(id)) {
      if (isLeader(r) || (hasReports(r) && depth + 1 < NEST_LIMIT)) sub.push(...line(r, depth + 1))
      else if (hasReports(r)) {
        members.push(...scopeOf(ix, r).filter(free))
        sub.push(...leadersIn(r).flatMap((l) => led.get(l).map(team).filter(Boolean)))
      }
      else if (free(r)) members.push(r)
    }
    if (isLeader(id)) {
      // A team lead's reports who are on none of the teams still need a room, beside the team.
      if (free(id)) members.unshift(id)
      if (members.length) out.push({ name: `${p.name}'s other reports`, members })
      return [...out, ...sub]
    }
    if (p.virtual) return [...sub, ...(members.length ? [{ name: 'Reports to nobody', members }] : [])]
    const g = { name: `${p.name}'s team` }
    if (members.length) g.members = members
    if (sub.length) g.groups = sub
    return members.length || sub.length ? [g] : []
  }
  const groups = line(scopeId, virtualTop ? -1 : 0)
  return { groups, usedTeams: emitted.size > 0 }
}

/** Reparto's own limits: 400 people a plan, ids of [A-Za-z0-9_-] up to 40 characters. */
export const REPARTO_MAX = 400
const REPARTO_ID = 40

/**
 * A Reparto plan for one manager's team: their direct reports. A person with
 * no reports hands over the team they sit in (their manager's). Open roles
 * arrive as Reparto's open seats; areas the team owns arrive as unestimated
 * deliverables, which is exactly what Reparto flags for the planner. Past
 * Reparto's cap the rest are left out and counted in `dropped`.
 */
export function toRepartoDoc(ix, personId) {
  known(ix, personId)
  let lead = personId
  if (!ix.kids(lead).length) lead = ix.parentOf(lead) || lead
  const head = ix.byId.get(lead)
  const all = (ix.kids(lead).length ? ix.kids(lead) : [lead]).filter((id) => !ix.byId.get(id).virtual)
  const team = all.slice(0, REPARTO_MAX)
  const used = new Set()
  const shortId = (id) => {
    const base = id.slice(0, REPARTO_ID).replace(/-+$/, '') || 'p'
    let out = base
    for (let n = 2; used.has(out); n++) out = `${base.slice(0, REPARTO_ID - String(n).length - 1)}-${n}`
    used.add(out)
    return out
  }
  const people = team.map((id) => {
    const p = ix.byId.get(id)
    const out = { id: shortId(p.id), name: p.name, role: p.title || (isExternal(p) ? 'Contractor' : '') }
    if (p.country) out.country = p.country
    if (p.status === 'open') out.open = true
    return out
  })
  const countries = [...new Set(people.map((p) => p.country).filter(Boolean))]
  const owned = ix.model.teams.filter((t) => t.lead === lead || (head.team && t.id === head.team)).flatMap((t) => t.owns)
  const deliverables = [...new Set(owned)].map((name, i) => ({ id: `d-${i + 1}`, name, estimate: null, members: [] }))
  const plan = {
    title: head.virtual ? `${head.name} top level` : `${head.name}'s team`,
    people,
    deliverables,
  }
  if (countries.length) plan.settings = { countries }
  return { plan, lead, dropped: all.length - team.length }
}

export const floorplanLink = (yamlText) => {
  const payload = toBase64Url(yamlText)
  return payload.length > FLOORPLAN_LINK_MAX ? null : `${FLOORPLAN_URL}#d=${payload}`
}

export const repartoLink = (plan) => `${REPARTO_URL}#p=${toBase64Url(JSON.stringify(plan))}`
