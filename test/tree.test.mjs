// tree.js: the reporting tree every view reads. These assert the contract in
// the header comments (one root per chart, virtual top only for zero or 2+
// people without a manager, iterative walks, search ranking), not the code's
// current output. Run: node --test test/tree.test.mjs
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOrg } from '../js/schema.js'
import { indexOrg, focusView, splitReports, searchPeople, isExternal, ORG_ROOT } from '../js/tree.js'
import { sampleRaw, yamlSkip } from './helpers.mjs'

/** A document through the same gate the page uses, then indexed. */
function build(doc) {
  const { model, issues } = normalizeOrg(doc)
  assert.deepEqual(issues.filter((i) => i.level === 'error'), [], 'fixture should normalize cleanly')
  return indexOrg(model)
}
/** A person whose name is their id, so structural fixtures never collide with search queries. */
const P = (id, manager, extra = {}) => ({ id, name: id, ...(manager ? { manager } : {}), ...extra })

let sampleIx = null
const sample = () => (sampleIx ??= build(sampleRaw()))
const openUnder = (ix, manager) => ix.model.people.filter((p) => p.status === 'open' && p.manager === manager).map((p) => p.id)

// Several roots: a > c > d, b alone, e alone.
const twin = () => build({ title: 'Twin Org', people: [P('a'), P('b'), P('c', 'a'), P('d', 'c'), P('e')] })

describe('ORG_ROOT and isExternal', () => {
  test('a person can never take the virtual root id', () => {
    const ix = build({ title: 'Clash', people: [{ id: ORG_ROOT, name: 'Sneaky' }, P('other')] })
    assert.ok(!ix.model.people.some((p) => p.id === ORG_ROOT))
    assert.equal(ix.top, ORG_ROOT)
    assert.equal(ix.byId.get(ORG_ROOT).virtual, true)
    assert.equal(ix.kids(ORG_ROOT).length, 2)
  })

  test('contractors and vendors are external; employees and interns are not', () => {
    assert.equal(isExternal({ employment: 'contractor' }), true)
    assert.equal(isExternal({ employment: 'vendor' }), true)
    assert.equal(isExternal({ employment: 'employee' }), false)
    assert.equal(isExternal({ employment: 'intern' }), false)
  })
})

