// formats.js (CSV in and out, Mermaid, vCard) and the core.js helpers, held to
// the contracts in their header comments. Pure: no DOM.
// Run: node --test test/formats.test.mjs
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, csvToDoc, orgToCsv, orgToMermaid, personToVcard } from '../js/formats.js'
import {
  slug, safeColor, str, safeUrl, isEmail, hash, initials, editDistance,
  toBase64Url, fromBase64Url, fieldHref, plural,
} from '../js/core.js'
import { normalizeOrg } from '../js/schema.js'
import { yamlSkip, sampleRaw } from './helpers.mjs'

const org = (raw) => normalizeOrg(raw).model
const octets = (s) => new TextEncoder().encode(s).length
const FORMULA = /^[=+\-@\t\r]/

describe('parseCsv', () => {
  test('quoted fields keep commas, doubled quotes and newlines', () => {
    assert.deepEqual(parseCsv('name,notes\n"Ada, Countess","She said ""hi""\nthen left"\n'),
      [['name', 'notes'], ['Ada, Countess', 'She said "hi"\nthen left']])
  })

  test('CRLF, LF, a lone CR and a mix give the same rows', () => {
    const want = [['a', 'b'], ['1', '2'], ['3', '4']]
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n3,4\r\n'), want)
    assert.deepEqual(parseCsv('a,b\n1,2\n3,4'), want)
    assert.deepEqual(parseCsv('a,b\r1,2\r3,4\r'), want)
    assert.deepEqual(parseCsv('a,b\r\n1,2\n3,4\n'), want)
  })

  test('a CRLF inside quotes stays in its field', () => {
    assert.deepEqual(parseCsv('a,b\r\n"x\r\ny",z\r\n'), [['a', 'b'], ['x\r\ny', 'z']])
  })

  test('a byte order mark is dropped before the header is read', () => {
    assert.deepEqual(parseCsv('﻿Name,Email\r\nAda,ada@x.example\r\n'), [['Name', 'Email'], ['Ada', 'ada@x.example']])
    assert.deepEqual(parseCsv('﻿'), [])
  })

  test('tab and semicolon separated files', () => {
    const want = [['Name', 'Email'], ['Ada, Countess', 'ada@x.example']]
    assert.deepEqual(parseCsv('Name\tEmail\nAda, Countess\tada@x.example\n'), want)
    assert.deepEqual(parseCsv('Name;Email\r\n"Ada, Countess";ada@x.example\r\n'), want)
  })

  test('the separator is not fooled by a comma quoted inside the header', () => {
    assert.deepEqual(parseCsv('Name;"Office, city"\nAda;Lisbon\n'), [['Name', 'Office, city'], ['Ada', 'Lisbon']])
    assert.deepEqual(parseCsv('Name\t"Last, First"\nAda\tLovelace\n'), [['Name', 'Last, First'], ['Ada', 'Lovelace']])
  })

  test('blank and whitespace-only lines are skipped, empty cells are kept', () => {
    assert.deepEqual(parseCsv('a,b,c\n\n1,,3\n   \n\r\n4,5,\n\n'), [['a', 'b', 'c'], ['1', '', '3'], ['4', '5', '']])
    assert.deepEqual(parseCsv('a,b,c\n"",x,""\n'), [['a', 'b', 'c'], ['', 'x', '']])
    assert.deepEqual(parseCsv(''), [])
  })

  test('a quote in the middle of an unquoted field is literal', () => {
    assert.deepEqual(parseCsv('size,label\n12",ruler\n'), [['size', 'label'], ['12"', 'ruler']])
  })
})

