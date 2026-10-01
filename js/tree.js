// ── The reporting tree ───────────────────────────────────────
// indexOrg(model) turns the people list into the lookups every view needs:
// children, the chain up to the top, org size under each person, teams per
// person, and the whole-org numbers. More than one person without a manager
// gets a virtual top named after the org, so every chart has one root.
// Pure: no DOM.

import { slug } from './core.js'

export const ORG_ROOT = '__org'

export function indexOrg(model) {
  const byId = new Map(model.people.map((p) => [p.id, p]))
  const children = new Map()
  const roots = []
  for (const p of model.people) {
    const parent = p.manager && byId.has(p.manager) ? p.manager : ''
    if (!parent) { roots.push(p.id); continue }
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(p.id)
  }
  const virtual = roots.length !== 1
  const top = virtual ? ORG_ROOT : roots[0]
  if (virtual) {
    children.set(ORG_ROOT, roots)
    byId.set(ORG_ROOT, {
      id: ORG_ROOT, name: model.title || 'Organization', title: roots.length ? `${roots.length} people at the top` : 'No people yet',
      virtual: true, email: [], role: '', track: 'exec', manager: '', dotted: [], team: '', location: '', country: '', tz: '',
      employment: 'employee', status: 'active', tags: [], photo: '', pronounced: '', notes: model.notes || '', start: '', extra: {},
    })
  }
  const parentOf = (id) => {
    const p = byId.get(id)
    if (!p || id === top) return null
    return p.manager && byId.has(p.manager) ? p.manager : (virtual ? ORG_ROOT : null)
  }

  // Depth and org size, iteratively: a 5000-deep chain would overflow a recursive walk.
  const depth = new Map([[top, 0]])
  const order = [top]
  for (let i = 0; i < order.length; i++) {
    for (const c of children.get(order[i]) || []) { depth.set(c, depth.get(order[i]) + 1); order.push(c) }
  }
  const size = new Map()
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    size.set(id, (children.get(id) || []).reduce((n, c) => n + 1 + size.get(c), 0))
  }

  const teamsOf = new Map()
  const teamById = new Map(model.teams.map((t) => [t.id, t]))
  for (const t of model.teams) {
    for (const m of t.members) {
      if (!teamsOf.has(m.person)) teamsOf.set(m.person, [])
      teamsOf.get(m.person).push({ team: t.id, pct: m.pct })
    }
  }

  const ix = {
    model, byId, children, roots, top, virtual, depth, size, order, teamById, teamsOf, parentOf,
    kids: (id) => children.get(id) || [],
    chain(id) {
      const out = []
      let cur = byId.has(id) ? id : null
      while (cur) { out.unshift(cur); cur = parentOf(cur) }
      return out
    },
    /** The first person below `top` on the way to id: the division they sit in. */
    branchOf(id) {
      const c = ix.chain(id)
      return c.length > 1 ? c[1] : c[0]
    },
    has: (id) => byId.has(id),
  }
  ix.stats = orgStats(model, ix)
  return ix
}

function orgStats(model, ix) {
  const managers = model.people.filter((p) => ix.kids(p.id).length)
  const spans = managers.map((p) => ix.kids(p.id).length).sort((a, b) => a - b)
  const median = spans.length ? (spans.length % 2 ? spans[(spans.length - 1) / 2] : (spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2) : 0
  const countries = new Set(model.people.map((p) => p.country).filter(Boolean))
  let deepest = 0
  for (const d of ix.depth.values()) deepest = Math.max(deepest, d)
  return {
    people: model.people.filter((p) => p.status !== 'open').length,
    open: model.people.filter((p) => p.status === 'open').length,
    external: model.people.filter((p) => isExternal(p)).length,
    managers: managers.length,
    medianSpan: median,
    widestSpan: spans.length ? spans[spans.length - 1] : 0,
    levels: deepest + (ix.virtual ? 0 : 1),
    countries: countries.size,
    teams: model.teams.length,
  }
}

export const isExternal = (p) => p.employment === 'contractor' || p.employment === 'vendor'

/** Search people by name, title, team, tags, location or email; best matches first. */
export function searchPeople(ix, query, limit = 12) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const qs = slug(q)
  const scored = []
  for (const p of ix.model.people) {
    const name = p.name.toLowerCase()
    let score = 0
    if (name === q) score = 100
    else if (name.startsWith(q)) score = 80
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 70
    else if (name.includes(q)) score = 60
    else if (p.email.some((e) => e.startsWith(q))) score = 55
    else if (p.title.toLowerCase().includes(q)) score = 40
    else if ((ix.teamsOf.get(p.id) || []).some(({ team }) => ix.teamById.get(team)?.name.toLowerCase().includes(q))) score = 35
    else if (p.tags.some((t) => t.toLowerCase().includes(q) || slug(t) === qs)) score = 30
    else if (p.location.toLowerCase().includes(q) || p.country.toLowerCase() === q) score = 20
    if (score) scored.push({ id: p.id, score: score - Math.min(10, ix.depth.get(p.id) || 0) * 0.1 })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.id)
}

/**
 * What the chart shows around one person: the chain above their manager, the
 * manager, the manager's reports in a row (the person among them), and under
 * each of those their own reports, split into people, contractors and open roles.
 */
export function focusView(ix, focusId) {
  const focus = ix.has(focusId) ? focusId : ix.top
  const parent = focus === ix.top ? ix.top : ix.parentOf(focus)
  const row = ix.kids(parent)
  return {
    focus,
    parent,
    chain: ix.chain(parent).slice(0, -1),
    row,
    columns: row.map((id) => splitReports(ix, ix.kids(id))),
    path: new Set(ix.chain(focus)),
  }
}

export function splitReports(ix, ids) {
  const out = { people: [], external: [], open: [] }
  for (const id of ids) {
    const p = ix.byId.get(id)
    if (p.status === 'open') out.open.push(id)
    else if (isExternal(p)) out.external.push(id)
    else out.people.push(id)
  }
  return out
}
