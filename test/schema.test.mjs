// The org document gate: schema.js, teams.js and roles.js. Assertions state the
// contract in each file's header, so a red test is a defect in the code, not a
// stale expectation. Run: node --test test/schema.test.mjs
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeOrg, orgToDoc, personFinder, roleColor, MANAGER_ALIASES, MAX_PEOPLE } from '../js/schema.js'
import { normalizeTeams, teamsToDoc } from '../js/teams.js'
import { guessTrack, DEFAULT_ROLES, TRACKS, TRACK_COLORS } from '../js/roles.js'
import { slug } from '../js/core.js'
import { parseYaml, dumpYaml, yamlSkip, sampleRaw, ROOT } from './helpers.mjs'

const warns = (issues) => issues.filter((i) => i.level === 'warn').map((i) => i.msg)
const errors = (issues) => issues.filter((i) => i.level === 'error').map((i) => i.msg)
const hasWarn = (issues, re) => warns(issues).some((m) => re.test(m))
const byId = (model, id) => model.people.find((p) => p.id === id)
const roundTrip = (model) => normalizeOrg(orgToDoc(model))
const rtt = (p) => [p.role, p.title, p.track]
/** One person called Ada Lovelace with the given keys. */
const one = (fields) => { const { model, issues } = normalizeOrg({ people: [{ name: 'Ada Lovelace', ...fields }] }); return { p: model.people[0], issues } }

describe('the sample org', () => {
  test('normalizes with zero issues and every manager exists', { skip: yamlSkip }, () => {
    const { model, issues } = normalizeOrg(sampleRaw())
    assert.deepEqual(issues, [])
    assert.ok(model.people.length > 10 && model.teams.length > 0)
    const ids = new Set(model.people.map((p) => p.id))
    assert.equal(ids.size, model.people.length)
    for (const p of model.people) if (p.manager) assert.ok(ids.has(p.manager), p.id)
  })

  test('round-trips: normalizeOrg(orgToDoc(model)).model deep-equals model', { skip: yamlSkip }, () => {
    const { model } = normalizeOrg(sampleRaw())
    const again = roundTrip(model)
    assert.deepEqual([again.issues, again.model], [[], model])
  })

  test('round-trips through YAML text as the page exports it', { skip: yamlSkip }, () => {
    const { model } = normalizeOrg(sampleRaw())
    const again = normalizeOrg(parseYaml(dumpYaml(orgToDoc(model))))
    assert.deepEqual([again.issues, again.model], [[], model])
  })
})

describe('reading people', () => {
  test('not a document, people not a list, an entry not a person', () => {
    for (const bad of [null, 'text', 42]) {
      const { model, issues } = normalizeOrg(bad)
      assert.deepEqual([errors(issues).length, model.people], [1, []])
    }
    assert.deepEqual(errors(normalizeOrg({ people: 'Ada' }).issues), ['people: must be a list'])
    const r = normalizeOrg({ people: [['Ada'], 'Grace'] })
    assert.deepEqual([errors(r.issues), r.model.people.map((p) => p.id)], [['people[0] is not a person'], ['grace']])
  })

  test('bare strings and numbers are names; a top-level list is the people list', () => {
    for (const raw of [{ people: ['Ada Lovelace', 42] }, ['Ada Lovelace', 42]]) {
      const { model, issues } = normalizeOrg(raw)
      assert.deepEqual(issues, [])
      assert.deepEqual(model.people.map((p) => [p.id, p.name]), [['ada-lovelace', 'Ada Lovelace'], ['42', '42']])
      const p = model.people[0]
      assert.deepEqual([p.status, p.employment, p.email, p.dotted, p.tags, p.extra], ['active', 'employee', [], [], [], {}])
    }
  })

  test('people as a map read as a list whose keys are ids', () => {
    const { model, issues } = normalizeOrg({ people: { ada: { name: 'Ada Lovelace', manager: 'grace' }, grace: 'Grace Hopper' } })
    assert.deepEqual(issues, [])
    assert.deepEqual(model.people.map((p) => [p.id, p.name]), [['ada', 'Ada Lovelace'], ['grace', 'Grace Hopper']])
    assert.equal(byId(model, 'ada').manager, 'grace')
  })

  test('ids come from names, explicit ids are slugged, duplicates get -2, -3', () => {
    const { model, issues } = normalizeOrg({ people: ['José Núñez', { name: 'Ada', id: 'Ada L' }, 'Grace', 'Grace', 'Grace', '李雷', { name: 'Alan', manager: '李雷' }] })
    const ids = model.people.map((p) => p.id)
    assert.deepEqual(ids.slice(0, 5), ['jose-nunez', 'ada-l', 'grace', 'grace-2', 'grace-3'])
    assert.ok(ids[5], 'a name with no ascii still gets an id')
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(byId(model, 'alan').manager, ids[5], 'and is still found by name')
    assert.equal(warns(issues).filter((m) => /share the id "grace"/.test(m)).length, 2)
  })

  test('open roles need no name; a person who is not open does', () => {
    const { model, issues } = normalizeOrg({ people: [{ status: 'open', role: 'security-engineer' }, { status: 'open', role: 'security-engineer' }, { status: 'hiring' }, { role: 'ceo' }] })
    assert.deepEqual(errors(issues), ['people[3] has no name'])
    assert.equal(model.people.length, 3)
    for (const p of model.people) { assert.deepEqual([p.name, p.status], ['Open role', 'open']); assert.match(p.id, /^open-/) }
    assert.equal(new Set(model.people.map((p) => p.id)).size, 3)
    assert.equal(model.people[0].title, 'Security Engineer')
  })

  test('only the first MAX_PEOPLE people are read', () => {
    const names = (n) => Array.from({ length: n }, (_, i) => `P${i}`)
    assert.deepEqual(normalizeOrg({ people: names(MAX_PEOPLE) }).issues, [])
    const over = normalizeOrg({ people: names(MAX_PEOPLE + 1) })
    assert.equal(over.model.people.length, MAX_PEOPLE)
    assert.ok(hasWarn(over.issues, new RegExp(`first ${MAX_PEOPLE}`)))
  })
})

