// The pieces behind "You and them", search marks and the local-time colours:
// between() and matchRange() in tree.js, clockAt(), dayPart() and tzName() in
// core.js. Run: node --test test/connect.test.mjs
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOrg } from '../js/schema.js'
import { indexOrg, between, matchRange, searchPeople, ORG_ROOT } from '../js/tree.js'
import { clockAt, dayPart, tzName, slug } from '../js/core.js'

function build(doc) {
  const { model } = normalizeOrg(doc)
  return indexOrg(model)
}
const P = (id, manager) => ({ id, name: id, ...(manager ? { manager } : {}) })

// top > a > a1 > a11, top > a > a2, top > b > b1
const tree = () => build({ title: 'T', people: [P('top'), P('a', 'top'), P('a1', 'a'), P('a11', 'a1'), P('a2', 'a'), P('b', 'top'), P('b1', 'b')] })

describe('between', () => {
  test('cousins meet at the closest shared manager, with the route both ways', () => {
    const r = between(tree(), 'a11', 'b1')
    assert.equal(r.via, 'top')
    assert.deepEqual(r.up, ['a11', 'a1', 'a', 'top'])
    assert.deepEqual(r.down, ['top', 'b', 'b1'])
    assert.equal(r.steps, 5)
  })

  test('peers meet at their manager, two steps apart', () => {
    const r = between(tree(), 'a1', 'a2')
    assert.equal(r.via, 'a')
    assert.equal(r.steps, 2)
  })

  test('someone above: they are the meeting point and the way down is just them', () => {
    const r = between(tree(), 'a11', 'a')
    assert.equal(r.via, 'a')
    assert.deepEqual(r.up, ['a11', 'a1', 'a'])
    assert.deepEqual(r.down, ['a'])
    assert.equal(r.steps, 2)
  })

  test('someone below: the visitor is the meeting point and the way up is just them', () => {
    const r = between(tree(), 'top', 'a11')
    assert.equal(r.via, 'top')
    assert.deepEqual(r.up, ['top'])
    assert.equal(r.steps, 3)
  })

  test('the same person is zero steps from themselves', () => {
    assert.equal(between(tree(), 'a1', 'a1').steps, 0)
  })

  test('two separate trees meet only at the virtual top', () => {
    const ix = build({ title: 'Two', people: [P('x'), P('x1', 'x'), P('y')] })
    const r = between(ix, 'x1', 'y')
    assert.equal(r.via, ORG_ROOT)
    assert.equal(r.steps, 3)
  })

  test('an unknown id has no route', () => {
    assert.equal(between(tree(), 'a1', 'nobody'), null)
    assert.equal(between(tree(), 'nobody', 'a1'), null)
  })
})

describe('matchRange', () => {
  const hit = (text, q) => {
    const r = matchRange(text, q)
    return r && text.slice(r[0], r[1])
  }

  test('marks the original letters of an accent-folded hit', () => {
    assert.equal(hit('José Pérez', 'jose p'), 'José P')
    assert.equal(hit('Ana Núñez', 'nun'), 'Núñ')
  })

  test('letters NFKD leaves whole fold like they do in ids', () => {
    assert.equal(hit('Łukasz Nowak', 'luk'), 'Łuk')
    assert.equal(hit('Straße 9', 'strasse'), 'Straße')
    assert.equal(hit('Søren', 'soren'), 'Søren')
  })

  test('is case-insensitive and finds a hit mid-word', () => {
    assert.equal(hit('Head of Customer Engineering', 'ENG'), 'Eng')
  })

  test('never splits an emoji or a surrogate pair', () => {
    const r = matchRange('Zoë 😀 Li', 'li')
    assert.deepEqual(r, [7, 9])
  })

  test('no query or no hit is null', () => {
    assert.equal(matchRange('Ben', ''), null)
    assert.equal(matchRange('Ben', '   '), null)
    assert.equal(matchRange('Ben', 'zed'), null)
    assert.equal(matchRange(undefined, 'a'), null)
  })
})

describe('search folds ł and ß too', () => {
  test('"lukasz" finds Łukasz and "strasse" finds a Straße office', () => {
    const ix = build({ title: 'S', people: [{ id: 'l', name: 'Łukasz Nowak' }, { id: 's', name: 'Ana Ruiz', manager: 'l', location: 'Hauptstraße 1' }] })
    assert.deepEqual(searchPeople(ix, 'lukasz'), ['l'])
    assert.deepEqual(searchPeople(ix, 'strasse'), ['s'])
  })

  test('ids are unchanged by the shared helper', () => {
    assert.equal(slug('Łukasz Strauß'), 'lukasz-strauss')
  })
})

describe('clockAt and dayPart', () => {
  // Monday 5 October 2026, 14:00 UTC.
  const monday = new Date('2026-10-05T14:00:00Z')

  test('an IANA zone gives the hour and weekday there', () => {
    assert.deepEqual(clockAt('Asia/Tokyo', monday), { hour: 23, day: 1 })
    assert.deepEqual(clockAt('America/Los_Angeles', monday), { hour: 7, day: 1 })
  })

  test('offsets work, half hours included, and can cross midnight', () => {
    assert.deepEqual(clockAt('+5:30', monday), { hour: 19.5, day: 1 })
    assert.deepEqual(clockAt('+11', monday), { hour: 1, day: 2 })
    assert.deepEqual(clockAt('-3', monday), { hour: 11, day: 1 })
  })

  test('no zone or an unknown one has no clock', () => {
    assert.equal(clockAt('', monday), null)
    assert.equal(clockAt('Mars/Olympus', monday), null)
  })

  test('the parts of a weekday', () => {
    assert.equal(dayPart({ hour: 9, day: 1 }), 'work')
    assert.equal(dayPart({ hour: 17.99, day: 5 }), 'work')
    assert.equal(dayPart({ hour: 8, day: 2 }), 'edge')
    assert.equal(dayPart({ hour: 18, day: 3 }), 'edge')
    assert.equal(dayPart({ hour: 22, day: 4 }), 'night')
    assert.equal(dayPart({ hour: 6.5, day: 1 }), 'night')
  })

  test('a weekend still shows who is asleep: night outranks the weekend', () => {
    assert.equal(dayPart({ hour: 12, day: 6 }), 'weekend')
    assert.equal(dayPart({ hour: 12, day: 0 }), 'weekend')
    assert.equal(dayPart({ hour: 3, day: 0 }), 'night')
  })

  test('no clock is none', () => {
    assert.equal(dayPart(null), 'none')
  })
})

describe('tzName', () => {
  test('whole-hour offsets become Etc zones with the sign flipped, as POSIX has it', () => {
    assert.equal(tzName('+2'), 'Etc/GMT-2')
    assert.equal(tzName('-3:00'), 'Etc/GMT+3')
  })

  test('IANA names pass through and a half-hour offset throws', () => {
    assert.equal(tzName('Europe/Lisbon'), 'Europe/Lisbon')
    assert.throws(() => tzName('+5:30'))
  })
})
