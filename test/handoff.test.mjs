// handoff.js is a cross-site contract, so the documents it builds are fed
// through the REAL consumers, imported read-only from the sibling sites:
// Floorplan's normalizeDoc (schema.js) and b64urlDecode (utils.js), and
// Reparto's normalizeDoc (state.js). Reparto's #p= decoder lives in io.js,
// which imports plans.js and render.js (DOM), so its decode is copied below.
// None of these modules touches window, document or localStorage at import
// time, so no globals are stubbed.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseYaml, dumpYaml, yamlSkip, hasYaml, sampleRaw, ROOT, MONOREPO } from './helpers.mjs'
import { normalizeOrg } from '../js/schema.js'
import { indexOrg, ORG_ROOT } from '../js/tree.js'
import {
  scopeOf, toFloorplanDoc, toRepartoDoc, floorplanLink, repartoLink,
  FLOORPLAN_LINK_MAX, FLOORPLAN_URL, REPARTO_URL,
} from '../js/handoff.js'

const SITES = join(ROOT, '..')
const sibling = async (rel) => (existsSync(join(SITES, rel)) ? import(pathToFileURL(join(SITES, rel)).href) : null)
const fpSchema = await sibling('floorplan-site/js/schema.js')
const fpUtils = await sibling('floorplan-site/js/utils.js')
const rpState = await sibling('reparto-site/js/state.js')
const fpSkip = yamlSkip || (fpSchema && fpUtils ? false : 'floorplan-site is not checked out next to rama-site')
const rpSkip = rpState ? false : 'reparto-site is not checked out next to rama-site'
const jsyaml = hasYaml ? (await import(pathToFileURL(join(MONOREPO, 'node_modules/js-yaml/dist/js-yaml.mjs')).href)).default : null

/** Floorplan's yaml.js parses with js-yaml's DEFAULT_SCHEMA (timestamps become Dates), not Rama's CORE_SCHEMA. */
const floorplanParse = (text) => jsyaml.load(text, { schema: jsyaml.DEFAULT_SCHEMA })
/** Reparto's io.js decode(), copied as is. */
const repartoDecode = (text) => JSON.parse(new TextDecoder().decode(
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))))

const TODAY = { today: '2026-10-01' }
function org(raw) {
  const { model, issues } = normalizeOrg(raw)
  assert.deepEqual(issues.filter((i) => i.level === 'error'), [])
  return indexOrg(model)
}
let sampleIx = null
const sample = () => (sampleIx ??= org(sampleRaw()))

/** Dump the document, parse the text the way Floorplan does, and run Floorplan's own normalizer. */
function throughFloorplan(doc) {
  const text = dumpYaml(doc)
  return { text, ...fpSchema.normalizeDoc(floorplanParse(text)) }
}
const ref = (m) => (typeof m === 'string' ? m : m.person)
/** Every group with its depth, 1 being a top-level room. */
const allGroups = (groups, depth = 1) => (groups || []).flatMap((g) => [{ g, depth }, ...allGroups(g.groups, depth + 1)])
const maxDepth = (doc) => Math.max(0, ...allGroups(doc.groups).map((x) => x.depth))
/** The group tree as names and sorted member ids: the structure, not the order. */
const shape = (groups) => (groups || []).map((g) => ({ name: g.name, members: (g.members || []).map(ref).sort(), groups: shape(g.groups) }))
function memberCounts(doc) {
  const n = new Map()
  for (const { g } of allGroups(doc.groups)) for (const m of g.members || []) n.set(ref(m), (n.get(ref(m)) || 0) + 1)
  return n
}
const sorted = (a) => [...a].sort()

