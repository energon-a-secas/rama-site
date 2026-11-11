// The Neorgon Workspace adapter (js/ws-adapter.js) and the settings it feeds
// (dayPart with a working day, relativeTo, hourCycleOf, resolveMe's fourth
// way). Payloads are fed to the REAL consumer, the vendored kit's
// normalizeWorkspace, previewMerge and payload codec, so a change on either
// side that breaks the contract fails here.
// Run: node --test test/workspace.test.mjs
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, sampleRaw, yamlSkip } from './helpers.mjs'
import { normalizeOrg } from '../js/schema.js'
import { indexOrg } from '../js/tree.js'
import { dayPart, relativeTo, hourCycleOf, offsetMinutes, WORK_DAY } from '../js/core.js'
import { resolveMe } from '../js/me.js'
import { wsId, toWorkspace, scopePeople, hasTeam, meFromWorkspace, ramaPrefs, TOOL } from '../js/ws-adapter.js'
import * as W from '../js/neorgon-workspace-core.js'

const build = (doc) => indexOrg(normalizeOrg(doc).model)
const P = (id, manager, extra = {}) => ({ id, name: id.replace(/-/g, ' '), ...(manager ? { manager } : {}), ...extra })
const small = () => build({
  title: 'T',
  people: [
    P('ana-rojas', null, { email: 'ana@x.example', title: 'CEO', tz: 'America/Santiago', country: 'CL', location: 'Santiago', tags: ['exec'] }),
    P('ben', 'ana-rojas', { email: 'ben@x.example', tz: '+2' }),
    P('cy', 'ana-rojas'),
    P('dee', 'ben'),
    { name: 'Open seat', manager: 'ben', status: 'open' },
  ],
  teams: [{ name: 'Core', color: '#0f0', lead: 'ben', members: ['ben', 'dee', { person: 'cy', pct: 50 }] }],
})
const errors = (issues) => issues.filter((i) => i.level === 'error')

describe('wsId', () => {
  test('prefixes the tool and a kind', () => {
    assert.equal(TOOL, 'rama')
    assert.equal(wsId('ana-rojas'), 'rama-ana-rojas')
    assert.equal(wsId('core', 'team'), 'rama-team-core')
    assert.equal(wsId('ana', 'line'), 'rama-line-ana')
  })

  test('a long id stays within 48, stays a valid workspace id, and is the same every time', () => {
    const long = 'a'.repeat(30) + '-' + 'b'.repeat(17)
    const id = wsId(long)
    assert.ok(id.length <= 48, id)
    assert.equal(id, wsId(long))
    assert.ok(W.isId(id), id)
  })

  test('two long ids that share a head do not collide', () => {
    const head = 'x'.repeat(46)
    assert.notEqual(wsId(`${head}-1`), wsId(`${head}-2`))
  })
})

describe('scopePeople', () => {
  test('a manager and their direct reports, never an open seat', () => {
    const ix = small()
    assert.deepEqual(scopePeople(ix, 'ben'), ['ben', 'dee'])
    assert.equal(hasTeam(ix, 'ben'), true)
    assert.equal(hasTeam(ix, 'dee'), false)
    assert.deepEqual(scopePeople(ix, 'nobody'), [])
  })

  test('the whole org is everyone but open seats', () => {
    assert.deepEqual(scopePeople(small(), 'org').sort(), ['ana-rojas', 'ben', 'cy', 'dee'])
  })
})