describe('indexOrg: one root per chart', () => {
  test('a single root is the top and no virtual root appears', () => {
    const ix = build({ title: 'Solo', people: [P('boss'), P('x', 'boss'), P('y', 'boss')] })
    assert.equal(ix.virtual, false)
    assert.equal(ix.top, 'boss')
    assert.deepEqual(ix.roots, ['boss'])
    assert.equal(ix.has(ORG_ROOT), false)
    assert.deepEqual(ix.kids(ORG_ROOT), [])
    assert.equal(ix.parentOf('boss'), null)
    assert.deepEqual(ix.chain('boss'), ['boss'])
    assert.deepEqual(ix.chain('x'), ['boss', 'x'])
  })

  test('several roots hang under a virtual root named after the org, which is never a model person', () => {
    const ix = twin()
    assert.equal(ix.virtual, true)
    assert.equal(ix.top, ORG_ROOT)
    assert.deepEqual(ix.roots, ['a', 'b', 'e'])
    assert.deepEqual(ix.kids(ORG_ROOT), ['a', 'b', 'e'])
    const v = ix.byId.get(ORG_ROOT)
    assert.equal(v.virtual, true)
    assert.equal(v.name, 'Twin Org')
    assert.equal(ix.model.people.length, 5)
    assert.ok(!ix.model.people.some((p) => p.id === ORG_ROOT || p.virtual))
    assert.equal(ix.stats.people, 5, 'the virtual root is not counted as a person')
  })

  test('the chain of a person under several roots goes through the virtual root', () => {
    const ix = twin()
    assert.equal(ix.parentOf('a'), ORG_ROOT)
    assert.equal(ix.parentOf('b'), ORG_ROOT)
    assert.equal(ix.parentOf(ORG_ROOT), null)
    assert.equal(ix.parentOf('d'), 'c')
    assert.deepEqual(ix.chain('d'), [ORG_ROOT, 'a', 'c', 'd'])
    assert.deepEqual(ix.chain('b'), [ORG_ROOT, 'b'])
    assert.deepEqual(ix.chain(ORG_ROOT), [ORG_ROOT])
    assert.equal(ix.depth.get(ORG_ROOT), 0)
    assert.equal(ix.depth.get('a'), 1)
    assert.equal(ix.depth.get('d'), 3)
    assert.equal(ix.size.get(ORG_ROOT), 5)
    assert.equal(ix.size.get('a'), 2)
    assert.equal(ix.size.get('e'), 0)
  })

  test('the virtual root falls back to "Organization" when the org has no title', () => {
    const { model } = normalizeOrg({ people: [P('a'), P('b')] })
    model.title = ''
    assert.equal(indexOrg(model).byId.get(ORG_ROOT).name, 'Organization')
  })

  test('a manager who is not in the model leaves the person at the top', () => {
    const { model } = normalizeOrg({ title: 'Ghost', people: [P('a'), P('b', 'a')] })
    model.people[1].manager = 'ghost'
    const ix = indexOrg(model)
    assert.equal(ix.virtual, true)
    assert.deepEqual(ix.roots, ['a', 'b'])
    assert.deepEqual(ix.chain('b'), [ORG_ROOT, 'b'])
  })

  test('an empty org gets a virtual root with no reports and zeroed numbers', () => {
    const ix = build({ title: 'Empty', people: [] })
    assert.equal(ix.virtual, true)
    assert.equal(ix.top, ORG_ROOT)
    assert.deepEqual(ix.roots, [])
    assert.deepEqual(ix.kids(ORG_ROOT), [])
    assert.equal(ix.byId.get(ORG_ROOT).name, 'Empty')
    assert.deepEqual(ix.chain(ORG_ROOT), [ORG_ROOT])
    assert.equal(ix.size.get(ORG_ROOT), 0)
    assert.deepEqual(ix.stats, {
      people: 0, open: 0, external: 0, managers: 0, medianSpan: 0, widestSpan: 0, levels: 0, countries: 0, teams: 0,
    })
    const v = focusView(ix, 'anyone')
    assert.equal(v.focus, ORG_ROOT)
    assert.equal(v.parent, ORG_ROOT)
    assert.deepEqual(v.row, [])
    assert.deepEqual(v.chain, [])
    assert.deepEqual(v.columns, [])
    assert.deepEqual([...v.path], [ORG_ROOT])
    assert.deepEqual(searchPeople(ix, 'empty'), [])
  })
})

describe('chain, parentOf, branchOf on the sample', () => {
  test('chain runs top first and ends at the person', { skip: yamlSkip }, () => {
    const ix = sample()
    assert.equal(ix.virtual, false)
    assert.equal(ix.top, 'noor-haddad')
    assert.deepEqual(ix.chain('ezra-nakamura'),
      ['noor-haddad', 'tomas-aguilar', 'priya-raman', 'hana-kobayashi', 'sofia-lindqvist', 'ezra-nakamura'])
    assert.deepEqual(ix.chain('theo-marchetti'), ['noor-haddad', 'elena-petrova', 'camille-laurent', 'theo-marchetti'])
    assert.deepEqual(ix.chain('nobody-here'), [])
  })

  test('parentOf is the manager, and null at the top', { skip: yamlSkip }, () => {
    const ix = sample()
    assert.equal(ix.parentOf('noor-haddad'), null)
    assert.equal(ix.parentOf('tomas-aguilar'), 'noor-haddad')
    assert.equal(ix.parentOf('ezra-nakamura'), 'sofia-lindqvist')
    for (const p of ix.model.people) {
      if (p.id !== ix.top) assert.equal(ix.parentOf(p.id), p.manager, p.id)
    }
  })

  test('branchOf is the first person below the top on the way down', { skip: yamlSkip }, () => {
    const ix = sample()
    assert.equal(ix.branchOf('ezra-nakamura'), 'tomas-aguilar')
    assert.equal(ix.branchOf('theo-marchetti'), 'elena-petrova')
    assert.equal(ix.branchOf('kofi-asante'), 'grace-whitfield')
    assert.equal(ix.branchOf('tomas-aguilar'), 'tomas-aguilar')
    assert.equal(ix.branchOf('noor-haddad'), 'noor-haddad')
  })

  test('branchOf under a virtual root is a real root, never the virtual one', () => {
    const ix = twin()
    assert.equal(ix.branchOf('d'), 'a')
    assert.equal(ix.branchOf('a'), 'a')
    assert.equal(ix.branchOf('b'), 'b')
  })
})