// Accented names, ids that differ from the slug of the name, an open role, a
// vendor with no title, a lowercase country, Floorplan-only team keys.
const TEAMS_ORG = {
  title: 'Café Ops',
  people: [
    { name: 'Zoë Kraft', id: 'zk', avatar: 'cat', country: 'DE', tz: 'Europe/Berlin', location: 'Köln' },
    { name: 'Inès Moreau', manager: 'zk', team: 'Plateforme Été', country: 'FR' },
    { name: 'José Núñez', id: 'jnunez', manager: 'zk', country: 'cl', role: 'senior-engineer' },
    { name: 'Open role', status: 'open', role: 'engineer', manager: 'zk' },
    { name: 'Vic Vendor', employment: 'vendor', manager: 'zk' },
  ],
  teams: [{
    name: 'Plateforme Été', id: 'pf', color: '#123456', lead: 'zk', owns: ['Builds', 'Caches'],
    capacity: 6, needs: ['go'], layout: { x: 1, y: 2, w: 4, h: 3 },
    members: [{ person: 'jnunez', pct: 40 }, 'Open role'],
  }],
}
// No teams, one top, five levels deep: Ada > Bea > Cy > Di > Ed.
const LINES_ORG = {
  title: 'Lines Co',
  people: [
    { name: 'Ada Top' },
    { name: 'Bea Mid', manager: 'ada-top' },
    { name: 'Inès Moreau', id: 'imoreau', manager: 'bea-mid' },
    { name: 'Cy Low', manager: 'bea-mid' },
    { name: 'Di Lower', manager: 'cy-low' },
    { name: 'Ed Lowest', manager: 'di-lower' },
    { name: 'Fay Leaf', manager: 'ada-top' },
  ],
}
// No teams, three people at the top, so the chart gets a virtual top.
const TWO_TOPS = {
  title: 'Two Tops',
  people: [
    { name: 'A0' }, { name: 'A1', manager: 'a0' }, { name: 'A2', manager: 'a1' }, { name: 'A3', manager: 'a2' }, { name: 'A4', manager: 'a3' },
    { name: 'Solo' }, { name: 'B0' }, { name: 'B1', manager: 'b0' },
  ],
}

describe('scopeOf', () => {
  test('the whole org: everyone once, top first, every manager before their reports', { skip: yamlSkip }, () => {
    const ix = sample()
    const scope = scopeOf(ix, ix.top)
    assert.equal(scope[0], ix.top)
    assert.deepEqual(sorted(scope), sorted(ix.model.people.map((p) => p.id)))
    const at = new Map(scope.map((id, i) => [id, i]))
    for (const id of scope.slice(1)) assert.ok(at.get(ix.parentOf(id)) < at.get(id), `${id} comes after their manager`)
  })

  test('a subtree is the head and everyone whose chain passes through them; a leaf is just themselves', { skip: yamlSkip }, () => {
    const ix = sample()
    const scope = scopeOf(ix, 'hana-kobayashi')
    assert.equal(scope[0], 'hana-kobayashi')
    const expected = ix.model.people.filter((p) => ix.chain(p.id).includes('hana-kobayashi')).map((p) => p.id)
    assert.deepEqual(sorted(scope), sorted(expected))
    assert.deepEqual(scopeOf(ix, 'amara-diallo'), ['amara-diallo'])
  })

  test('the virtual org root is never a person in scope', () => {
    const ix = org(TWO_TOPS)
    assert.equal(ix.top, ORG_ROOT)
    const scope = scopeOf(ix, ORG_ROOT)
    assert.ok(!scope.includes(ORG_ROOT))
    assert.deepEqual(sorted(scope), sorted(ix.model.people.map((p) => p.id)))
  })
})