describe('toWorkspace: a manager\'s direct team', () => {
  const ix = small()
  const out = toWorkspace(ix, 'ana-rojas', { meId: 'ben' })

  test('people carry the Schema v1 fields Rama knows', () => {
    const ana = out.people.find((p) => p.id === 'rama-ana-rojas')
    assert.deepEqual(ana, { id: 'rama-ana-rojas', name: 'ana rojas', title: 'CEO', email: 'ana@x.example', tz: 'America/Santiago', country: 'CL', location: 'Santiago', tags: ['exec'] })
    assert.equal(out.people.find((p) => p.id === 'rama-ben').manager, 'rama-ana-rojas')
  })

  test('the reporting line is one team, "<name>\'s team", led by the manager', () => {
    assert.equal(out.teams.length, 1)
    const t = out.teams[0]
    assert.equal(t.id, 'rama-line-ana-rojas')
    assert.equal(t.name, "ana rojas's team")
    assert.equal(t.lead, 'rama-ana-rojas')
    assert.deepEqual(t.members.map((m) => m.person), ['rama-ana-rojas', 'rama-ben', 'rama-cy'])
  })

  test('a direct team carries no document team, so it cannot shrink one saved with the org', () => {
    assert.ok(!out.teams.some((t) => t.id.startsWith('rama-team-')))
  })

  test('me is written when the visitor\'s card is in the payload, and only then', () => {
    assert.deepEqual(out.me, { person: 'rama-ben' })
    assert.equal(toWorkspace(ix, 'ben', { meId: 'cy' }).me, undefined)
  })

  test('the kit reads it with no errors and keeps every id', () => {
    const { ws, issues } = W.normalizeWorkspace(out)
    assert.deepEqual(errors(issues), [])
    assert.deepEqual(ws.people.map((p) => p.id), out.people.map((p) => p.id))
    assert.equal(ws.me.person, 'rama-ben')
  })
})

describe('toWorkspace: the whole org', () => {
  const ix = small()
  const out = toWorkspace(ix, 'org')

  test('document teams come first, with #rgb colours widened and shares kept', () => {
    const core = out.teams[0]
    assert.equal(core.id, 'rama-team-core')
    assert.equal(core.color, '#00ff00')
    assert.equal(core.lead, 'rama-ben')
    assert.deepEqual(core.members.find((m) => m.person === 'rama-cy'), { person: 'rama-cy', pct: 50 })
  })

  test('then one reporting-line team per manager', () => {
    assert.deepEqual(out.teams.slice(1).map((t) => t.id).sort(), ['rama-line-ana-rojas', 'rama-line-ben'])
  })

  test('a manager\'s team saved after the org changes no document team', () => {
    const first = W.previewMerge(W.normalizeWorkspace({}).ws, out).next
    const then = W.previewMerge(first, toWorkspace(ix, 'ben')).next
    assert.deepEqual(then.teams.find((t) => t.id === 'rama-team-core'), first.teams.find((t) => t.id === 'rama-team-core'))
  })

  test('saving the same org twice adds nobody and changes nothing', () => {
    const first = W.previewMerge(W.normalizeWorkspace({}).ws, out)
    assert.equal(first.added.length, 4)
    const again = W.previewMerge(first.next, toWorkspace(ix, 'org'))
    assert.deepEqual(again.added, [])
    assert.deepEqual(again.updated, [])
  })

  test('a person another tool saved with the same email is updated, not duplicated', () => {
    const stored = W.normalizeWorkspace({ people: [{ id: 'floorplan-p3', name: 'Ana R.', email: 'ana@x.example' }] }).ws
    const m = W.previewMerge(stored, out)
    assert.equal(m.next.people.filter((p) => p.email === 'ana@x.example').length, 1)
  })

  test('it survives the link codec both ways', async () => {
    const text = await W.encodePayload(out)
    const got = W.previewPayload(W.normalizeWorkspace({}).ws, text)
    assert.equal(got.next.people.length, 4)
  })

  test('the sample org reads with no errors and fits one link', { skip: yamlSkip }, async () => {
    const big = indexOrg(normalizeOrg(sampleRaw()).model)
    const payload = toWorkspace(big, 'org')
    const { ws, issues } = W.normalizeWorkspace(payload)
    assert.deepEqual(errors(issues), [])
    assert.equal(ws.people.length, big.model.people.filter((p) => p.status !== 'open').length)
    assert.ok(ws.teams.length <= W.LIMITS.teams)
    assert.ok((await W.encodePayload(payload)).length < W.MAX_LINK)
  })
})