describe('depth and org size', () => {
  test('depth counts steps from the top; size counts the people below, never open seats', { skip: yamlSkip }, () => {
    const ix = sample()
    assert.equal(ix.depth.get('noor-haddad'), 0)
    assert.equal(ix.depth.get('tomas-aguilar'), 1)
    assert.equal(ix.depth.get('ezra-nakamura'), 5)
    assert.equal(ix.size.get('kwame-mensah'), 10)
    assert.equal(ix.size.get('sofia-lindqvist'), 3)
    assert.equal(ix.size.get('ezra-nakamura'), 0)
    for (const p of ix.model.people) {
      assert.equal(ix.depth.get(p.id), ix.chain(p.id).length - 1, `depth of ${p.id}`)
      const below = ix.kids(p.id).reduce((n, c) => n + (ix.byId.get(c).status === 'open' ? 0 : 1) + ix.size.get(c), 0)
      assert.equal(ix.size.get(p.id), below, `size of ${p.id}`)
    }
    // The top's org plus the top is the stage bar's headcount: the three vacancies are seats, not people.
    assert.equal(ix.size.get(ix.top) + 1, ix.stats.people)
    assert.equal(ix.size.get('rafael-costa'), 1, 'Aisha, and not the open security role')
  })

  test('a 5000-deep chain indexes without overflowing the stack', () => {
    const people = []
    for (let i = 4999; i >= 0; i--) people.push(P(`p${i}`, i ? `p${i - 1}` : null))
    const ix = build({ title: 'Deep', people })
    assert.equal(ix.top, 'p0')
    assert.equal(ix.depth.get('p4999'), 4999)
    assert.equal(ix.size.get('p0'), 4999)
    assert.equal(ix.size.get('p2500'), 2499)
    assert.equal(ix.size.get('p4999'), 0)
    assert.equal(ix.stats.levels, 5000)
    assert.equal(ix.stats.medianSpan, 1)
    const chain = ix.chain('p4999')
    assert.equal(chain.length, 5000)
    assert.equal(chain[0], 'p0')
    assert.equal(chain[4999], 'p4999')
    assert.equal(ix.branchOf('p4999'), 'p1')
    const v = focusView(ix, 'p4999')
    assert.equal(v.parent, 'p4998')
    assert.deepEqual(v.row, ['p4999'])
    assert.equal(v.chain.length, 4998)
    assert.equal(v.path.size, 5000)
    assert.deepEqual(searchPeople(ix, 'p4999'), ['p4999'])
  })
})