describe('toFloorplanDoc with teams, through Floorplan', () => {
  /** Floorplan's people are exactly the scope, by id, with Rama's names; no person was invented from a member list. */
  function assertPeople(fp, ix, scope) {
    assert.deepEqual(fp.errors, [])
    assert.deepEqual(fp.warnings.filter((w) => /created person/.test(w)), [])
    assert.deepEqual(sorted(Object.keys(fp.model.people)), sorted(scope))
    for (const id of scope) assert.equal(fp.model.people[id].name, ix.byId.get(id).name)
  }
  /** Every Rama team with someone in scope arrives as the Floorplan group of the same id, members and pct intact. */
  function assertTeams(fp, ix, scope) {
    const inScope = new Set(scope)
    for (const t of ix.model.teams) {
      const members = t.members.filter((m) => inScope.has(m.person)).map(({ person, pct }) => ({ person, pct }))
      if (!members.length) continue
      const g = fp.model.groups[t.id]
      assert.ok(g, `team ${t.id} became a Floorplan group`)
      assert.equal(g.name, t.name)
      assert.deepEqual(g.members, members, `members and pct of ${t.id}`)
      assert.deepEqual(g.owns, t.owns)
      if (t.color) assert.equal(g.color, t.color)
      if (t.parent && fp.model.groups[t.parent]) assert.equal(g.parent, t.parent)
    }
  }

  test('the whole sample org', { skip: fpSkip }, () => {
    const ix = sample()
    const doc = toFloorplanDoc(ix, ix.top, TODAY)
    assert.equal(doc.title, 'Lanternfish Systems')
    assert.equal(doc.mode, 'diagram')
    assert.match(doc.notes, /2026-10-01/)
    assert.match(doc.notes, new RegExp(`${ix.model.people.length} people`))
    const fp = throughFloorplan(doc)
    const scope = scopeOf(ix, ix.top)
    assertPeople(fp, ix, scope)
    assertTeams(fp, ix, scope)
    assert.equal(fp.model.meta.title, 'Lanternfish Systems')
    const p = fp.model.people['open-lead-site-reliability-engineer-20']
    assert.equal(p.name, 'Open role', 'an open role keeps its own id though its name slugs to open-role')
    assert.equal(p.role, 'Lead Site Reliability Engineer')
    assert.equal(fp.model.people['ezra-nakamura'].tz, 'America/Los_Angeles')
  })

  for (const head of ['hana-kobayashi', 'kwame-mensah']) {
    test(`a director's subtree with teams: ${head}`, { skip: fpSkip }, () => {
      const ix = sample()
      const doc = toFloorplanDoc(ix, head, TODAY)
      const name = ix.byId.get(head).name
      assert.equal(doc.title, `${name}'s org`)
      assert.match(doc.notes, new RegExp(`at or under ${name}`))
      assert.match(doc.notes, /A manager who leads a team became that team/)
      const scope = scopeOf(ix, head)
      const fp = throughFloorplan(doc)
      assertPeople(fp, ix, scope)
      assertTeams(fp, ix, scope)
      for (const { g } of allGroups(doc.groups)) for (const m of g.members || []) assert.ok(scope.includes(ref(m)), `${ref(m)} is in scope`)
    })
  }

  test('a split person keeps both shares: Jules is 50% Core and 50% Migration', { skip: fpSkip }, () => {
    const fp = throughFloorplan(toFloorplanDoc(sample(), 'hana-kobayashi', TODAY))
    assert.deepEqual(fp.model.groups.core.members.find((m) => m.person === 'jules-okafor'), { person: 'jules-okafor', pct: 50 })
    assert.deepEqual(fp.model.groups.migration.members.find((m) => m.person === 'jules-okafor'), { person: 'jules-okafor', pct: 50 })
  })

  test('accented names, ids unlike their names, and Floorplan-only team keys all resolve', { skip: fpSkip }, () => {
    const ix = org(TEAMS_ORG)
    const fp = throughFloorplan(toFloorplanDoc(ix, ix.top, TODAY))
    assertPeople(fp, ix, scopeOf(ix, ix.top))
    assert.deepEqual(fp.warnings, [])
    assert.equal(fp.model.people['ines-moreau'].name, 'Inès Moreau')
    assert.equal(fp.model.people.zk.location, 'Köln')
    assert.deepEqual(fp.model.people.zk.avatar, { kind: 'cat' })
    const g = fp.model.groups.pf
    assert.equal(g.name, 'Plateforme Été')
    assert.deepEqual(sorted(g.members.map((m) => `${m.person}:${m.pct}`)), ['ines-moreau:100', 'jnunez:40', 'open-software-engineer-4:100'])
    assert.equal(g.capacity, 6)
    assert.deepEqual(g.needs, ['go'])
    assert.deepEqual(g.layout, { x: 1, y: 2, w: 4, h: 3 })
    assert.deepEqual(g.owns, ['Builds', 'Caches'])
    assert.equal(g.color, '#123456')
  })

  test('names Floorplan slugs differently (a PDF ligature, fullwidth letters) still resolve', { skip: fpSkip }, () => {
    // U+FB03 is the "ffi" ligature a name pasted from a PDF carries; U+FF21.. are fullwidth letters.
    const ix = org({ title: 'Paste', people: [
      { name: 'Boss' },
      { name: 'Steﬃ Graf', manager: 'boss' },
      { name: 'Ｋｅｎｊｉ Ｓａｔｏ', manager: 'boss' },
    ] })
    const fp = throughFloorplan(toFloorplanDoc(ix, ix.top, TODAY))
    assert.deepEqual(fp.errors, [])
    assert.deepEqual(sorted(Object.keys(fp.model.people)), sorted(ix.model.people.map((p) => p.id)))
  })
})