describe('roles', () => {
  test('a role resolves by id, slug or title; free text becomes the title', () => {
    const { model, issues } = normalizeOrg({ people: [
      { name: 'A', role: 'eng-manager' }, { name: 'B', role: 'Eng Manager' }, { name: 'C', role: 'engineering MANAGER' },
      { name: 'D', role: 'Head of Security' }, { name: 'E', role: 'ceo', title: 'Founder' }, { name: 'F', role: 'Gardener' },
    ] })
    assert.deepEqual(issues, [])
    for (const id of ['a', 'b', 'c']) assert.deepEqual(rtt(byId(model, id)), ['eng-manager', 'Engineering Manager', 'management'], id)
    assert.deepEqual(rtt(byId(model, 'd')), ['', 'Head of Security', 'management'])
    assert.deepEqual(rtt(byId(model, 'e')), ['ceo', 'Founder', 'exec'])
    assert.deepEqual(rtt(byId(model, 'f')), ['', 'Gardener', 'ic'])
  })

  test('declared roles merge over the built-ins by id and never change DEFAULT_ROLES', () => {
    const { model, issues } = normalizeOrg({
      roles: { ceo: { title: 'Founder and CEO' }, 'Payments Engineer': { level: 'IC3' }, bard: { title: 'Bard', track: 'poet' } },
      people: [{ name: 'A', role: 'ceo' }, { name: 'B', role: 'Payments Engineer' }],
    })
    const ceo = model.roles.ceo
    assert.deepEqual([ceo.title, ceo.track, ceo.level, byId(model, 'a').title], ['Founder and CEO', 'exec', 'E1', 'Founder and CEO'])
    assert.equal(byId(model, 'b').role, 'payments-engineer')
    assert.deepEqual(model.declaredRoles, ['ceo', 'payments-engineer', 'bard'])
    assert.ok(hasWarn(issues, /track "poet"/))
    assert.equal(model.roles.bard.track, 'ic')
    model.roles.cto.title = 'changed'
    assert.deepEqual([DEFAULT_ROLES.ceo.title, DEFAULT_ROLES.cto.title], ['Chief Executive Officer', 'Chief Technology Officer'])
  })

  test('roles may be a list keyed by id or by slugged title', () => {
    const { model } = normalizeOrg({ roles: [{ id: 'bard', title: 'Bard' }, { title: 'Head of Kitchen' }], people: [] })
    assert.deepEqual(model.declaredRoles, ['bard', 'head-of-kitchen'])
    assert.equal(model.roles['head-of-kitchen'].track, 'management')
  })

  test('DEFAULT_ROLES: slug ids, known tracks, unique titles, each reachable by its title', () => {
    const titles = new Set()
    for (const [id, r] of Object.entries(DEFAULT_ROLES)) {
      assert.equal(slug(id), id)
      assert.ok(TRACKS.includes(r.track) && typeof r.level === 'string', id)
      assert.ok(!titles.has(r.title.toLowerCase()), `duplicate title ${r.title}`)
      titles.add(r.title.toLowerCase())
    }
    const { model } = normalizeOrg({ people: Object.values(DEFAULT_ROLES).map((r, i) => ({ name: `P${i}`, role: r.title })) })
    assert.deepEqual(model.people.map((p) => p.role), Object.keys(DEFAULT_ROLES))
  })

  test('guessTrack reads a free-text title', () => {
    const cases = [['Chief Executive Officer', 'exec'], ['VP, Sales', 'exec'], ['Founder', 'exec'], ['Engineering Manager', 'management'],
      ['Head of Security', 'management'], ['Director, Design', 'management'], ['Technical Writer', 'support'],
      ['Executive Assistant', 'support'], ['Program Manager', 'support'], ['Software Engineer', 'ic'], ['', 'ic']]
    for (const [title, track] of cases) assert.equal(guessTrack(title), track, title)
    assert.equal(guessTrack(), 'ic')
  })

  test('guessTrack: a Chief of Staff is support, as SUPPORT_WORDS and the catalogue say', () => {
    assert.equal(DEFAULT_ROLES['chief-of-staff'].track, 'support')
    assert.equal(guessTrack('Chief of Staff'), 'support')
    assert.equal(guessTrack('Chief of Staff, Engineering'), 'support')
  })

  test('roleColor: the role colour, else the track colour', () => {
    const { model } = normalizeOrg({
      roles: { 'staff-engineer': { color: '#22D3EE' }, wizard: { title: 'Wizard', color: 'red' } },
      people: [{ name: 'A', role: 'staff-engineer' }, { name: 'B', role: 'ceo' }, { name: 'C', role: 'Head of Security' }, { name: 'D', role: 'wizard' }],
    })
    assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => roleColor(model, byId(model, id))),
      ['#22d3ee', TRACK_COLORS.exec, TRACK_COLORS.management, TRACK_COLORS.ic])
    assert.equal(roleColor(model, { role: '', track: 'bogus' }), TRACK_COLORS.ic)
  })
})