describe('teamsOf', () => {
  test('a person on several teams carries each split pct; a team: line joins at 100', () => {
    const ix = build({
      title: 'Split',
      people: [P('lead'), P('a', 'lead'), P('b', 'lead', { team: 'Edge' }), P('c', 'lead')],
      teams: [
        { name: 'Core', members: [{ person: 'a', pct: 60 }] },
        { name: 'Edge', members: [{ person: 'a', pct: 40 }] },
      ],
    })
    assert.deepEqual(ix.teamsOf.get('a'), [{ team: 'core', pct: 60 }, { team: 'edge', pct: 40 }])
    assert.deepEqual(ix.teamsOf.get('b'), [{ team: 'edge', pct: 100 }])
    assert.equal((ix.teamsOf.get('c') || []).length, 0)
    assert.equal(ix.teamById.get('edge').name, 'Edge')
  })

  test('the sample splits Jules across Core and Migration', { skip: yamlSkip }, () => {
    const ix = sample()
    assert.deepEqual(ix.teamsOf.get('jules-okafor'), [{ team: 'core', pct: 50 }, { team: 'migration', pct: 50 }])
    assert.deepEqual(ix.teamsOf.get('ezra-nakamura'), [{ team: 'core', pct: 80 }])
    assert.deepEqual(ix.teamsOf.get('hana-kobayashi'), [{ team: 'revenue-platform', pct: 100 }])
  })
})