describe('toFloorplanDoc without teams: reporting lines become groups', () => {
  test('managers sit in their own group, and nesting folds below three levels', { skip: fpSkip }, () => {
    const ix = org(LINES_ORG)
    const doc = toFloorplanDoc(ix, ix.top, TODAY)
    assert.match(doc.notes, /Each manager became a group with their reports/)
    assert.deepEqual(shape(doc.groups), [{
      name: "Ada Top's team", members: ['ada-top', 'fay-leaf'], groups: [{
        name: "Bea Mid's team", members: ['bea-mid', 'imoreau'], groups: [{
          name: "Cy Low's team", members: ['cy-low', 'di-lower', 'ed-lowest'], groups: [],
        }],
      }],
    }])
    assert.equal(maxDepth(doc), 3)
    for (const id of scopeOf(ix, ix.top)) assert.equal(memberCounts(doc).get(id), 1, `${id} sits in exactly one group`)
    const fp = throughFloorplan(doc)
    assert.deepEqual(fp.errors, [])
    assert.deepEqual(sorted(Object.keys(fp.model.people)), sorted(ix.model.people.map((p) => p.id)))
    assert.equal(fp.model.people.imoreau.name, 'Inès Moreau')
    const placed = Object.values(fp.model.groups).flatMap((g) => g.members.map((m) => m.person))
    assert.deepEqual(sorted(placed), sorted(Object.keys(fp.model.people)))
  })

  test('a subtree starts its own three levels at its head; a leaf has no groups', { skip: fpSkip }, () => {
    const ix = org(LINES_ORG)
    const doc = toFloorplanDoc(ix, 'bea-mid', TODAY)
    assert.equal(doc.title, "Bea Mid's org")
    assert.equal(maxDepth(doc), 3)
    const fp = throughFloorplan(doc)
    assert.deepEqual(fp.errors, [])
    assert.deepEqual(sorted(Object.keys(fp.model.people)), sorted(['bea-mid', 'imoreau', 'cy-low', 'di-lower', 'ed-lowest']))
    const leaf = toFloorplanDoc(ix, 'fay-leaf', TODAY)
    assert.equal(leaf.people.length, 1)
    assert.equal(leaf.groups, undefined)
    assert.match(leaf.notes, /1 person at or under Fay Leaf/)
    assert.deepEqual(throughFloorplan(leaf).errors, [])
  })

  test('a virtual top is not a room: the roots stand at the top, everyone once', { skip: fpSkip }, () => {
    const ix = org(TWO_TOPS)
    assert.ok(ix.virtual)
    const doc = toFloorplanDoc(ix, ix.top, TODAY)
    assert.equal(doc.title, 'Two Tops')
    const tops = doc.groups.map((g) => g.name)
    assert.equal(tops.length, 3)
    assert.ok(tops.includes("A0's team") && tops.includes("B0's team"))
    assert.ok(!allGroups(doc.groups).some(({ g }) => g.name === 'Two Tops' || g.id === 'two-tops'), 'no room stands for the org itself')
    for (const id of scopeOf(ix, ix.top)) assert.equal(memberCounts(doc).get(id), 1, `${id} sits in exactly one group`)
    assert.ok(!memberCounts(doc).has(ORG_ROOT))
    const fp = throughFloorplan(doc)
    assert.deepEqual(fp.errors, [])
    assert.deepEqual(sorted(Object.keys(fp.model.people)), sorted(ix.model.people.map((p) => p.id)))
  })

  test('a virtual top does not use up one of the three levels', { skip: fpSkip }, () => {
    const doc = toFloorplanDoc(org(TWO_TOPS), ORG_ROOT, TODAY)
    const a0 = shape(doc.groups).find((g) => g.name === "A0's team")
    assert.deepEqual(a0, {
      name: "A0's team", members: ['a0'], groups: [{
        name: "A1's team", members: ['a1'], groups: [{ name: "A2's team", members: ['a2', 'a3', 'a4'], groups: [] }],
      }],
    })
  })

  test('the notes say how groups were made, even when the org has teams elsewhere', { skip: yamlSkip }, () => {
    const ix = sample()
    const doc = toFloorplanDoc(ix, 'elena-petrova', TODAY)
    assert.ok(doc.groups.some((g) => g.name === "Elena Petrova's team"), 'no team is in scope, so lines became groups')
    assert.doesNotMatch(doc.notes, /A manager who leads a team became that team/)
    assert.match(doc.notes, /Each manager became a group with their reports/)
  })

  test('a 3000-deep chain neither overflows nor nests past three levels', () => {
    const people = Array.from({ length: 3000 }, (_, i) => (i ? { name: `P${i}`, manager: `p${i - 1}` } : { name: 'P0' }))
    const ix = org({ title: 'Chain', people })
    const doc = toFloorplanDoc(ix, ix.top, TODAY)
    assert.equal(maxDepth(doc), 3)
    assert.equal(memberCounts(doc).size, 3000)
  })
})