describe('csvToDoc', () => {
  test('HR header aliases map to core keys, skills split on ; and |', () => {
    const doc = csvToDoc([
      'Full Name,Work Email,Job Title,Reports To,Department,Hire Date,Skills,Office,Employee ID',
      'Ana López,ana@l.example,Payments Lead,Noor Haddad,Payments,2021-04-01,go; sql | k8s;,Lisbon,E-7',
    ].join('\n'), 'Lanternfish')
    assert.deepEqual(doc, {
      rama: 1, title: 'Lanternfish',
      people: [{
        name: 'Ana López', email: 'ana@l.example', title: 'Payments Lead', manager: 'Noor Haddad', team: 'Payments',
        start: '2021-04-01', tags: ['go', 'sql', 'k8s'], location: 'Lisbon', id: 'E-7',
      }],
    })
    assert.equal(csvToDoc('Name\nAda\n').title, 'Imported org')
  })

  test('header matching ignores case and padding', () => {
    assert.deepEqual(csvToDoc(' NAME ,REPORTS TO , department\nAda,Bo,Ops\n').people, [{ name: 'Ada', manager: 'Bo', team: 'Ops' }])
  })

  test('unknown columns become camelCase details', () => {
    const doc = csvToDoc('Name,Cost Centre,slack_handle,T-shirt size,Desk Phone #\nAda,CC-410,@ada,M,555 0100\n')
    assert.deepEqual(doc.people[0], { name: 'Ada', costCentre: 'CC-410', slackHandle: '@ada', tShirtSize: 'M', deskPhone: '555 0100' })
  })

  test('a column whose header has no Latin letters is still kept as a detail', () => {
    const p = csvToDoc('Name,電話\nAda,555 0100\n').people[0]
    assert.ok(Object.values(p).includes('555 0100'), `the 電話 column was dropped: ${JSON.stringify(p)}`)
  })

  test('empty cells are left out, the first filled alias wins, ragged rows are read', () => {
    assert.deepEqual(csvToDoc('Name,Manager,Manager Email,Email\nAda,,bo@x.example,\n').people, [{ name: 'Ada', manager: 'bo@x.example' }])
    assert.deepEqual(csvToDoc('Name,Email\nAda\nBo,bo@x.example,spare\n').people, [{ name: 'Ada' }, { name: 'Bo', email: 'bo@x.example' }])
  })

  test('refuses a CSV with no name column', () => {
    assert.throws(() => csvToDoc('Email,Title\na@x.example,CEO\n'), /no name column/)
  })

  test('refuses a header with nobody under it', () => {
    assert.throws(() => csvToDoc('Name,Email\n'), /header row and at least one person/)
    assert.throws(() => csvToDoc('Name,Email\r\n\r\n\r\n'), /header row and at least one person/)
    assert.throws(() => csvToDoc(''), /header row and at least one person/)
  })

  test('then normalizeOrg builds the reporting tree from manager names and emails', () => {
    const csv = [
      'Name,Email,Reports To,Department',
      'Noor Haddad,noor@l.example,,Exec',
      'Tomas Aguilar,tomas@l.example,Noor Haddad,Engineering',
      'Ana López,ANA@L.EXAMPLE,TOMAS@L.EXAMPLE,Engineering',
      'Bo Chen,bo@l.example,ana lópez,Engineering',
      'Cy Diaz,cy@l.example,ana@l.example,',
    ].join('\r\n')
    const { model, issues } = normalizeOrg(csvToDoc(csv))
    assert.deepEqual(issues, [])
    assert.deepEqual(Object.fromEntries(model.people.map((p) => [p.id, p.manager])), {
      'noor-haddad': '', 'tomas-aguilar': 'noor-haddad', 'ana-lopez': 'tomas-aguilar', 'bo-chen': 'ana-lopez', 'cy-diaz': 'ana-lopez',
    })
    assert.deepEqual(model.people.find((p) => p.id === 'ana-lopez').email, ['ana@l.example'])
    assert.deepEqual(model.teams.map((t) => t.name).sort(), ['Engineering', 'Exec'])
    assert.equal(model.people.find((p) => p.id === 'bo-chen').team, 'engineering')
  })

  test('then normalizeOrg resolves Manager ID against Employee ID', () => {
    const { model } = normalizeOrg(csvToDoc('Employee ID,Name,Manager ID\nE1,Noor,\nE2,Tomas,E1\nE3,Ana,e2\n'))
    assert.deepEqual(model.people.map((p) => [p.id, p.manager]), [['e1', ''], ['e2', 'e1'], ['e3', 'e2']])
  })
})