describe('reporting lines', () => {
  test('a manager resolves by id, name, slug or email', () => {
    const { model, issues } = normalizeOrg({ people: [
      { name: 'Grace Hopper', id: 'g1', email: 'Grace@Navy.example' },
      { name: 'A', manager: 'g1' }, { name: 'B', manager: 'grace hopper' }, { name: 'C', manager: 'Grace Hopper' },
      { name: 'D', manager: 'grace-hopper' }, { name: 'E', manager: 'GRACE@navy.example' },
    ] })
    assert.deepEqual(issues, [])
    for (const id of ['a', 'b', 'c', 'd', 'e']) assert.equal(byId(model, id).manager, 'g1', id)
  })

  test('every alias in MANAGER_ALIASES sets the manager and is not kept as a detail', () => {
    for (const alias of MANAGER_ALIASES) {
      const { model, issues } = normalizeOrg({ people: ['Grace Hopper', { name: 'Ada', [alias]: 'Grace Hopper' }] })
      const ada = byId(model, 'ada')
      assert.deepEqual([issues, ada.manager, ada.extra], [[], 'grace-hopper', {}], alias)
    }
    const both = normalizeOrg({ people: ['Grace', 'Alan', { name: 'Ada', manager: 'alan', boss: 'grace' }] })
    assert.equal(byId(both.model, 'ada').manager, 'alan', 'manager: wins over an alias')
  })

  test('an unknown manager and a self-manager warn and leave the person at the top', () => {
    const { model, issues } = normalizeOrg({ people: [{ name: 'Ada', manager: 'nobody' }, { name: 'Grace', manager: 'Grace' }] })
    assert.ok(hasWarn(issues, /Ada: manager "nobody" is not in people/))
    assert.ok(hasWarn(issues, /Grace cannot manage themselves/))
    assert.deepEqual(model.people.map((p) => p.manager), ['', ''])
  })

  test('reporting loops are cut once each, so every person reaches a root', () => {
    const { model, issues } = normalizeOrg({ people: [
      { name: 'Tail', manager: 'd' }, { name: 'A', manager: 'b' }, { name: 'B', manager: 'a' },
      { name: 'C', manager: 'd' }, { name: 'D', manager: 'e' }, { name: 'E', manager: 'f' }, { name: 'F', manager: 'c' },
    ] })
    const ids = new Map(model.people.map((p) => [p.id, p]))
    for (const p of model.people) {
      let q = p
      for (let steps = 0; q.manager; steps++) { assert.ok(steps < model.people.length, `${p.id} loops`); q = ids.get(q.manager); assert.ok(q) }
    }
    assert.equal(model.people.filter((p) => !p.manager).length, 2)
    assert.equal(warns(issues).filter((m) => /Reporting loop/.test(m)).length, 2)
  })

  test('dotted lines: a ref or a list, resolved, deduplicated, never yourself', () => {
    const { model, issues } = normalizeOrg({ people: [
      'Grace Hopper', { name: 'Alan', email: 'alan@x.example' },
      { name: 'Ada', dotted: ['grace-hopper', 'Grace Hopper', 'ALAN@x.example', 'ada', 'ghost'] }, { name: 'Edsger', dotted: 'Alan' },
    ] })
    assert.deepEqual([byId(model, 'ada').dotted, byId(model, 'edsger').dotted], [['grace-hopper', 'alan'], ['alan']])
    assert.deepEqual(warns(issues), ['Ada: dotted-line "ghost" is not in people'])
  })
})