describe('Floorplan YAML and #d= links', () => {
  test('the YAML text round-trips through dumpYaml/parseYaml and through Floorplan\'s own parse', { skip: fpSkip }, () => {
    const tricky = org({ title: '2026-10-01', people: [{ name: '0x1F' }, { name: 'true', manager: '0x1f', tz: '+2' }, { name: 'Inès: "Moreau"', manager: '0x1f' }] })
    for (const [ix, id] of [[sample(), sample().top], [sample(), 'hana-kobayashi'], [org(LINES_ORG), 'ada-top'], [org(TWO_TOPS), ORG_ROOT], [org(TEAMS_ORG), 'zk'], [tricky, tricky.top]]) {
      const doc = toFloorplanDoc(ix, id, TODAY)
      const text = dumpYaml(doc)
      assert.deepEqual(parseYaml(text), doc)
      assert.deepEqual(floorplanParse(text), doc)
    }
    const fp = throughFloorplan(toFloorplanDoc(tricky, tricky.top, TODAY))
    assert.equal(fp.model.meta.title, '2026-10-01', 'a date-like title stays a string in Floorplan')
    assert.equal(fp.model.people['0x1f'].name, '0x1F')
    assert.equal(fp.model.people.true.tz, '+2')
  })

  test('the sample org fits a link whose payload Floorplan decodes back to the same YAML', { skip: fpSkip }, () => {
    const text = dumpYaml(toFloorplanDoc(sample(), sample().top, TODAY))
    const link = floorplanLink(text)
    assert.ok(link?.startsWith(`${FLOORPLAN_URL}#d=`))
    const payload = link.slice(`${FLOORPLAN_URL}#d=`.length)
    assert.match(payload, /^[A-Za-z0-9_-]+$/)
    assert.ok(payload.length <= FLOORPLAN_LINK_MAX)
    assert.equal(fpUtils.b64urlDecode(payload), text)
    assert.deepEqual(fpSchema.normalizeDoc(floorplanParse(fpUtils.b64urlDecode(payload))).errors, [])
  })

  test('the payload is UTF-8 base64url, the encoding Floorplan\'s llms.txt documents', { skip: fpSkip }, () => {
    const text = dumpYaml(toFloorplanDoc(org(TEAMS_ORG), 'zk', TODAY)) + '# Zoë, 山田, \u{1F41F}\n'
    const payload = floorplanLink(text).split('#d=')[1]
    assert.equal(payload, Buffer.from(text, 'utf8').toString('base64url'))
    assert.equal(fpUtils.b64urlDecode(payload), text)
  })

  test('null past FLOORPLAN_LINK_MAX, counted in payload characters of UTF-8 bytes', () => {
    assert.equal(FLOORPLAN_LINK_MAX, 32000)
    // 3 bytes become 4 characters: 24000 bytes are exactly 32000.
    assert.equal(floorplanLink('a'.repeat(24000)).split('#d=')[1].length, FLOORPLAN_LINK_MAX)
    assert.equal(floorplanLink('a'.repeat(24001)), null)
    assert.ok(floorplanLink('é'.repeat(12000)), '12000 two-byte characters are 24000 bytes')
    assert.equal(floorplanLink('é'.repeat(12001)), null)
  })

  test('a large org is handed over as a file: no link', { skip: yamlSkip }, () => {
    const people = Array.from({ length: 400 }, (_, i) => ({ name: `Person ${i} With A Fairly Long Name`, role: 'senior-engineer', location: 'Somewhere, Someland', tz: 'Europe/Berlin', manager: i ? 'person-0-with-a-fairly-long-name' : undefined }))
    const text = dumpYaml(toFloorplanDoc(org({ title: 'Big', people }), undefined, TODAY))
    assert.equal(floorplanLink(text), null)
  })
})