describe('orgToCsv', () => {
  const sample = () => org({
    fields: { costCentre: 'Cost centre' },
    people: [
      { name: 'Noor Haddad', email: 'noor@l.example', title: 'CEO, "Founder"', team: 'Exec', tags: ['strategy', 'board'], location: 'Lisbon\nPT office', costCentre: 'CC-1' },
      { name: 'Tomas Aguilar', manager: 'noor-haddad', title: '=HYPERLINK("https://evil.example","x")', team: 'Exec', location: '+1 call me', tags: ['-flag'] },
      { name: 'Ana López', manager: 'Tomas Aguilar', title: '@SUM(A1)', location: '-2', costCentre: 'CC-2' },
    ],
  })
  const at = (rows, r, name) => rows[r][rows[0].indexOf(name)]

  test('fixed columns then details, CRLF throughout', () => {
    const csv = orgToCsv(sample())
    assert.equal(csv.split('\r\n')[0], 'id,name,email,title,manager,manager_name,team,location,country,tz,employment,status,tags,start,costCentre')
    assert.ok(csv.endsWith('\r\n'))
    assert.equal(csv.replace(/"[^"]*"/g, '').replace(/\r\n/g, '').includes('\n'), false, 'a bare LF outside quotes')
  })

  test('quotes commas, quotes and newlines so parseCsv reads every value back', () => {
    const rows = parseCsv(orgToCsv(sample()))
    assert.equal(rows.length, 4)
    for (const r of rows) assert.equal(r.length, rows[0].length)
    assert.equal(at(rows, 1, 'title'), 'CEO, "Founder"')
    assert.equal(at(rows, 1, 'location'), 'Lisbon\nPT office')
    assert.equal(at(rows, 1, 'tags'), 'strategy; board')
    assert.equal(at(rows, 1, 'team'), 'Exec')
    assert.equal(at(rows, 1, 'costCentre'), 'CC-1')
    assert.equal(at(rows, 3, 'manager'), 'tomas-aguilar')
    assert.equal(at(rows, 3, 'manager_name'), 'Tomas Aguilar')
  })

  test('cells starting with = + - @ tab or CR cannot run as formulas', () => {
    const m = sample()
    m.people[0].location = '\t=1+2'
    m.people[2].email = ['\r=cmd@l.example']
    const rows = parseCsv(orgToCsv(m))
    assert.equal(at(rows, 2, 'title'), `'=HYPERLINK("https://evil.example","x")`)
    assert.equal(at(rows, 2, 'location'), "'+1 call me")
    assert.equal(at(rows, 2, 'tags'), "'-flag")
    assert.equal(at(rows, 3, 'title'), "'@SUM(A1)")
    assert.equal(at(rows, 3, 'location'), "'-2")
    assert.equal(at(rows, 1, 'location'), "'\t=1+2")
    assert.equal(at(rows, 3, 'email'), "'\r=cmd@l.example")
    for (const r of rows.slice(1)) for (const c of r) assert.doesNotMatch(c, FORMULA)
  })

  test('header cells from detail keys are quoted and guarded too', () => {
    const m = org({ people: [{ name: 'Ana', 'Cost, centre': 'CC-1', '=1+1': 'x' }] })
    const rows = parseCsv(orgToCsv(m))
    assert.equal(rows[0].length, rows[1].length, `header ${JSON.stringify(rows[0])}`)
    for (const c of rows[0]) assert.doesNotMatch(c, FORMULA)
    assert.equal(at(rows, 1, 'Cost, centre'), 'CC-1')
  })

  test('a detail named manager_name does not overwrite the manager column', () => {
    const m = org({ people: [{ name: 'Ana' }, { name: 'Bo', manager: 'Ana', manager_name: 'Someone else' }] })
    const rows = parseCsv(orgToCsv(m))
    assert.equal(new Set(rows[0]).size, rows[0].length, `duplicate columns: ${rows[0].join(',')}`)
    assert.equal(at(rows, 2, 'manager_name'), 'Ana')
  })

  test('re-importing an export keeps reporting lines, teams and tags', () => {
    const a = sample()
    a.people[1].tags = ['flag'] // a guarded '-flag' comes back as "'-flag", which is the guard working
    const b = org(csvToDoc(orgToCsv(a)))
    const view = (m) => m.people.map((p) => [p.id, p.name, p.manager, m.teams.find((t) => t.id === p.team)?.name || '', p.tags])
    assert.deepEqual(view(b), view(a))
  })

  test('re-importing an export adds no manager-name detail to anyone', () => {
    const b = org(csvToDoc(orgToCsv(sample())))
    for (const p of b.people) assert.deepEqual(Object.keys(p.extra).filter((k) => k !== 'costCentre'), [], `${p.name}: ${JSON.stringify(p.extra)}`)
  })

  test('the sample org survives orgToCsv then csvToDoc', { skip: yamlSkip }, () => {
    const a = org(sampleRaw())
    const { model: b, issues } = normalizeOrg(csvToDoc(orgToCsv(a), a.title))
    assert.deepEqual(issues.filter((i) => i.level === 'error'), [])
    const view = (m) => m.people.map((p) => [p.id, p.name, p.manager, p.title, m.teams.find((t) => t.id === p.team)?.name || '', p.tags.join('|')])
    assert.deepEqual(view(b), view(a))
  })
})

describe('orgToMermaid', () => {
  test('one node per person and one edge per reporting line', () => {
    const m = org({ people: [{ name: 'Noor', title: 'CEO' }, { name: 'Tomas', manager: 'Noor' }, { name: 'Ana', manager: 'Tomas', title: 'Engineer' }] })
    assert.equal(orgToMermaid(m), [
      'flowchart TB',
      '  p0["Noor<br/><small>CEO</small>"]',
      '  p1["Tomas"]',
      '  p2["Ana<br/><small>Engineer</small>"]',
      '  p0 --> p1',
      '  p1 --> p2',
      '',
    ].join('\n'))
  })

  test('quotes, angle brackets and newlines cannot break out of a label', () => {
    const m = org({ people: [{ name: 'Ana "Boss" <img src=x onerror=alert(1)>', title: 'VP <b>Ops</b>\nEMEA' }, { name: 'Line\r\nBreak' }] })
    const lines = orgToMermaid(m).split('\n')
    assert.equal(lines[1], `  p0["Ana 'Boss' 'img src=x onerror=alert(1)'<br/><small>VP 'b'Ops'/b' EMEA</small>"]`)
    assert.equal(lines[2], '  p1["Line Break"]')
    for (const l of lines.slice(1, 3)) assert.doesNotMatch(l.slice(6, -2).replace(/<\/?(br\/|small)>/g, ''), /["<>]/)
  })

  test('caps people at the limit and says how many were left out', () => {
    const people = Array.from({ length: 450 }, (_, i) => (i ? { name: `Person ${i}`, manager: 'person-0' } : { name: 'Person 0' }))
    const out = orgToMermaid(org({ people })).trimEnd().split('\n')
    assert.equal(out.filter((l) => /^ {2}p\d+\["/.test(l)).length, 400)
    assert.equal(out.filter((l) => l.includes('-->')).length, 399)
    assert.equal(out.at(-1), '  %% 50 more people left out')
    assert.ok(!out.some((l) => /\bp4\d\d\b/.test(l)), 'a node past the cap was drawn')
    assert.deepEqual(orgToMermaid(org({ people }), 2).trimEnd().split('\n'),
      ['flowchart TB', '  p0["Person 0"]', '  p1["Person 1"]', '  p0 --> p1', '  %% 448 more people left out'])
  })
})

describe('personToVcard', () => {
  const model = org({
    fields: {
      phone: { label: 'Desk phone', type: 'phone' },
      wiki: { type: 'url', prefix: 'https://wiki.l.example/people/' },
      site: { type: 'url' },
      blog: { type: 'url' },
      oncall: 'On-call',
    },
    people: [{
      name: 'Ana María López', title: 'Lead, Payments; EMEA \\ Ops\nSecond line',
      email: ['ana@l.example', 'ana.lopez@l.example'], location: 'Santiago, Chile', country: 'CL', pronounced: 'AH-na',
      phone: '+56 555 0100', wiki: 'ana lópez', site: 'https://ana.example/a,b', blog: 'javascript:alert(1)', oncall: 'yes',
    }],
  })

  test('escapes text, maps phone fields to TEL and prefixes URL fields', () => {
    const card = personToVcard(model.people[0], { org: 'Lanternfish; Systems', team: 'Payments', manager: 'Tomas Aguilar', fields: model.fields })
    assert.equal(card, [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:López;Ana María;;;',
      'FN:Ana María López',
      'TITLE:Lead\\, Payments\\; EMEA \\\\ Ops\\nSecond line',
      'ORG:Lanternfish\\; Systems;Payments',
      'EMAIL;TYPE=INTERNET,WORK,PREF:ana@l.example',
      'EMAIL;TYPE=INTERNET:ana.lopez@l.example',
      'TEL;TYPE=WORK:+56 555 0100',
      'URL:https://wiki.l.example/people/ana%20l%C3%B3pez',
      'URL:https://ana.example/a,b',
      'ADR;TYPE=WORK:;;;Santiago\\, Chile;;;CL',
      'NOTE:Reports to Tomas Aguilar. Pronounced: AH-na',
      'END:VCARD',
      '',
    ].join('\r\n'))
  })

  test('a single name, a team with no org, and nothing optional', () => {
    const p = org({ people: [{ name: 'Cher' }] }).people[0]
    assert.equal(personToVcard(p, { team: 'Vocals' }), 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:;Cher;;;\r\nFN:Cher\r\nORG:;Vocals\r\nEND:VCARD\r\n')
  })

  test('a carriage return in a value cannot start a new property', () => {
    const p = org({ people: [{ name: 'Bo', title: 'Lead\r\nEngineer', location: 'x\rURL:https://evil.example' }] }).people[0]
    const card = personToVcard(p)
    assert.doesNotMatch(card, /\r(?!\n)/, 'a bare CR is in the card')
    assert.ok(!card.split(/\r\n|\r|\n/).some((l) => l.startsWith('URL:')), 'a value injected a URL property')
  })

  test('folds at 75 octets without splitting a character, CRLF throughout', () => {
    const p = org({ people: [{ name: 'Zoë Ångström' }] }).people[0]
    const manager = 'José Ñúñez 工程师 🐟🇨🇱 '.repeat(6).trim()
    const orgName = '株式会社ランタンフィッシュ'.repeat(4)
    const card = personToVcard(p, { org: orgName, manager })
    assert.ok(card.endsWith('\r\n'))
    assert.doesNotMatch(card, /\r(?!\n)|(?<!\r)\n/)
    const physical = card.slice(0, -2).split('\r\n')
    physical.forEach((l, i) => {
      assert.ok(octets(l) <= 75, `${octets(l)} octets: ${l}`)
      assert.ok(l.isWellFormed(), `line ${i} splits a surrogate pair`)
      if (physical[i + 1]?.startsWith(' ')) assert.ok(octets(l) > 71, `folded early at ${octets(l)} octets`)
    })
    assert.ok(physical.filter((l) => l.startsWith(' ')).length >= 3, 'nothing was folded')
    const logical = card.replace(/\r\n /g, '').slice(0, -2).split('\r\n')
    assert.ok(logical.includes(`NOTE:Reports to ${manager}`))
    assert.ok(logical.includes(`ORG:${orgName}`))
  })

  test('every card in the sample org is well formed', { skip: yamlSkip }, () => {
    const m = org(sampleRaw())
    for (const p of m.people) {
      const card = personToVcard(p, { org: m.title, fields: m.fields })
      assert.match(card, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n[^]*END:VCARD\r\n$/)
      for (const l of card.split('\r\n')) assert.ok(octets(l) <= 75 && !/[\r\n]/.test(l), `${p.name}: ${l}`)
    }
  })
})

describe('core: base64url', () => {
  test('round-trips emoji, CJK and combining marks without normalising them', () => {
    for (const s of ['', 'a', 'Ñandú', '工程师 渠道', '🐟🇨🇱👩🏽‍💻', 'é vs é', 'ạ̈', '�>>>???']) {
      const b = toBase64Url(s)
      assert.match(b, /^[A-Za-z0-9_-]*$/)
      assert.equal(fromBase64Url(b), s)
    }
  })

  test('uses the URL alphabet and drops padding', () => {
    assert.equal(toBase64Url('>>>'), 'Pj4-')
    assert.equal(toBase64Url('???'), 'Pz8_')
    assert.equal(toBase64Url('ü'), 'w7w')
    assert.equal(fromBase64Url('w7w'), 'ü')
  })

  test('round-trips more than 200 KB', () => {
    const big = 'Lanternfish 🐟 渠道 ñandú é\n'.repeat(6000)
    assert.ok(octets(big) > 200_000)
    assert.equal(fromBase64Url(toBase64Url(big)), big)
  })
})

describe('core: strings and ids', () => {
  test('slug strips diacritics, folds width, and trims hyphens', () => {
    assert.equal(slug('José Ñúñez'), 'jose-nunez')
    assert.equal(slug('Zoë Ångström-Ölz'), 'zoe-angstrom-olz')
    assert.equal(slug('ＡＢＣ　Team'), 'abc-team')
    assert.equal(slug('  --Hello, World!--  '), 'hello-world')
    assert.equal(slug(null), '')
    assert.equal(slug(42), '42')
  })

  test('slug caps at 48 and never ends on a hyphen', () => {
    assert.equal(slug('a'.repeat(100)).length, 48)
    const cut = slug(`${'a'.repeat(47)} bcd`)
    assert.ok(cut.length <= 48)
    assert.doesNotMatch(cut, /-$/)
  })

  test('safeColor accepts #rgb and #rrggbb only', () => {
    assert.equal(safeColor('#ABC'), '#abc')
    assert.equal(safeColor(' #A1B2C3 '), '#a1b2c3')
    for (const bad of ['red', '#abcd', '#abc;background:red', 'url(x)', '#12345g', 123, null]) assert.equal(safeColor(bad, 'x'), 'x')
    assert.equal(safeColor('nope'), '')
  })

  test('str trims, caps, and stringifies numbers and booleans', () => {
    assert.equal(str(null), '')
    assert.equal(str(undefined), '')
    assert.equal(str(5), '5')
    assert.equal(str(false), 'false')
    assert.equal(str('  padded  '), 'padded')
    assert.equal(str('abcdef', 3), 'abc')
    assert.equal(str({ a: 1 }), '')
    assert.equal(str(['a']), '')
  })

  test('str caps numbers as well', () => {
    assert.equal(str(123456, 3), '123')
  })

  test('str never cuts a character in half', () => {
    assert.ok(str('a🐟🐟', 2).isWellFormed(), 'the cap split a surrogate pair')
  })

  test('isEmail', () => {
    for (const ok of ['a@b.co', 'A.B+tag@sub.l.example']) assert.equal(isEmail(ok), true, ok)
    for (const bad of ['a@b', 'a b@c.de', 'a@b.c<x>', '<a@b.c>', 'a@@b.c', "a'@b.c", `${'x'.repeat(250)}@b.co`, null, 42]) assert.equal(isEmail(bad), false, String(bad))
  })

  test('hash is 32-bit FNV-1a, unsigned and stable', () => {
    assert.equal(hash(''), 0x811c9dc5)
    assert.equal(hash('a'), 0xe40c292c)
    assert.equal(hash('foobar'), 0xbf9cf968)
    for (const s of ['Ana López', '🐟', '工程师']) {
      const h = hash(s)
      assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff)
      assert.equal(hash(s), h)
    }
    assert.notEqual(hash('Ana'), hash('Ane'))
  })

  test('initials: one name, nicknames, accents and emoji', () => {
    assert.equal(initials('Ada Lovelace'), 'AL')
    assert.equal(initials('Cher'), 'C')
    assert.equal(initials('élodie durand'), 'ÉD')
    assert.equal(initials('José (Pepe) García López'), 'JL')
    assert.equal(initials('Robert (Bob)'), 'R')
    for (const none of ['', '   ', '(Pepe)', undefined]) assert.equal(initials(none), '?')
    assert.equal(initials('😀 Smile'), '😀S')
    assert.equal(initials('Zoë 🐟'), 'Z🐟')
    assert.ok(initials('𝒜da Lovelace').isWellFormed())
  })

  test('editDistance', () => {
    assert.equal(editDistance('kitten', 'sitting'), 3)
    assert.equal(editDistance('', 'abc'), 3)
    assert.equal(editDistance('same', 'same'), 0)
    assert.equal(editDistance('managr', 'manager', 2), 1)
    assert.ok(editDistance('a', 'abcdef', 3) > 3)
    assert.ok(editDistance('abcd', 'wxyz', 2) > 2)
  })

  test('plural', () => {
    assert.equal(plural(1, 'person', 'people'), '1 person')
    assert.equal(plural(2, 'person', 'people'), '2 people')
    assert.equal(plural(0, 'team'), '0 teams')
  })
})

describe('core: links', () => {
  test('safeUrl keeps https and nothing else by default', () => {
    for (const ok of ['https://l.example/a?b=c#d', 'HTTPS://L.EXAMPLE']) assert.equal(safeUrl(ok), ok)
    for (const bad of [
      'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
      'http://l.example', '//l.example', 'ftp://l.example', 'https://', 'https://l.example/"onmouseover=x',
      "https://l.example/'x", 'https://l.example/<script>', 'https://l.example/a b', 'https://l.example/\nx',
      'mailto:a@b.co', 'tel:+15550100', null, 42,
    ]) assert.equal(safeUrl(bad), '', String(bad))
  })

  test('safeUrl allows mailto and tel only when asked', () => {
    assert.equal(safeUrl('mailto:a@b.co', { mailto: true }), 'mailto:a@b.co')
    assert.equal(safeUrl('tel:+1 (555) 010-0100', { tel: true }), 'tel:+1 (555) 010-0100')
    assert.equal(safeUrl('tel:+1;ext=javascript', { tel: true }), '')
    assert.equal(safeUrl('mailto:a@b.co"x', { mailto: true }), '')
  })

  test('safeUrl drops an over-long URL instead of truncating it', () => {
    const long = `https://l.example/${'a'.repeat(3000)}`
    const got = safeUrl(long)
    assert.ok(got === '' || got === long, `rewritten to ${got.length} chars`)
  })

  test('fieldHref: email and phone fields', () => {
    assert.equal(fieldHref({ type: 'email' }, 'Ana@l.example'), 'mailto:Ana@l.example')
    assert.equal(fieldHref({ type: 'email' }, 'not an email'), '')
    assert.equal(fieldHref({ type: 'email' }, 'a@b.co"onclick=x'), '')
    assert.equal(fieldHref({ type: 'phone' }, '+351 555 0100'), 'tel:+3515550100')
    assert.equal(fieldHref({ type: 'phone' }, '(555) 010-0100'), 'tel:5550100100')
    assert.equal(fieldHref({ type: 'phone' }, 'call me'), '')
    assert.equal(fieldHref({ type: 'phone' }, '12'), '')
  })

  test('fieldHref: a prefix wraps the encoded value, and must itself be https', () => {
    const wiki = { type: 'url', prefix: 'https://wiki.l.example/people/' }
    assert.equal(fieldHref(wiki, 'ana lópez'), 'https://wiki.l.example/people/ana%20l%C3%B3pez')
    assert.equal(fieldHref(wiki, '"><script>'), 'https://wiki.l.example/people/%22%3E%3Cscript%3E')
    assert.equal(fieldHref({ type: 'handle', prefix: 'https://chat.l.example/u/' }, '@ana'), 'https://chat.l.example/u/%40ana')
    assert.equal(fieldHref({ prefix: 'javascript:' }, 'alert(1)'), '')
  })

  test('fieldHref: an undeclared or bare value links only when it is https', () => {
    assert.equal(fieldHref(undefined, 'https://l.example/x'), 'https://l.example/x')
    assert.equal(fieldHref({ type: 'url' }, 'https://l.example/x'), 'https://l.example/x')
    for (const bad of ['http://l.example', 'javascript:alert(1)', 'www.l.example', '']) assert.equal(fieldHref({ type: 'url' }, bad), '', bad)
    assert.equal(fieldHref({ type: 'url' }, ['https://l.example']), '')
    assert.equal(fieldHref(null, 42), '')
  })
})