describe('profiles', () => {
  test('extends: single, list, chained; later wins, the person wins, tags merge', () => {
    const { model, issues } = normalizeOrg({
      profiles: { base: { location: 'Lisbon', tags: ['all'], employment: 'contractor' },
        revenue: { extends: 'base', costCentre: 'CC-410', tags: ['payments'] }, agency: { employment: 'vendor', notes: 'Through an agency' } },
      people: [{ name: 'A', extends: 'revenue' }, { name: 'B', extends: ['revenue', 'agency'], tags: ['go'] }, { name: 'C', extends: ['agency', 'revenue'], location: 'Porto' }],
    })
    assert.deepEqual(issues, [])
    const [a, b, c] = model.people
    assert.deepEqual([a.location, a.employment, a.tags, a.extra], ['Lisbon', 'contractor', ['all', 'payments'], { costCentre: 'CC-410' }])
    assert.deepEqual([b.employment, b.notes, [...b.tags].sort()], ['vendor', 'Through an agency', ['all', 'go', 'payments']])
    assert.deepEqual([c.employment, c.location, c.notes], ['contractor', 'Porto', 'Through an agency'])
  })

  test('a profile cycle and an unknown profile warn; what resolves still applies', () => {
    const { model, issues } = normalizeOrg({
      profiles: { a: { extends: 'b', location: 'A' }, b: { extends: 'a', tz: 'UTC' }, c: { extends: 'nope', pronouns: 'they' } },
      people: [{ name: 'P', extends: ['a', 'missing'] }, { name: 'Q', extends: 'c' }],
    })
    for (const re of [/Profile cycle: a > b > a/, /extends unknown profile "missing"/, /extends unknown profile "nope"/]) assert.ok(hasWarn(issues, re), String(re))
    assert.deepEqual([byId(model, 'p').location, byId(model, 'p').tz, byId(model, 'q').extra.pronouns], ['A', 'UTC', 'they'])
  })

  test('tags merge with a profile when the person writes them as a comma list', () => {
    const { model } = normalizeOrg({ profiles: { rev: { tags: ['payments'] } }, people: [{ name: 'A', extends: 'rev', tags: 'go, rust' }] })
    assert.deepEqual([...model.people[0].tags].sort(), ['go', 'payments', 'rust'])
  })
})