describe('toRepartoDoc, through Reparto', () => {
  test('a manager hands over their direct reports, open roles as open seats, owned areas unestimated', { skip: yamlSkip }, () => {
    const ix = sample()
    const { plan, lead } = toRepartoDoc(ix, 'diego-salinas')
    assert.equal(lead, 'diego-salinas')
    assert.equal(plan.title, "Diego Salinas's team")
    assert.deepEqual(plan.people.map((p) => p.id), ix.kids('diego-salinas'))
    for (const p of plan.people) {
      const src = ix.byId.get(p.id)
      assert.equal(p.name, src.name)
      assert.equal(p.role, src.title)
      assert.equal(p.open === true, src.status === 'open', `${p.id} open seat`)
    }
    assert.equal(plan.people.filter((p) => p.open).length, 1)
    assert.deepEqual(plan.deliverables, [{ id: 'd-1', name: 'Payout Ledger', estimate: null, members: [] }])
    assert.deepEqual(sorted(plan.settings.countries), ['IE', 'IN', 'SN'])
  })

  test('Reparto\'s normalizeDoc accepts the plan with the same people, ids and countries', { skip: rpSkip || yamlSkip }, () => {
    for (const id of ['diego-salinas', 'sofia-lindqvist', 'noor-haddad', 'grace-whitfield', 'camille-laurent']) {
      const { plan } = toRepartoDoc(sample(), id)
      const out = rpState.normalizeDoc(plan)
      assert.equal(out.title, plan.title)
      assert.deepEqual(plainPeople(out), plainPeople(plan))
      assert.deepEqual(out.deliverables.map((d) => [d.id, d.name, d.estimate, d.members.length]), plan.deliverables.map((d) => [d.id, d.name, null, 0]))
      assert.deepEqual(out.settings.countries, plan.settings?.countries ?? [])
    }
  })

  test('a leaf falls back to their manager\'s team', { skip: yamlSkip }, () => {
    const ix = sample()
    const leaf = toRepartoDoc(ix, 'amara-diallo')
    assert.equal(leaf.lead, 'diego-salinas')
    assert.deepEqual(leaf.plan, toRepartoDoc(ix, 'diego-salinas').plan)
    assert.ok(leaf.plan.people.some((p) => p.id === 'amara-diallo'))
  })

  test('the top person hands over the people who report to them', { skip: yamlSkip }, () => {
    const ix = sample()
    const { plan, lead } = toRepartoDoc(ix, 'noor-haddad')
    assert.equal(lead, 'noor-haddad')
    assert.equal(plan.title, "Noor Haddad's team")
    assert.deepEqual(plan.people.map((p) => p.id), ix.kids('noor-haddad'))
    assert.deepEqual(plan.deliverables, [])
  })

  test('every owned area becomes one unestimated deliverable', { skip: yamlSkip }, () => {
    const { plan } = toRepartoDoc(sample(), 'sofia-lindqvist')
    assert.deepEqual(plan.deliverables.map((d) => d.name), ['Billing Core', 'Entitlements'])
    for (const d of plan.deliverables) { assert.equal(d.estimate, null); assert.deepEqual(d.members, []) }
    assert.equal(new Set(plan.deliverables.map((d) => d.id)).size, plan.deliverables.length)
  })

  test('country codes, a contractor with no title, and an open seat survive Reparto', { skip: rpSkip }, () => {
    const ix = org(TEAMS_ORG)
    const { plan } = toRepartoDoc(ix, 'zk')
    const byId = Object.fromEntries(plan.people.map((p) => [p.id, p]))
    assert.equal(byId['jnunez'].country, 'CL')
    assert.equal(byId['vic-vendor'].role, 'Contractor')
    assert.equal(byId['open-software-engineer-4'].open, true)
    assert.deepEqual(sorted(plan.settings.countries), ['CL', 'FR'])
    assert.deepEqual(plan.deliverables.map((d) => d.name), ['Builds', 'Caches'])
    const out = rpState.normalizeDoc(plan)
    assert.deepEqual(plainPeople(out), plainPeople(plan))
    assert.deepEqual(sorted(out.settings.countries), ['CL', 'FR'])
  })

  test('a person at the top of a many-rooted org hands over the top level, never the virtual root', { skip: rpSkip }, () => {
    const ix = org(TWO_TOPS)
    const { plan, lead } = toRepartoDoc(ix, 'solo')
    assert.equal(lead, ORG_ROOT)
    assert.equal(plan.title, 'Two Tops top level')
    assert.deepEqual(sorted(plan.people.map((p) => p.id)), ['a0', 'b0', 'solo'])
    assert.deepEqual(rpState.normalizeDoc(plan).people.map((p) => p.id), plan.people.map((p) => p.id))
  })

  test('long ids are shortened to Reparto\'s 40 characters, stay unique, and Reparto keeps them', { skip: rpSkip }, () => {
    const ix = org({ title: 'Long', people: [
      { name: 'Boss' },
      { name: 'Maria Fernanda de los Angeles Gutierrez Villanueva', manager: 'boss' },
      { name: 'Maria Fernanda de los Angeles Gutierrez Villanueva Junior', manager: 'boss' },
      { name: 'Open role', status: 'open', role: 'Staff Site Reliability Engineer, Payments', manager: 'boss' },
    ] })
    assert.ok(ix.model.people.some((p) => p.id.length > 40), 'the fixture has a Rama id over 40 characters')
    const { plan } = toRepartoDoc(ix, 'boss')
    const ids = plan.people.map((p) => p.id)
    assert.ok(ids.every((id) => id.length <= 40 && /^[A-Za-z0-9_-]+$/.test(id) && !id.endsWith('-')), ids.join(' '))
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(rpState.normalizeDoc(plan).people.map((p) => p.id), ids)
  })
})