describe('toWorkspace: caps and hostile values', () => {
  test('at most 500 people and 100 teams', () => {
    const people = [P('top')]
    for (let i = 0; i < 600; i++) people.push(P(`m${i}`, 'top'), ...(i < 150 ? [P(`r${i}`, `m${i}`)] : []))
    const out = toWorkspace(build({ title: 'Big', people }), 'org')
    assert.equal(out.people.length, 500)
    assert.ok(out.teams.length <= 100)
    assert.deepEqual(errors(W.normalizeWorkspace(out).issues), [])
  })

  test('only a neoav1 avatar is carried; a photo URL never is', () => {
    const ix = build({ title: 'T', people: [P('a', null, { avatar: 'neoav1:abc_DEF-1', photo: 'https://x.example/a.jpg' }), P('b', 'a', { avatar: 'javascript:alert(1)' })] })
    const out = toWorkspace(ix, 'a')
    assert.equal(out.people[0].avatar, 'neoav1:abc_DEF-1')
    assert.equal(out.people[1].avatar, undefined)
    assert.ok(!JSON.stringify(out).includes('x.example/a.jpg'))
  })

  test('markup in a name stays text all the way through the kit', () => {
    const ix = build({ title: 'T', people: [P('a', null, { name: '<img src=x onerror=alert(1)>' }), P('b', 'a')] })
    const { ws } = W.normalizeWorkspace(toWorkspace(ix, 'a'))
    assert.equal(ws.people[0].name, '<img src=x onerror=alert(1)>')
  })
})

describe('meFromWorkspace', () => {
  const ix = small()
  const ws = (me, people) => W.normalizeWorkspace({ me: { person: me }, people }).ws

  test('a workspace id Rama made finds that card', () => {
    assert.equal(meFromWorkspace(ws('rama-ben', [{ id: 'rama-ben', name: 'Ben' }]), ix), 'ben')
  })

  test('another tool\'s person is found by email', () => {
    assert.equal(meFromWorkspace(ws('floorplan-p3', [{ id: 'floorplan-p3', name: 'Ana', email: 'ANA@x.example' }]), ix), 'ana-rojas')
  })

  test('nobody, garbage or an unknown person finds no card', () => {
    assert.equal(meFromWorkspace(null, ix), '')
    assert.equal(meFromWorkspace({ me: { person: 'x' }, people: 'nope' }, ix), '')
    assert.equal(meFromWorkspace(ws('zed', [{ id: 'zed', name: 'Zed', email: 'zed@y.example' }]), ix), '')
    assert.equal(meFromWorkspace(ws('', [{ id: 'rama-ben', name: 'Ben' }]), ix), '')
  })
})

describe('resolveMe: the workspace is the fourth way', () => {
  const ix = small()
  test('it applies only when nothing stronger names a card', () => {
    assert.deepEqual(resolveMe(ix, { workspace: 'ben' }), { id: 'ben', source: 'workspace' })
    assert.deepEqual(resolveMe(ix, { picked: 'cy', workspace: 'ben' }), { id: 'cy', source: 'picked' })
    assert.deepEqual(resolveMe(ix, { emails: ['ana@x.example'], workspace: 'ben' }), { id: 'ana-rojas', source: 'account' })
    assert.deepEqual(resolveMe(ix, { workspace: 'no-such-card' }), { id: null, source: null })
  })
})

describe('ramaPrefs', () => {
  test('keeps the four settings Rama reads', () => {
    assert.deepEqual(ramaPrefs({ tz: 'Europe/Lisbon', h: [480, 1020], d: '1234', c: 'h12', w: 7, cc: 'PT' }), { tz: 'Europe/Lisbon', h: [480, 1020], d: '1234', c: 'h12' })
  })

  test('garbage falls back to Rama\'s working day and the locale\'s format', () => {
    assert.deepEqual(ramaPrefs(null), { tz: '', h: [540, 1080], d: '12345', c: '' })
    assert.deepEqual(ramaPrefs({ tz: 5, h: [600, 500], d: '189', c: '<b>' }), { tz: '', h: [540, 1080], d: '12345', c: '' })
    assert.deepEqual(ramaPrefs({ h: [0, 1441] }).h, [540, 1080])
  })

  test('the kit\'s device defaults read cleanly', () => {
    const p = ramaPrefs(W.withDefaults({}))
    assert.ok(p.h[0] < p.h[1])
    assert.match(p.d, /^[1-7]+$/)
  })
})