describe('person fields', () => {
  test('employment and status: aliases map, unknown values warn and fall back', () => {
    for (const [v, want] of [['FTE', 'employee'], ['Contract', 'contractor'], ['agency', 'vendor'], ['Internship', 'intern'], ['vendor', 'vendor']]) {
      const { p, issues } = one({ employment: v })
      assert.deepEqual([p.employment, issues], [want, []], v)
    }
    for (const [v, want] of [['vacancy', 'open'], ['On Leave', 'leave'], ['new hire', 'incoming'], ['ACTIVE', 'active']]) {
      const { p, issues } = one({ status: v })
      assert.deepEqual([p.status, issues], [want, []], v)
    }
    const e = one({ employment: 'pirate' })
    assert.ok(e.p.employment === 'employee' && hasWarn(e.issues, /employment "pirate"/))
    const s = one({ status: 'retired' })
    assert.ok(s.p.status === 'active' && hasWarn(s.issues, /status "retired"/))
  })

  test('email: one or a list, lowercased, deduplicated, invalid ones dropped with a warning', () => {
    assert.deepEqual(one({ email: 'ADA@EXAMPLE.ORG' }).p.email, ['ada@example.org'])
    const { p, issues } = one({ email: ['Ada@Example.org', 'ada@example.org', 'not-an-email', 'second@example.org'] })
    assert.deepEqual(p.email, ['ada@example.org', 'second@example.org'])
    assert.ok(hasWarn(issues, /"not-an-email" is not an email/))
  })

  test('country is a two-letter code', () => {
    const ok = one({ country: 'cl' })
    assert.deepEqual([ok.p.country, ok.issues], ['CL', []])
    for (const bad of ['C1', 'Chile', 'Germany']) {
      const { p, issues } = one({ country: bad })
      assert.equal(p.country, '', `${bad} is not a code`)
      assert.ok(hasWarn(issues, /two-letter code/), bad)
    }
  })

  test('tz is an IANA zone, UTC or an offset', () => {
    for (const tz of ['America/Santiago', 'America/Argentina/Buenos_Aires', 'Etc/GMT+3', 'UTC', '+2', '-03:30']) {
      const { p, issues } = one({ tz })
      assert.deepEqual([p.tz, issues], [tz, []], tz)
    }
    for (const tz of ['Mars time', 'America/', 'GMT plus two']) { const { p, issues } = one({ tz }); assert.ok(p.tz === '' && hasWarn(issues, /not an IANA zone/), tz) }
  })

  test('photo must be https', () => {
    assert.equal(one({ photo: 'https://img.example/ada.png' }).p.photo, 'https://img.example/ada.png')
    for (const bad of ['http://img.example/ada.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA']) {
      const { p, issues } = one({ photo: bad }); assert.ok(p.photo === '' && hasWarn(issues, /photo must be an https/), bad)
    }
  })

  test('start: a Date or a YYYY-MM-DD string, anything else is dropped', () => {
    const starts = [new Date(Date.UTC(2020, 10, 16)), '2020-11-16', '16/11/2020', new Date('nope')].map((start) => one({ start }).p.start)
    assert.deepEqual(starts, ['2020-11-16', '2020-11-16', '', ''])
  })

  test('extras: strings, numbers, lists and flat maps are kept; nesting is dropped', () => {
    const { p, issues } = one({ pronouns: 'she/her', floor: 3, oncall: true, languages: ['en', 'pt', { x: 1 }, null], links: { github: 'ada', site: 7 },
      deep: { a: { b: 1 } }, mixed: { ok: 'yes', no: { b: 1 } }, empty: '', nothing: null, hired: new Date(Date.UTC(2019, 0, 2)) })
    assert.deepEqual(issues, [])
    assert.deepEqual(p.extra, { pronouns: 'she/her', floor: '3', oncall: 'true', languages: ['en', 'pt'],
      links: { github: 'ada', site: '7' }, mixed: { ok: 'yes' }, hired: '2019-01-02' })
  })

  test('a near-miss key is kept as a detail and warned, unless it is a declared field', () => {
    const { model, issues } = normalizeOrg({ fields: { mail: 'Mail' }, people: ['Grace', { name: 'Ada', manger: 'grace', emial: 'a@b.example', mail: 'x' }] })
    const ada = byId(model, 'ada')
    assert.deepEqual([ada.manager, ada.extra], ['', { manger: 'grace', emial: 'a@b.example', mail: 'x' }])
    assert.ok(hasWarn(issues, /"manger" is kept as a detail\. Did you mean "manager"\?/))
    assert.ok(hasWarn(issues, /"emial".*Did you mean "email"/))
    assert.ok(!hasWarn(issues, /"mail"/))
  })
})

