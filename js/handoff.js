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

const floorplanPerson = (p) => {
  const out = { name: p.name }
  if (p.id !== slug(p.name)) out.id = p.id
  if (p.title) out.role = p.title
  if (p.location) out.location = p.location
  if (p.tz) out.tz = p.tz
  if (p.tags.length) out.tags = [...p.tags]
  if (typeof p.extra.avatar === 'string') out.avatar = p.extra.avatar
  return out
}

/**
 * A Floorplan document for everyone at or under scopeId. With teams, the
 * teams become Floorplan groups (they share the shape). Without, each manager
 * becomes a group holding them and their reports, nested along the reporting
 * line down to three levels, below which a subtree folds into its group.
 */
export function toFloorplanDoc(ix, scopeId = ix.top, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const scope = scopeOf(ix, scopeId)
  const inScope = new Set(scope)
  const head = ix.byId.get(scopeId)
  const whole = scopeId === ix.top
  const doc = {
    title: whole ? ix.model.title : `${head.name}'s org`,
    notes: `Exported from Rama on ${today}: ${scope.length} ${scope.length === 1 ? 'person' : 'people'}${whole ? '' : ` at or under ${head.name}`}. ` +
      (ix.model.teams.length ? 'Teams became groups.' : 'Each manager became a group with their reports.'),
    mode: 'diagram',
    people: scope.map((id) => floorplanPerson(ix.byId.get(id))),
  }
  const groups = ix.model.teams.some((t) => t.members.some((m) => inScope.has(m.person)))
    ? groupsFromTeams(ix, inScope)
    : groupsFromLines(ix, scopeId)
  if (groups.length) doc.groups = groups
  return doc
}

function groupsFromTeams(ix, inScope) {
  const kids = new Map()
  for (const t of ix.model.teams) {
    if (!kids.has(t.parent)) kids.set(t.parent, [])
    kids.get(t.parent).push(t)
  }
  const emit = (t) => {
    const g = { name: t.name }
    if (t.id !== slug(t.name)) g.id = t.id
    if (t.color) g.color = t.color
    if (t.owns.length) g.owns = [...t.owns]
    Object.assign(g, structuredClone(t.floorplan))
    const members = t.members.filter((m) => inScope.has(m.person)).map((m) => (m.pct === 100 ? m.person : { person: m.person, pct: m.pct }))
    if (members.length) g.members = members
    const sub = (kids.get(t.id) || []).map(emit).filter(Boolean)
    if (sub.length) g.groups = sub
    return members.length || sub.length ? g : null
  }
  return (kids.get('') || []).map(emit).filter(Boolean)
}

function groupsFromLines(ix, scopeId) {
  const group = (id, depth) => {
    const p = ix.byId.get(id)
    const reports = ix.kids(id)
    const g = { name: p.virtual ? p.name : `${p.name}'s team` }
    if (p.virtual) g.id = slug(p.name) || 'org'
    const members = p.virtual ? [] : [id]
    const sub = []
    for (const r of reports) {
      if (!ix.kids(r).length) members.push(r)
      else if (depth + 1 >= NEST_LIMIT) members.push(...scopeOf(ix, r))
      else sub.push(group(r, depth + 1))
    }
    if (members.length) g.members = members
    if (sub.length) g.groups = sub
    return g
  }
  if (!ix.kids(scopeId).length) return []
  const top = group(scopeId, 0)
  // A virtual top is the org itself, not a room: its sub-groups stand at the top.
  if (ix.byId.get(scopeId).virtual) return [...(top.groups || []), ...(top.members ? [{ name: 'Reports to nobody', members: top.members }] : [])]
  return [top]
}

/**
 * A Reparto plan for one manager's team: their direct reports. A person with
 * no reports hands over the team they sit in (their manager's). Open roles
 * arrive as Reparto's open seats; areas the team owns arrive as unestimated
 * deliverables, which is exactly what Reparto flags for the planner.
 */
export function toRepartoDoc(ix, personId) {
  let lead = personId
  if (!ix.kids(lead).length) lead = ix.parentOf(lead) || lead
  const head = ix.byId.get(lead)
  const team = ix.kids(lead).length ? ix.kids(lead) : [lead]
  const people = team.map((id) => {
    const p = ix.byId.get(id)
    const out = { id: p.id, name: p.name, role: p.title || (isExternal(p) ? 'Contractor' : '') }
    if (p.country) out.country = p.country
    if (p.status === 'open') out.open = true
    return out
  })
  const countries = [...new Set(people.map((p) => p.country).filter(Boolean))]
  const owned = ix.model.teams.filter((t) => t.lead === lead || t.id === head.team).flatMap((t) => t.owns)
  const deliverables = [...new Set(owned)].map((name, i) => ({ id: `d-${i + 1}`, name, estimate: null, members: [] }))
  const plan = {
    title: head.virtual ? `${head.name} top level` : `${head.name}'s team`,
    people,
    deliverables,
  }
  if (countries.length) plan.settings = { countries }
  return { plan, lead }
}

export const floorplanLink = (yamlText) => {
  const payload = toBase64Url(yamlText)
  return payload.length > FLOORPLAN_LINK_MAX ? null : `${FLOORPLAN_URL}#d=${payload}`
}

export const repartoLink = (plan) => `${REPARTO_URL}#p=${toBase64Url(JSON.stringify(plan))}`