describe('dayPart with the visitor\'s working day', () => {
  const four = { h: [480, 960], d: '1234' } // 08:00 to 16:00, Monday to Thursday
  test('the default is Rama\'s 09:00 to 18:00, Monday to Friday', () => {
    assert.deepEqual(WORK_DAY, { h: [540, 1080], d: '12345' })
    assert.equal(dayPart({ hour: 17.5, day: 5 }), 'work')
  })

  test('hours and days come from the settings', () => {
    assert.equal(dayPart({ hour: 8, day: 1 }, four), 'work')
    assert.equal(dayPart({ hour: 16.5, day: 2 }, four), 'edge')
    assert.equal(dayPart({ hour: 12, day: 5 }, four), 'weekend') // Friday is a day off
    assert.equal(dayPart({ hour: 12, day: 0 }, { h: [540, 1020], d: '7' }), 'work') // ISO 7 is Sunday
  })

  test('working hours inside the night count as work, and night widens around them', () => {
    const early = { h: [300, 780], d: '12345' } // 05:00 to 13:00
    assert.equal(dayPart({ hour: 5.5, day: 3 }, early), 'work')
    assert.equal(dayPart({ hour: 4.5, day: 3 }, early), 'night')
    assert.equal(dayPart({ hour: 23, day: 3 }, { h: [600, 1410], d: '12345' }), 'work')
  })

  test('the widening holds on work days only: a day off keeps the 22 to 7 night', () => {
    const allDay = { h: [0, 1440], d: '12345' }
    assert.equal(dayPart({ hour: 3, day: 3 }, allDay), 'work')
    assert.equal(dayPart({ hour: 3, day: 6 }, allDay), 'night')
    assert.equal(dayPart({ hour: 23, day: 0 }, allDay), 'night')
    assert.equal(dayPart({ hour: 12, day: 6 }, allDay), 'weekend')
    assert.equal(dayPart({ hour: 3, day: 6 }, { h: [300, 780], d: '12345' }), 'night') // 03:00 on a Saturday
    assert.equal(dayPart({ hour: 6, day: 6 }, { h: [300, 780], d: '12345' }), 'night') // the early widening is not carried over
  })
})

describe('relativeTo and hourCycleOf', () => {
  const now = new Date('2026-01-15T12:00:00Z')
  test('measured against the visitor\'s zone, offsets included', () => {
    assert.equal(relativeTo('+3', 'UTC', now), '3 hours ahead of you')
    assert.equal(relativeTo('Europe/Lisbon', 'America/Santiago', now), '3 hours ahead of you') // January: UTC and UTC-3
    assert.equal(relativeTo('UTC', '+1', now), '1 hour behind you')
    assert.equal(relativeTo('+5:30', 'UTC', now), '5.5 hours ahead of you')
    assert.equal(relativeTo('UTC', 'UTC', now), 'same time as you')
  })

  test('a zone that does not read gives no comparison', () => {
    assert.equal(relativeTo('Mars/Base', 'UTC', now), '')
    assert.equal(offsetMinutes('', now), null)
  })

  test('only h12 and h23 reach Intl', () => {
    assert.equal(hourCycleOf('h12'), 'h12')
    assert.equal(hourCycleOf('h23'), 'h23')
    assert.equal(hourCycleOf(''), undefined)
    assert.equal(hourCycleOf('h11'), undefined)
  })
})

describe('the wiring module', () => {
  const src = readFileSync(join(ROOT, 'js/workspace.js'), 'utf8')
  test('builds its part of the sheet with textContent only', () => {
    assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/)
  })

  test('the CSP lets the workspace frame load, and nothing broader', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    const frame = /frame-src ([^;]+);/.exec(html)[1].split(/\s+/)
    assert.deepEqual(frame.sort(), ['http://localhost:*', 'https://challenges.cloudflare.com', 'https://neorgon.com'])
  })
})
