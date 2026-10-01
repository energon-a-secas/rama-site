// Regressions: one test per defect the verification workflow confirmed and a
// later commit fixed, so each one stays fixed. The defect is named in the test.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOrg, orgToDoc } from '../js/schema.js'
import { guessTrack } from '../js/roles.js'
import { slug, str, isEmail, safeUrl, fieldHref, toBase64Url, fromBase64Url } from '../js/core.js'
import { parseCsv, csvToDoc, orgToCsv, orgToMermaid } from '../js/formats.js'

const warnings = (issues) => issues.filter((i) => i.level === 'warn').map((i) => i.msg)

describe('profiles', () => {
  test('a profile cycle resolves the same whoever extends it first', () => {
    const profiles = { a: { extends: 'b', location: 'A' }, b: { extends: 'a', location: 'B', tz: 'UTC' } }
    const one = normalizeOrg({ profiles, people: [{ name: 'X', extends: 'a' }, { name: 'Y', extends: 'b' }] }).model.people
    const two = normalizeOrg({ profiles, people: [{ name: 'Y', extends: 'b' }, { name: 'X', extends: 'a' }] }).model.people
    const byName = (list) => Object.fromEntries(list.map((p) => [p.name, [p.location, p.tz]]))
    assert.deepEqual(byName(one), byName(two))
  })

  test('a 200-deep profile chain warns instead of overflowing the stack', () => {
    const profiles = {}
    for (let i = 0; i < 200; i++) profiles[`p${i}`] = { extends: i < 199 ? `p${i + 1}` : undefined, location: `L${i}` }
    const { model, issues } = normalizeOrg({ profiles, people: [{ name: 'Deep', extends: 'p0' }] })
    assert.equal(model.people[0].location, 'L0')
    assert.ok(warnings(issues).some((m) => /more than 32 deep/.test(m)))
  })

  test('more than 20 extends warns', () => {
    const profiles = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${i}`, { tags: [`t${i}`] }]))
    const { issues } = normalizeOrg({ profiles, people: [{ name: 'Many', extends: Object.keys(profiles) }] })
    assert.ok(warnings(issues).some((m) => /extends 25 profiles; the first 20/.test(m)))
  })
})

describe('people', () => {
  test('padded keys cannot pass as reserved ones', () => {
    const { model } = normalizeOrg(JSON.parse('{"people":[{"name":"Ada"," name":"Eve"," __proto__":{"x":1},"manager ":"nobody"}]}'))
    const p = model.people[0]
    assert.equal(p.name, 'Ada')
    assert.equal(Object.getPrototypeOf(p.extra), Object.prototype)
    assert.deepEqual(Object.keys(p.extra), [])
  })

  test('a list where text belongs warns', () => {
    const { model, issues } = normalizeOrg({ people: [{ name: 'Ada', notes: ['a', 'b'], location: ['x'] }] })
    assert.equal(model.people[0].notes, '')
    assert.ok(warnings(issues).some((m) => /notes should be text, not a list/.test(m)))
  })

  test('tz is checked against real zones, start against real days', () => {
    const { model, issues } = normalizeOrg({ people: [
      { name: 'A', tz: 'America/Argentina/Buenos_Aires', start: '2024-02-29' },
      { name: 'B', tz: 'Mars/Base', start: '2024-02-30' },
      { name: 'C', start: '12/03/2024' },
    ] })
    assert.deepEqual(model.people.map((p) => [p.tz, p.start]), [['America/Argentina/Buenos_Aires', '2024-02-29'], ['', ''], ['', '']])
    const w = warnings(issues)
    assert.ok(w.some((m) => /Mars\/Base/.test(m)) && w.some((m) => /2024-02-30/.test(m)) && w.some((m) => /12\/03\/2024/.test(m)))
  })

  test('a near-miss key warns once, not once per person', () => {
    const people = Array.from({ length: 50 }, (_, i) => ({ name: `P${i}`, manger: 'x' }))
    const { issues } = normalizeOrg({ people })
    assert.equal(warnings(issues).filter((m) => /Did you mean "manager"/.test(m)).length, 1)
  })

  test('an open role keeps an explicit id that matches its name', () => {
    const { model } = normalizeOrg({ people: [{ name: 'Boss' }, { name: 'Open role', id: 'open-role', status: 'open', manager: 'boss' }] })
    const back = normalizeOrg(orgToDoc(model)).model
    assert.deepEqual(back.people.map((p) => p.id), ['boss', 'open-role'])
  })
})

describe('roles', () => {
  test('non-Latin and bare-string roles are kept', () => {
    const { model } = normalizeOrg({ roles: ['Payments Lead', { title: '開発者', track: 'ic' }], people: [{ name: 'A', role: '開発者' }, { name: 'B', role: 'Payments Lead' }] })
    assert.ok(model.declaredRoles.length === 2)
    assert.equal(model.people[0].title, '開発者')
    assert.ok(model.people[0].role.startsWith('r-'))
    assert.equal(model.people[1].role, 'payments-lead')
  })

  test('an invalid track on a built-in override keeps the built-in track', () => {
    const { model } = normalizeOrg({ roles: { 'eng-manager': { title: 'Team Lead', track: 'boss' } }, people: [] })
    assert.equal(model.roles['eng-manager'].track, 'management')
  })

  test('guessTrack: product managers are ic, assistants are support', () => {
    assert.equal(guessTrack('Senior Product Manager'), 'ic')
    assert.equal(guessTrack('Executive Assistant to the CEO'), 'support')
    assert.equal(guessTrack('Chief of Staff, Engineering'), 'support')
    assert.equal(guessTrack('VP Operations'), 'exec')
    assert.equal(guessTrack('Engineering Manager'), 'management')
  })
})

describe('teams, read the way Floorplan writes them', () => {
  test('a group extends a profile: colour, capacity and owns arrive, members add up', () => {
    const { model, issues } = normalizeOrg({
      profiles: { squad: { color: '#60a5fa', capacity: 6, owns: ['On-call'], members: ['ada'] } },
      people: ['Ada', 'Bo'],
      groups: [{ name: 'Kestrel', extends: 'squad', owns: ['Checkout'], members: ['bo'] }],
    })
    assert.deepEqual(issues, [])
    const t = model.teams[0]
    assert.deepEqual([t.color, t.floorplan.capacity, t.owns, t.members.map((m) => m.person)], ['#60a5fa', 6, ['On-call', 'Checkout'], ['ada', 'bo']])
  })

  test('member forms: { id, pct }, { name, percent }, and one scalar member or owner', () => {
    const { model } = normalizeOrg({ people: ['Ada', 'Bo', 'Cy'], teams: [
      { name: 'T', members: [{ id: 'ada', pct: 40 }, { name: 'Bo', percent: 60 }] },
      { name: 'U', members: 'cy', owns: 'Billing', needs: 'sre' },
    ] })
    assert.deepEqual(model.teams[0].members.map((m) => [m.person, m.pct]), [['ada', 40], ['bo', 60]])
    assert.deepEqual([model.teams[1].members.map((m) => m.person), model.teams[1].owns, model.teams[1].floorplan.needs], [['cy'], ['Billing'], ['sre']])
  })

  test('layout keeps only real numbers, and a partial layout survives', () => {
    const { model } = normalizeOrg({ people: [], teams: [
      { name: 'A', layout: { x: '', y: null, w: -4, h: 3 } },
      { name: 'B', layout: { x: 2, y: 0 } },
    ] })
    assert.deepEqual(model.teams.map((t) => t.floorplan.layout), [{ h: 3 }, { x: 2, y: 0 }])
  })

  test('more than 500 members warns', () => {
    const people = Array.from({ length: 520 }, (_, i) => `P${i}`)
    const { issues } = normalizeOrg({ people, teams: [{ name: 'Big', members: people }] })
    assert.ok(warnings(issues).some((m) => /only the first 500 members/.test(m)))
  })
})

describe('helpers', () => {
  test('slug folds letters NFKD leaves whole', () => {
    assert.equal(slug('Łukasz Søren Đorđe Straße Æsir'), 'lukasz-soren-dorde-strasse-aesir')
  })

  test('a capped value never ends in a space', () => {
    assert.equal(str('abc def', 4), 'abc')
  })

  test('isEmail refuses what would add a bcc or a body to mailto:', () => {
    for (const bad of ['a?bcc=x@y.com', 'a&b@c.com', 'a=b@c.com', 'a%40b@c.com', 'a@b.c/d']) assert.equal(isEmail(bad), false, bad)
    for (const good of ['ada@example.com', 'first.last+tag@sub.example.co']) assert.equal(isEmail(good), true, good)
  })

  test('tel: refuses a newline; a phone field needs three digits', () => {
    assert.equal(safeUrl('tel:+1 555\n0100', { tel: true }), '')
    assert.equal(fieldHref({ type: 'phone' }, '(.)-'), '')
    assert.equal(fieldHref({ type: 'phone' }, '+1 555 0100'), 'tel:+15550100')
  })

  test('base64url round-trips a leading byte-order mark', () => {
    assert.equal(fromBase64Url(toBase64Url('﻿title: x')), '﻿title: x')
  })
})

describe('CSV and Mermaid', () => {
  test('a quote that never closes is an error, not one giant cell', () => {
    assert.throws(() => parseCsv('name,notes\nAda,"open\nBo,x\n'), /never closes, starting on row 2/)
  })

  test('header aliases match with underscores, hyphens or none', () => {
    const doc = csvToDoc('Full_Name,Job-Title,ReportsTo,Hire_Date,DisplayName\nAda,CTO,,2024-01-02,x\n')
    assert.deepEqual(doc.people[0], { name: 'Ada', title: 'CTO', start: '2024-01-02' })
  })

  test('a blank first line does not decide the separator', () => {
    assert.deepEqual(parseCsv('\n\nname;team\nAda;Core\n'), [['name', 'team'], ['Ada', 'Core']])
  })

  test('the formula guard comes off on re-import', () => {
    const { model } = normalizeOrg({ fields: { phone: { type: 'phone' } }, people: [{ name: 'Ada', tz: '+2', phone: '+351 555 0100', handle: '@ada' }] })
    const back = normalizeOrg(csvToDoc(orgToCsv(model))).model.people[0]
    assert.deepEqual([back.tz, back.extra.phone, back.extra.handle], ['+2', '+351 555 0100', '@ada'])
  })

  test('a detail named toString exports as its own value, never a function', () => {
    const { model } = normalizeOrg({ people: [{ name: 'Ada', toString: 'x' }, { name: 'Bo' }] })
    const csv = orgToCsv(model)
    assert.ok(!/function/.test(csv), csv)
  })

  test('Mermaid: a backtick cannot start a markdown label, and big orgs stay under the size limit', () => {
    const one = orgToMermaid(normalizeOrg({ people: ['`Tick` Tock'] }).model)
    assert.ok(!one.includes('`'))
    const people = Array.from({ length: 400 }, (_, i) => ({ name: `Person ${i} ${'x'.repeat(70)}`, title: 'y'.repeat(70) }))
    const big = orgToMermaid(normalizeOrg({ people }).model)
    assert.ok(big.length < 50000, String(big.length))
    assert.match(big, /more people left out/)
  })
})