describe('repartoLink', () => {
  test('a #p= link Reparto\'s own decoder reads back to the same plan', { skip: rpSkip }, () => {
    const { plan } = toRepartoDoc(org(TEAMS_ORG), 'zk')
    const link = repartoLink(plan)
    assert.ok(link.startsWith(`${REPARTO_URL}#p=`))
    const payload = link.slice(`${REPARTO_URL}#p=`.length)
    assert.match(payload, /^[A-Za-z0-9_-]+$/)
    const back = repartoDecode(payload)
    assert.deepEqual(back, plan)
    assert.ok(back.people.some((p) => p.name === 'Inès Moreau'), 'UTF-8 names survive')
    assert.deepEqual(plainPeople(rpState.normalizeDoc(back)), plainPeople(plan))
  })

  test('the sample org\'s plans decode for every manager', { skip: rpSkip || yamlSkip }, () => {
    const ix = sample()
    for (const p of ix.model.people.filter((x) => ix.kids(x.id).length)) {
      const { plan } = toRepartoDoc(ix, p.id)
      assert.deepEqual(repartoDecode(repartoLink(plan).split('#p=')[1]), plan)
    }
  })
})

/** The fields both sides of the Reparto handoff carry, with Reparto's defaults filled in. */
function plainPeople(plan) {
  return plan.people.map(({ id, name, role, open, country }) => ({ id, name, role, open: !!open, country: country || '' }))
}