describe('the document around the people', () => {
  test('Floorplan-only keys warn once, unknown keys warn, neither is read', () => {
    const { issues } = normalizeOrg({ title: 'X', mode: 'diagram', bands: [], links: [], history: [], display: {}, peeple: [], people: [] })
    const fp = warns(issues).filter((m) => /Floorplan-only/.test(m))
    assert.equal(fp.length, 1)
    for (const k of ['mode', 'bands', 'links', 'history', 'display']) {
      assert.ok(fp[0].includes(k) && !hasWarn(issues, new RegExp(`Unknown top-level key "${k}"`)), k)
    }
    assert.ok(hasWarn(issues, /Unknown top-level key "peeple"/))
    assert.equal(warns(issues).length, 2)
  })

  test('a schema version newer than 1 warns; 1 does not', () => {
    assert.ok(hasWarn(normalizeOrg({ rama: 2, people: [] }).issues, /schema 2/))
    assert.deepEqual(normalizeOrg({ rama: 1, people: [] }).issues, [])
  })

  test('__proto__ and constructor keys never reach Object.prototype', () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort()
    const { model } = normalizeOrg(JSON.parse(`{ "__proto__": { "polluted": "top" },
      "roles": { "__proto__": { "title": "x", "polluted": "role" }, "constructor": { "title": "Ctor" } },
      "fields": { "__proto__": { "label": "x" }, "constructor": "C", "ok": "Ok" },
      "profiles": { "__proto__": { "polluted": "profile" }, "constructor": { "polluted": "ctor" } },
      "people": { "__proto__": { "name": "Proto", "polluted": "people" },
        "ada": { "name": "Ada", "extends": ["__proto__", "constructor"], "__proto__": { "polluted": "person" },
                 "constructor": { "prototype": { "polluted": "ctor" } }, "meta": { "__proto__": { "polluted": "x" }, "ok": "1" } } },
      "teams": [{ "name": "T", "members": [{ "__proto__": 50 }, { "ada": 40 }] }] }`))
    assert.equal(({}).polluted, undefined)
    assert.deepEqual(Object.getOwnPropertyNames(Object.prototype).sort(), before)
    assert.deepEqual(model.people.map((p) => p.id), ['ada'])
    const ada = model.people[0]
    assert.deepEqual([ada.extra, Object.keys(model.fields)], [{ meta: { ok: '1' } }, ['ok']])
    assert.equal(Object.getPrototypeOf(ada.extra.meta), Object.prototype)
    for (const k of ['__proto__', 'constructor']) {
      for (const [where, o] of [['roles', model.roles], ['fields', model.fields], ['person', ada], ['extra', ada.extra]]) assert.ok(!Object.hasOwn(o, k), `${where}.${k}`)
    }
    assert.deepEqual(model.teams[0].members, [{ person: 'ada', pct: 40, implied: false }])
  })
})

describe('personFinder', () => {
  test('finds by id, slug of a name, a name in any case, or an email', () => {
    const find = personFinder([{ id: 'g1', name: 'Grace Hopper', email: ['grace@navy.example'] }, { id: 'ada', name: 'Ada', email: [] }])
    for (const ref of ['g1', 'grace-hopper', 'Grace Hopper', 'GRACE HOPPER', 'Grace@Navy.example']) assert.equal(find(ref), 'g1', ref)
    assert.equal(find('ada'), 'ada')
    for (const ref of ['nobody', '', null, undefined, {}]) assert.equal(find(ref), null, String(ref))
  })
})