describe('stats', () => {
  test('the sample org numbers', { skip: yamlSkip }, () => {
    // Counted by hand from examples/lanternfish.yaml: 58 entries, 3 open roles,
    // 5 contractors or vendors, 17 managers (spans 2x4, 3x6, 4x5, 5, 6), depth 0..5.
    assert.deepEqual(sample().stats, {
      people: 55, open: 3, external: 5, managers: 17, medianSpan: 3, widestSpan: 6, levels: 6, countries: 32, teams: 10,
    })
  })

  test('people excludes open roles; external is contractors and vendors; countries are distinct', () => {
    const s = build({
      title: 'Mix',
      people: [
        P('boss', null, { country: 'CL' }),
        P('emp', 'boss', { country: 'cl' }),
        P('con', 'boss', { employment: 'contractor', country: 'US' }),
        P('ven', 'boss', { employment: 'vendor' }),
        P('int', 'boss', { employment: 'intern' }),
        P('req', 'boss', { status: 'open' }),
        P('req2', 'emp', { status: 'open' }),
      ],
    }).stats
    assert.equal(s.people, 5)
    assert.equal(s.open, 2)
    assert.equal(s.external, 2)
    assert.equal(s.managers, 2)
    assert.equal(s.countries, 2)
  })

  test('medianSpan with an odd number of managers is the middle span, sorted', () => {
    // Spans in model order 3, 1, 5: an unsorted middle would be 1.
    const s = build({
      title: 'Odd',
      people: [P('r'), P('a', 'r'), P('b', 'r'), P('c', 'r'), P('a1', 'a'),
        ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => P(id, 'b'))],
    }).stats
    assert.equal(s.managers, 3)
    assert.equal(s.medianSpan, 3)
    assert.equal(s.widestSpan, 5)
  })

  test('medianSpan with an even number of managers averages the two middle spans', () => {
    // Spans 2, 1, 3, 6 -> sorted 1, 2, 3, 6 -> 2.5.
    const s = build({
      title: 'Even',
      people: [P('r'), P('a', 'r'), P('b', 'r'), P('a1', 'a'), P('b1', 'b'), P('b2', 'b'), P('b3', 'b'),
        ...['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => P(id, 'b1'))],
    }).stats
    assert.equal(s.managers, 4)
    assert.equal(s.medianSpan, 2.5)
    assert.equal(s.widestSpan, 6)
  })

  test('levels count real layers, with or without a virtual root', () => {
    assert.equal(build({ title: 'One', people: [P('solo')] }).stats.levels, 1)
    assert.equal(build({ title: 'Three', people: [P('r'), P('a', 'r'), P('a1', 'a')] }).stats.levels, 3)
    assert.equal(build({ title: 'Flat', people: [P('x'), P('y')] }).stats.levels, 1)
    assert.equal(build({ title: 'Two', people: [P('x'), P('y'), P('x1', 'x')] }).stats.levels, 2)
    assert.equal(twin().stats.levels, 3)
  })
})

describe('focusView', () => {
  const plain = (v) => ({ ...v, path: [...v.path] })

  test('the top person: their reports in a row, nothing above', { skip: yamlSkip }, () => {
    const ix = sample()
    const v = focusView(ix, 'noor-haddad')
    assert.equal(v.focus, 'noor-haddad')
    assert.equal(v.parent, 'noor-haddad')
    assert.deepEqual(v.chain, [])
    assert.deepEqual(v.row, ['tomas-aguilar', 'elena-petrova', 'grace-whitfield', 'hugo-brandt'])
    assert.deepEqual(v.columns[0], { people: ['priya-raman', 'rafael-costa'], external: [], open: [] })
    assert.deepEqual(v.columns[3], { people: [], external: [], open: [] })
    assert.deepEqual([...v.path], ['noor-haddad'])
  })

  test('a manager: the chain above their manager, peers in a row, reports split by kind', { skip: yamlSkip }, () => {
    const ix = sample()
    const v = focusView(ix, 'diego-salinas')
    assert.equal(v.focus, 'diego-salinas')
    assert.equal(v.parent, 'hana-kobayashi')
    assert.deepEqual(v.chain, ['noor-haddad', 'tomas-aguilar', 'priya-raman'])
    assert.deepEqual(v.row, ['sofia-lindqvist', 'diego-salinas', 'yuki-tanabe'])
    assert.deepEqual(v.columns, [
      { people: ['ezra-nakamura', 'marcus-bell', 'jules-okafor'], external: [], open: [] },
      { people: ['amara-diallo', 'caleb-stone', 'riya-kapoor'], external: [], open: openUnder(ix, 'diego-salinas') },
      { people: ['mateus-ferreira', 'lena-fischer'], external: ['pavel-novak', 'lucia-romano'], open: [] },
    ])
    assert.equal(v.columns[1].open.length, 1)
    assert.deepEqual([...v.path], ['noor-haddad', 'tomas-aguilar', 'priya-raman', 'hana-kobayashi', 'diego-salinas'])
  })

  test('a leaf: siblings in the row, empty columns, path to the top', { skip: yamlSkip }, () => {
    const ix = sample()
    const v = focusView(ix, 'ezra-nakamura')
    assert.equal(v.parent, 'sofia-lindqvist')
    assert.deepEqual(v.chain, ['noor-haddad', 'tomas-aguilar', 'priya-raman', 'hana-kobayashi'])
    assert.deepEqual(v.row, ['ezra-nakamura', 'marcus-bell', 'jules-okafor'])
    for (const col of v.columns) assert.deepEqual(col, { people: [], external: [], open: [] })
    for (const id of ix.chain('ezra-nakamura')) assert.ok(v.path.has(id), id)
    assert.equal(v.path.size, 6)
  })

  test('an unknown or missing id falls back to the top', { skip: yamlSkip }, () => {
    const ix = sample()
    const top = plain(focusView(ix, ix.top))
    assert.deepEqual(plain(focusView(ix, 'nobody-here')), top)
    assert.deepEqual(plain(focusView(ix, undefined)), top)
    assert.deepEqual(plain(focusView(ix, ORG_ROOT)), top, 'no virtual root in a single-root org')
  })

  test('every person sits in their own row, under their manager, with the whole chain on the path', { skip: yamlSkip }, () => {
    const ix = sample()
    for (const p of ix.model.people) {
      const v = focusView(ix, p.id)
      assert.equal(v.focus, p.id)
      assert.equal(v.columns.length, v.row.length)
      if (p.id !== ix.top) {
        assert.ok(v.row.includes(p.id), p.id)
        assert.equal(v.parent, p.manager)
        assert.deepEqual(v.chain, ix.chain(p.manager).slice(0, -1))
      }
      assert.deepEqual([...v.path], ix.chain(p.id))
    }
  })

  test('a root among several roots: the virtual root is the parent, the roots are the row', () => {
    const ix = twin()
    const v = focusView(ix, 'a')
    assert.equal(v.focus, 'a')
    assert.equal(v.parent, ORG_ROOT)
    assert.deepEqual(v.row, ['a', 'b', 'e'])
    assert.deepEqual(v.chain, [])
    assert.deepEqual(v.columns, [
      { people: ['c'], external: [], open: [] },
      { people: [], external: [], open: [] },
      { people: [], external: [], open: [] },
    ])
    assert.deepEqual([...v.path], [ORG_ROOT, 'a'])
    const deep = focusView(ix, 'd')
    assert.equal(deep.parent, 'c')
    assert.deepEqual(deep.chain, [ORG_ROOT, 'a'])
    assert.deepEqual([...deep.path], [ORG_ROOT, 'a', 'c', 'd'])
    const fallback = focusView(ix, 'missing')
    assert.equal(fallback.focus, ORG_ROOT)
    assert.deepEqual(fallback.row, ['a', 'b', 'e'])
  })
})

describe('splitReports', () => {
  test('people, external and open keep their order; an open role is open whatever its employment', () => {
    const ix = build({
      title: 'Split',
      people: [
        P('m'),
        P('e1', 'm'),
        P('c1', 'm', { employment: 'contractor' }),
        P('o1', 'm', { status: 'open' }),
        P('v1', 'm', { employment: 'vendor' }),
        P('i1', 'm', { employment: 'intern' }),
        P('e2', 'm', { status: 'leave' }),
        P('oc', 'm', { status: 'open', employment: 'contractor' }),
        P('n1', 'm', { status: 'incoming' }),
      ],
    })
    assert.deepEqual(splitReports(ix, ix.kids('m')), {
      people: ['e1', 'i1', 'e2', 'n1'], external: ['c1', 'v1'], open: ['o1', 'oc'],
    })
    assert.deepEqual(splitReports(ix, []), { people: [], external: [], open: [] })
  })

  test('the sample columns split contractors, vendors and open roles', { skip: yamlSkip }, () => {
    const ix = sample()
    assert.deepEqual(splitReports(ix, ix.kids('ben-carter')),
      { people: ['olivia-grant', 'mateo-herrera', 'sakura-mori'], external: ['ingrid-halvorsen', 'kofi-asante'], open: [] })
    assert.deepEqual(splitReports(ix, ix.kids('tariq-hassan')),
      { people: ['mira-solberg', 'kenji-watanabe', 'ana-ruiz'], external: [], open: openUnder(ix, 'tariq-hassan') })
    assert.deepEqual(splitReports(ix, ix.kids('camille-laurent')),
      { people: ['tariq-hassan'], external: ['theo-marchetti'], open: [] })
  })
})

describe('searchPeople', () => {
  // Every match kind for "ann", one person each, all at the same depth and
  // listed worst first, so only the ranking can put them in order.
  const ranked = () => build({
    title: 'Ranking',
    people: [
      { id: 'zed', name: 'Zed Root' },
      { id: 'bo', name: 'Bo Lin', manager: 'zed', location: 'Annapolis, USA' },
      { id: 'ray', name: 'Ray Sol', manager: 'zed', tags: ['annual review'] },
      { id: 'lou', name: 'Lou Fay', manager: 'zed', team: 'Annex' },
      { id: 'kim', name: 'Kim Roe', manager: 'zed', role: 'Channel Lead' },
      { id: 'pat', name: 'Pat Doe', manager: 'zed', email: 'ann.ops@corp.example' },
      { id: 'joanna', name: 'Joanna Pike', manager: 'zed' },
      { id: 'mary', name: 'Mary Annely', manager: 'zed' },
      { id: 'annabel', name: 'Annabel Lee', manager: 'zed' },
      { id: 'ann', name: 'Ann', manager: 'zed' },
    ],
  })

  test('exact name, prefix, word prefix, substring, email, title, team, tag, location', () => {
    assert.deepEqual(searchPeople(ranked(), 'ann'),
      ['ann', 'annabel', 'mary', 'joanna', 'pat', 'kim', 'lou', 'ray', 'bo'])
  })

  test('the query is trimmed and case-insensitive', () => {
    const ix = ranked()
    assert.deepEqual(searchPeople(ix, '  ANN  '), searchPeople(ix, 'ann'))
    assert.deepEqual(searchPeople(ix, 'Ann.Ops@Corp.Example'), ['pat'])
  })

  test('an empty or blank query finds nobody', () => {
    const ix = ranked()
    assert.deepEqual(searchPeople(ix, ''), [])
    assert.deepEqual(searchPeople(ix, '   '), [])
  })

  test('limit caps the results, best first', () => {
    const ix = ranked()
    assert.deepEqual(searchPeople(ix, 'ann', 3), ['ann', 'annabel', 'mary'])
    assert.equal(searchPeople(ix, 'ann', 100).length, 9)
  })

  test('a two-letter country code matches exactly, not as a fragment', () => {
    const ix = build({
      title: 'Countries',
      people: [P('uno', null, { country: 'CL' }), P('dos', 'uno', { country: 'US' }), P('tres', 'uno', { country: 'CL' })],
    })
    assert.deepEqual(searchPeople(ix, 'cl'), ['uno', 'tres'])
    assert.deepEqual(searchPeople(ix, 'US'), ['dos'])
    assert.deepEqual(searchPeople(ix, 'c'), [])
  })

  test('a deep exact match still outranks a shallow prefix match', () => {
    const people = [{ id: 'top', name: 'Annabel Top' }]
    for (let i = 1; i <= 12; i++) people.push({ id: `n${i}`, name: `Node ${i}`, manager: i === 1 ? 'top' : `n${i - 1}` })
    people.push({ id: 'deep', name: 'Ann', manager: 'n12' })
    assert.deepEqual(searchPeople(build({ title: 'Ladder', people }), 'ann'), ['deep', 'top'])
  })

  test('the virtual root is never a search result', () => {
    const ix = twin()
    assert.deepEqual(searchPeople(ix, 'twin org'), [])
    assert.deepEqual(searchPeople(ix, 'twin'), [])
    assert.ok(!searchPeople(ix, 'a').includes(ORG_ROOT))
  })

  test('on the sample: shallower people first among equal matches', { skip: yamlSkip }, () => {
    const ix = sample()
    assert.deepEqual(searchPeople(ix, 'Noor Haddad'), ['noor-haddad'])
    assert.equal(searchPeople(ix, 'e').length, 12, 'default limit is 12')
    assert.deepEqual(searchPeople(ix, 'meilin.chen@'), ['mei-lin-chen'])
    assert.deepEqual(searchPeople(ix, 'jules@okafor'), ['jules-okafor'])
    assert.deepEqual(searchPeople(ix, 'staff engineer'), ['arjun-mehta', 'ines-moreau'])
    assert.deepEqual(searchPeople(ix, 'royalties'),
      ['yuki-tanabe', 'mateus-ferreira', 'lena-fischer', 'pavel-novak', 'lucia-romano'])
    assert.deepEqual(searchPeople(ix, 'kubernetes'), ['mei-lin-chen', 'owen-gallagher'])
    assert.deepEqual(searchPeople(ix, 'distributed-systems'), ['tomas-aguilar'])
    assert.deepEqual(searchPeople(ix, 'lisbon'), ['noor-haddad', 'hugo-brandt'])
    assert.deepEqual(searchPeople(ix, 'PT'), ['noor-haddad', 'hugo-brandt', 'rafael-costa'])
  })
})
