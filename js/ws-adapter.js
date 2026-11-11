// ── Rama and the Neorgon Workspace ───────────────────────────
// The adapter between Rama's org model and the workspace's Schema v1
// (packages/neorgon-ui/workspace/README.md). Rama writes people and teams to
// the workspace and reads back two things: the visitor's settings (zone,
// working hours and days, time format) and which workspace person is "me".
// Pure: no DOM, so the Node tests feed its payloads to the kit's real
// normalizeWorkspace and previewMerge.
//
// Ids: every person and team Rama saves carries Rama's own id with the tool's
// prefix (`rama-ana-rojas`, `rama-team-payments`, `rama-line-ana-rojas`), so a
// second save matches by id and adds nobody, and another tool's ids never
// collide with Rama's. The workspace caps an id at 48 characters; a longer
// one keeps its head and gains a hash of the whole, so it stays stable.

import { slug, hash } from './core.js'
import { ORG_ROOT } from './tree.js'

export const TOOL = 'rama'
const ID_MAX = 48
const PEOPLE_MAX = 500
const TEAMS_MAX = 100
const AVATAR = /^neoav1:[A-Za-z0-9_-]{1,393}$/

/** A Rama id as a workspace id: `rama-` + the id, shortened with a hash past 48 characters. */
export function wsId(id, kind = '') {
  const prefix = `${TOOL}-${kind ? `${kind}-` : ''}`
  const whole = prefix + id
  if (whole.length <= ID_MAX) return whole
  const tail = `-${hash(id).toString(36)}`
  return (prefix + id.slice(0, ID_MAX - prefix.length - tail.length)).replace(/-+$/, '') + tail
}

/** Who is in a scope: a manager and their direct reports, or the whole org. Never the virtual top or an open seat. */
export function scopePeople(ix, scope) {
  const real = (id) => {
    const p = ix.byId.get(id)
    return p && !p.virtual && p.status !== 'open'
  }
  if (scope === 'org') return ix.model.people.filter((p) => p.status !== 'open').map((p) => p.id)
  if (!real(scope)) return []
  return [scope, ...ix.kids(scope).filter(real)]
}

/** Can this person's team be saved: a real person with at least one report who is not an open seat. */
export function hasTeam(ix, id) {
  return scopePeople(ix, id).length > 1
}

function personOut(p, ids) {
  const out = { id: ids.get(p.id), name: p.name }
  if (p.title) out.title = p.title
  if (p.email[0]) out.email = p.email[0]
  if (p.tz) out.tz = p.tz
  if (p.country) out.country = p.country
  if (p.location) out.location = p.location
  if (p.manager && ids.has(p.manager)) out.manager = ids.get(p.manager)
  if (p.tags.length) out.tags = p.tags.slice(0, 20)
  if (typeof p.extra.avatar === 'string' && AVATAR.test(p.extra.avatar)) out.avatar = p.extra.avatar
  return out
}

/** The reporting-line team: the manager as lead, them and their reports as members. */
function lineTeam(ix, managerId, ids) {
  const members = [managerId, ...ix.kids(managerId)].filter((id) => ids.has(id)).map((id) => ({ person: ids.get(id), pct: 100 }))
  return { id: wsId(managerId, 'line'), name: `${ix.byId.get(managerId).name}'s team`, lead: ids.get(managerId), members }
}

/**
 * The payload "Save to your workspace" sends.
 * scope: a manager's id (them and their direct reports, as `<name>'s team`) or
 * 'org' (everyone, the document's teams, and one reporting-line team per
 * manager, top first, up to the workspace's 100 teams). meId: the visitor's
 * own card, written as `me` when it is in the payload.
 * A direct team carries no document teams: a team cut down to the people in
 * scope would replace the whole team a save of the org stored earlier.
 */
export function toWorkspace(ix, scope, { meId = '' } = {}) {
  const chosen = scopePeople(ix, scope).slice(0, PEOPLE_MAX)
  const ids = new Map(chosen.map((id) => [id, wsId(id)]))
  const people = chosen.map((id) => personOut(ix.byId.get(id), ids))
  const teams = []
  if (scope === 'org') {
    for (const t of ix.model.teams) {
      if (teams.length >= TEAMS_MAX) break
      const members = t.members.filter((m) => ids.has(m.person)).map((m) => ({ person: ids.get(m.person), pct: m.pct }))
      if (!members.length) continue
      const team = { id: wsId(t.id, 'team'), name: t.name, members }
      if (t.color) team.color = t.color.length === 4 ? `#${[...t.color.slice(1)].map((c) => c + c).join('')}` : t.color
      if (t.lead && ids.has(t.lead)) team.lead = ids.get(t.lead)
      teams.push(team)
    }
    for (const id of ix.order || ix.model.people.map((p) => p.id)) {
      if (teams.length >= TEAMS_MAX) break
      if (ids.has(id) && ix.kids(id).some((k) => ids.has(k))) teams.push(lineTeam(ix, id, ids))
    }
  } else if (chosen.length) teams.push(lineTeam(ix, scope, ids))
  const out = { people, teams }
  if (meId && ids.has(meId)) out.me = { person: ids.get(meId) }
  return out
}

/** How many people a scope holds before the cap, so the sheet can say what is left out. */
export const scopeSize = (ix, scope) => scopePeople(ix, scope).length
export { PEOPLE_MAX }

/**
 * The visitor's card from the workspace's `me.person`: the Rama id the
 * workspace id was made from, when that card is in this org, else the
 * person's email matched against the org. '' when neither finds a card.
 */
export function meFromWorkspace(ws, ix) {
  const id = ws?.me?.person
  if (!id || !Array.isArray(ws.people)) return ''
  const p = ws.people.find((x) => x && x.id === id)
  if (!p) return ''
  for (const cand of ix.model.people) {
    if (cand.virtual || cand.status === 'open') continue
    if (wsId(cand.id) === id) return cand.id
  }
  const email = typeof p.email === 'string' ? p.email.toLowerCase() : ''
  if (!email) return ''
  const hit = ix.model.people.find((x) => !x.virtual && x.status !== 'open' && x.email.includes(email))
  return hit ? hit.id : ''
}

/** The workspace settings Rama uses, from NeoWorkspace.prefs(): { tz, h, d, c }, each checked again. */
export function ramaPrefs(prefs) {
  const p = prefs && typeof prefs === 'object' ? prefs : {}
  const h = Array.isArray(p.h) && p.h.length === 2 && p.h.every(Number.isInteger) && p.h[0] >= 0 && p.h[0] < p.h[1] && p.h[1] <= 1440 ? [p.h[0], p.h[1]] : [540, 1080]
  const d = typeof p.d === 'string' && /^[1-7]{1,7}$/.test(p.d) ? p.d : '12345'
  const c = p.c === 'h12' || p.c === 'h23' ? p.c : ''
  const tz = typeof p.tz === 'string' && p.tz.length <= 60 ? p.tz : ''
  return { tz, h, d, c }
}

export { slug, ORG_ROOT }

/**
 * Whether "Save to your workspace" should warn before it leaves: the browser
 * says it is offline, or the workspace frame never answered (neorgon.com
 * unreachable). A frame still looking ('pending') does not count, nor does one
 * that answered without sharing (Safari): the page itself is reachable there.
 */
export const saveUnsure = ({ online = true, frame = 'pending' } = {}) => online === false || frame === 'none'