describe('teams', () => {
  test('nesting through teams: or groups:, leads resolve, ids are Floorplan slugs', () => {
    const { model, issues } = normalizeOrg({ people: ['Grace Hopper'], groups: [
      { name: 'Revenue Platform', lead: 'Grace Hopper', groups: [{ name: 'Next Gen', teams: [{ name: 'Core' }] }] }, { name: 'Ops', lead: 'nobody' }, 'Loose',
    ] })
    assert.deepEqual(model.teams.map((t) => [t.id, t.parent]), [['revenue-platform', ''], ['next-gen', 'revenue-platform'], ['core', 'next-gen'], ['ops', ''], ['loose', '']])
    assert.equal(model.teams[0].lead, 'grace-hopper')
    assert.deepEqual(warns(issues), ['Team Ops: lead "nobody" is not in people'])
  })

  test('teams nest at most six deep', () => {
    let root = { name: 'L7' }
    for (let i = 6; i >= 0; i--) root = { name: `L${i}`, teams: [root] }
    const { model, issues } = normalizeOrg({ people: [], teams: [root] })
    assert.ok(model.teams.length === 6 && hasWarn(issues, /nest at most 6/))
  })

  test('member forms, pct clamping and unknown members', () => {
    const { model, issues } = normalizeOrg({ people: ['Ada Lovelace', 'B', 'C', 'D', 'E', 'F', 'G'], teams: [{ name: 'T', members: [
      'Ada Lovelace', { person: 'b', pct: 150 }, { person: 'c', pct: 0 }, { d: -20 }, { e: 33.4 }, { person: 'f', pct: 'lots' }, { g: '40' },
      'ghost', { person: 'nobody', pct: 10 }, { x: 1, y: 2 },
    ] }] })
    assert.deepEqual(model.teams[0].members.map((m) => [m.person, m.pct, m.implied]), [
      ['ada-lovelace', 100, false], ['b', 100, false], ['c', 1, false], ['d', 1, false], ['e', 33, false], ['f', 100, false], ['g', 40, false],
    ])
    assert.ok(hasWarn(issues, /member "ghost" is not in people/) && hasWarn(issues, /member "nobody" is not in people/))
    // An unreadable share counts as 100 and says so.
    assert.ok(hasWarn(issues, /share "lots" is not a number/))
    assert.equal(warns(issues).length, 4)
  })

  test('a member with an empty pct counts as 100, like one with no pct', () => {
    const { model } = normalizeOrg({ people: ['A', 'B'], teams: [{ name: 'T', members: [{ person: 'a', pct: null }, { person: 'b' }] }] })
    assert.deepEqual(model.teams[0].members.map((m) => m.pct), [100, 100])
  })

  test('person.team joins at 100, matching by name or id, and creates unknown teams', () => {
    const { model, issues } = normalizeOrg({
      people: [{ name: 'Ada', team: 'Core' }, { name: 'Grace', team: 'core' }, { name: 'Alan', team: 'Research Lab' }, { name: 'Edsger', team: 'Core' }],
      teams: [{ name: 'Core', members: [{ person: 'edsger', pct: 50 }] }],
    })
    assert.deepEqual(issues, [])
    assert.deepEqual(model.teams[0].members.map((m) => [m.person, m.pct, m.implied]), [['edsger', 50, false], ['ada', 100, true], ['grace', 100, true]])
    const lab = model.teams.find((t) => t.name === 'Research Lab')
    assert.deepEqual([lab.id, lab.parent, lab.members], ['research-lab', '', [{ person: 'alan', pct: 100, implied: true }]])
    assert.deepEqual(model.people.map((p) => p.team), ['core', 'core', 'research-lab', 'core'])
  })

  test('two different non-Latin team names stay two teams', () => {
    const { model } = normalizeOrg({ people: [{ name: 'A', team: '開発' }, { name: 'B', team: '営業' }, { name: 'C', team: 'Разработка' }] })
    assert.equal(model.teams.length, 3)
    const teamOf = (p) => model.teams.find((t) => t.id === p.team)
    for (const p of model.people) assert.equal(teamOf(p).members.length, 1, `${teamOf(p).name} holds only ${p.id}`)
    assert.deepEqual(model.people.map((p) => teamOf(p).name), ['開発', '営業', 'Разработка'])
  })

  test('teamsToDoc nests, keeps Floorplan keys, and leaves implied members out', () => {
    const { model } = normalizeOrg({
      people: [{ name: 'Ada', team: 'Core' }, 'Grace', 'Alan'],
      teams: [{ name: 'Platform', id: 'plat', color: '#ABC', lead: 'Grace', owns: ['CI'], notes: 'n', capacity: 6, needs: ['sre'],
        layout: { x: 0, y: 1, w: 4, h: 2 }, teams: [{ name: 'Core', members: ['grace', { person: 'alan', pct: 30 }] }] }],
    })
    assert.deepEqual(teamsToDoc(model), [{
      name: 'Platform', id: 'plat', color: '#abc', lead: 'grace', owns: ['CI'], notes: 'n', capacity: 6, needs: ['sre'],
      layout: { x: 0, y: 1, w: 4, h: 2 }, teams: [{ name: 'Core', members: ['grace', { person: 'alan', pct: 30 }] }],
    }])
    assert.deepEqual(roundTrip(model).model, model)
  })

  test('normalizeTeams on its own: a non-list is an error', () => {
    const issues = []
    const ctx = { warn: (msg) => issues.push({ level: 'warn', msg }), error: (msg) => issues.push({ level: 'error', msg }) }
    const out = [normalizeTeams({ name: 'x' }, [], () => null, ctx), normalizeTeams(undefined, [], () => null, ctx)]
    assert.deepEqual([out, errors(issues)], [[[], []], ['teams: must be a list']])
  })

  const FP = join(ROOT, '..', 'floorplan-site', 'examples')
  const fpFiles = existsSync(FP) ? readdirSync(FP).filter((f) => /\.ya?ml$/.test(f)) : []
  test("Floorplan's own example documents import as teams with no errors", { skip: yamlSkip || (!fpFiles.length && 'floorplan-site is not checked out') }, () => {
    for (const file of fpFiles) {
      const raw = parseYaml(readFileSync(join(FP, file), 'utf8'))
      const { model, issues } = normalizeOrg(raw)
      assert.deepEqual(errors(issues), [], file)
      assert.ok(!hasWarn(issues, /not in people/), `${file}: every member resolves`)
      const flat = []
      const walk = (list) => { for (const g of list || []) { flat.push(g); walk(g.groups ?? g.teams) } }
      walk(raw.groups ?? raw.teams)
      assert.deepEqual(model.teams.map((t) => t.id), flat.map((g) => g.id || slug(g.name)), file)
      flat.forEach((g, i) => {
        assert.equal(model.teams[i].members.length, (g.members || []).length, `${file}: ${g.name}`)
        if (g.layout) assert.deepEqual(model.teams[i].floorplan.layout, g.layout, `${file}: ${g.name} layout`)
      })
    }
  })
})

describe('round trips beyond the sample', () => {
  test('a document that uses most of the schema comes back unchanged and canonical', () => {
    const { model } = normalizeOrg({
      title: 'Edge Co', notes: 'Notes',
      roles: { bard: { title: 'Bard', track: 'support', level: 'B1', color: '#123456', notes: 'sings' } },
      fields: { wiki: { label: 'Wiki', type: 'url', prefix: 'https://wiki.example/' }, secret: { label: 'Secret', hidden: true }, pronouns: 'Pronouns' },
      people: [
        { name: 'José Núñez', role: 'ceo', email: ['Jose@Edge.example', 'j@edge.example'], tags: 'founder, sales', start: '2019-01-02', wiki: 'jose', links: { gh: 'jn' }, languages: ['es', 'en'] },
        { name: 'José Núñez', manager: 'jose-nunez', role: 'bard', title: 'Lead Bard', employment: 'contractor', status: 'leave', country: 'cl', tz: 'America/Santiago', photo: 'https://img.example/j.png', pronounced: 'ho-SAY', notes: 'n', location: 'Santiago' },
        { status: 'open', role: 'engineer', manager: 'jose-nunez', team: 'Core' },
        { name: '李雷', role: 'Gardener', manager: 'jose-nunez-2', dotted: ['jose-nunez'], team: 'Garden Club' },
      ],
      teams: [{ name: 'Platform', id: 'plat', color: '#abcdef', lead: 'jose-nunez', owns: ['CI'], capacity: 5, teams: [{ name: 'Core', members: [{ person: 'jose-nunez', pct: 40 }, 'jose-nunez-2'] }] }],
    })
    const again = roundTrip(model)
    assert.deepEqual([again.issues, again.model], [[], model])
  })

  test('a person with a title and no role keeps exactly that title and role', () => {
    const { model } = normalizeOrg({ people: [{ name: 'Ada', title: 'Engineer' }, { name: 'Grace', title: 'Staff Engineer' }] })
    assert.deepEqual(model.people.map((p) => [p.role, p.title]), [['', 'Engineer'], ['', 'Staff Engineer']])
    assert.deepEqual(roundTrip(model).model, model)
  })

  test('a declared role that clears a built-in level keeps it cleared', () => {
    const { model } = normalizeOrg({ roles: { ceo: { title: 'Founder', level: '' } }, people: [{ name: 'A', role: 'ceo' }] })
    assert.equal(model.roles.ceo.level, '')
    assert.deepEqual(roundTrip(model).model, model)
  })
})
