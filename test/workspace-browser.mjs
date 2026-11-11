// Browser check for the Neorgon Workspace in Rama. Not a node --test file: it
// needs Playwright's browsers, borrowed from the monorepo root.
//
//   node test/workspace-browser.mjs                 # chromium,firefox,webkit
//   WS_ENGINES=chromium node test/workspace-browser.mjs
//
// It starts two servers of its own: Rama on RAMA_PORT (9340) and neorgon-site,
// the frame and the Workspace page, on FRAME_PORT (9341). Rama's CSP allows
// frames from neorgon.com and any localhost port (the plan's development rule).
// localStorage['neo-ws:dev-origin'] points the client at that server.
// Chromium's storage partitioning and Firefox's cookie behaviour are put back
// to the browsers' defaults (Playwright changes both), as the kit's check does.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { join } from 'node:path'
import { ROOT, MONOREPO } from './helpers.mjs'

const require = createRequire(join(MONOREPO, 'package.json'))
const { chromium, firefox, webkit } = require('playwright')
const W = await import('../js/neorgon-workspace-core.js')

const RAMA_PORT = Number(process.env.RAMA_PORT || 9340)
const FRAME_PORT = Number(process.env.FRAME_PORT || 9341)
const DEAD = `http://localhost:${Number(process.env.DEAD_PORT || FRAME_PORT + 1)}`   // nothing listens: a workspace that never answers
const SHOTS = process.env.WS_SHOTS || '/tmp'
const RAMA = `http://localhost:${RAMA_PORT}`
const FRAME = `http://localhost:${FRAME_PORT}`
const engines = (process.env.WS_ENGINES || 'chromium,firefox,webkit').split(',')
const LOCAL = { protocol: 'http:', hostname: 'localhost' }

// A server already on either port would be tested instead of this checkout: refuse to run.
const busy = (port) => new Promise((resolve) => {
  const sock = connect(port, '127.0.0.1')
  sock.on('connect', () => { sock.destroy(); resolve(true) })
  sock.on('error', () => resolve(false))
})
for (const port of [RAMA_PORT, FRAME_PORT, Number(new URL(DEAD).port)]) {
  if (await busy(port)) { console.error(`Port ${port} is in use; stop that server or set RAMA_PORT and FRAME_PORT.`); process.exit(2) }
}

const servers = [
  spawn('python3', [join(MONOREPO, 'scripts/serve.py'), String(RAMA_PORT), ROOT], { stdio: 'ignore' }),
  spawn('python3', [join(MONOREPO, 'scripts/serve.py'), String(FRAME_PORT), join(MONOREPO, 'projects/neorgon-site')], { stdio: 'ignore' }),
]
const stop = () => servers.forEach((s) => s.kill())
process.on('exit', stop)

const results = []
const check = (eng, name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${eng}: ${name}${extra ? ` (${extra})` : ''}`) }

async function launch(eng) {
  if (eng === 'chromium') {
    const probe = await chromium.launch({ args: ['--enable-automation'] })
    const cdp = await probe.newBrowserCDPSession()
    const cmd = (await cdp.send('Browser.getBrowserCommandLine')).arguments.join(' ')
    await probe.close()
    const arg = (cmd.match(/--disable-features=\S+/) || [])[0]
    if (!arg) return chromium.launch()
    return chromium.launch({ ignoreDefaultArgs: [arg], args: [arg.replace(/(,)?ThirdPartyStoragePartitioning/, '').replace('=,', '=')] })
  }
  if (eng === 'firefox') return firefox.launch({ firefoxUserPrefs: { 'network.cookie.cookieBehavior': 5 } })
  return webkit.launch()
}

async function go(page, url) {
  for (let i = 0; ; i++) {
    try { return await page.goto(url) } catch (err) {
      if (i >= 4 || !/connect|REFUSED|NS_ERROR_NET|reset|Could not connect/i.test(String(err))) throw err
      await page.waitForTimeout(400)
    }
  }
}

let v = 0

/** Reading text under 12px in the page and an open sheet: decorations and hidden text aside. */
const smallText = (page) => page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('main *, .header-bar *, .neo-ws-sheet *')) {
    if (el.closest('svg, .avatar, [aria-hidden="true"], .caret')) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own || !el.getClientRects().length || !el.getBoundingClientRect().width) continue
    const px = parseFloat(getComputedStyle(el).fontSize)
    if (px < 12) out.push(`${el.className || el.tagName} ${px}`)
  }
  return out
})
async function context(browser, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.addInitScript((frame) => {
    try { if (location.port !== new URL(frame).port) localStorage.setItem('neo-ws:dev-origin', frame) } catch { /* no storage */ }
  }, FRAME)
  // Rama's CSP names localhost:8800 for the frame in development; add this test's port.
  return ctx
}

async function seed(ctx, ws) {
  const stamp = W.makeStamp()
  const p = await ctx.newPage()
  await go(p, `${FRAME}/workspace/vault.html?v=${++v}`)
  await p.evaluate(([rec, cookie]) => { localStorage.setItem('neo-ws:workspace', JSON.stringify(rec)); document.cookie = cookie },
    [{ __v: W.STORE_VERSION, data: { stamp, ws: W.normalizeWorkspace(ws).ws } }, W.stampCookie(stamp, LOCAL)])
  await p.close()
}

async function openRama(ctx, query = '') {
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|goatcounter|clerk|cloudflare|ERR_|Failed to load resource|Content Security Policy.*style/i.test(m.text())) errors.push(m.text()) })
  await go(page, `${RAMA}/?v=${++v}${query}`)
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 15000 })
  return { page, errors }
}

const panelTime = (page) => page.evaluate(() => document.querySelector('[data-localtime]')?.closest('.panel__row, li, div')?.textContent.replace(/\s+/g, ' ').trim() || '')

for (const eng of engines) {
  const browser = await launch(eng)
  try {
    // 1. The gear, the , key, Rama's section, Escape and focus return.
    {
      const ctx = await context(browser)
      const { page, errors } = await openRama(ctx)
      const gear = page.locator('.header-actions #settingsBtn')
      check(eng, 'Settings sits in the header actions and names its key', await gear.count() === 1 && (await gear.getAttribute('aria-keyshortcuts')) === ',' && !(await page.locator('.neo-ws-gear').count()))
      await page.locator('#stage').focus()
      await page.keyboard.press(',')
      const sheet = page.locator('dialog.neo-ws-sheet')
      await sheet.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {})
      check(eng, ', opens the Settings sheet', await sheet.evaluate((d) => d.open).catch(() => false))
      const section = await sheet.textContent().catch(() => '')
      check(eng, 'the sheet carries Rama\'s section and its save action', /What "Save to your workspace" sends/.test(section) && /Save to your workspace/.test(section))
      const faces = await page.locator('.ws-face').evaluateAll((els) => els.map((el) => [el.style.getPropertyValue('--face'), el.style.getPropertyValue('--face-ink'), el.textContent]))
      const payload = await page.evaluate(async () => (await import('./js/workspace.js')).payloadFor())
      const want = payload.people.slice(0, 8).map((p) => [W.colorFor(p), W.inkOn(W.colorFor(p)), W.initials(p.name)])
      check(eng, 'the preview faces are the workspace\'s (colorFor, inkOn, initials)', faces.length > 0 && JSON.stringify(faces) === JSON.stringify(want), JSON.stringify(faces.slice(0, 2)))
      // The unchecked radio's ring against the sheet: 3:1 or more (WCAG 1.4.11), measured on a canvas so color-mix resolves.
      const ring = await page.evaluate(() => {
        const input = [...document.querySelectorAll('.ws-radio input')].find((i) => !i.checked && !i.disabled)
        if (!input) return 0
        const cv = document.createElement('canvas'); cv.width = cv.height = 1
        const g = cv.getContext('2d', { willReadFrequently: true })
        const px = (...fills) => { g.clearRect(0, 0, 1, 1); for (const f of fills) { g.fillStyle = f; g.fillRect(0, 0, 1, 1) } return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3) }
        const sheet = getComputedStyle(document.querySelector('dialog.neo-ws-sheet')).backgroundColor
        const bg = px(getComputedStyle(document.body).backgroundColor, sheet)
        const fg = px(getComputedStyle(document.body).backgroundColor, sheet, getComputedStyle(input).borderTopColor)
        const lum = (c) => { const l = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] }
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
        return (a + 0.05) / (b + 0.05)
      })
      check(eng, 'the unchecked radio\'s ring reads at 3:1 or more on the sheet', ring >= 3, ring.toFixed(2))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      check(eng, 'Escape closes it and focus goes back', !(await sheet.evaluate((d) => d.open).catch(() => true)) && await page.evaluate(() => document.activeElement && document.activeElement !== document.body))
      // The ? sheet lists , as Settings, so it can be moved or turned off there.
      const listed = await page.evaluate(() => window.NeoKeys.list().some((e) => e.key === ',' && e.label === 'Settings'))
      check(eng, 'the Keys kit lists , as Settings', listed)
      check(eng, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
      await ctx.close()
    }

    // 2. Settings reach the clocks: the zone for "ahead of you", the format, the working day.
    {
      const ctx = await context(browser)
      await ctx.addCookies([{ name: 'neo_me', value: W.meCookie({ tz: 'Europe/Lisbon', c: 'h23', h: [0, 1440], d: '1234567' }, LOCAL).split(';')[0].split('=').slice(1).join('='), url: RAMA }])
      const { page } = await openRama(ctx, '&at=noor-haddad')
      const line = await panelTime(page)
      check(eng, 'the time is measured against the zone in Settings (Noor is in Lisbon)', /same time as you/.test(line), line)
      check(eng, 'the 24-hour format applies', !/\b(AM|PM)\b|[ap]\.\s?m\./i.test(line), line)
      check(eng, 'a working day of every hour makes it working hours', /Working hours/i.test(line), line)
      // Changing the setting redraws at once.
      await page.evaluate(async () => {
        const mod = await import('./js/neorgon-workspace.js')
        mod.NeoWorkspace.current.setPrefs({ c: 'h12', tz: 'Asia/Tokyo' })
      })
      await page.waitForTimeout(300)
      const after = await panelTime(page)
      check(eng, 'a new setting redraws the panel', /behind you/.test(after) && /\b(AM|PM)\b|[ap]\.\s?m\./i.test(after), after)
      await ctx.close()
    }

    // 3. The workspace's me.person is a fourth way to find your card.
    {
      const ctx = await context(browser)
      await seed(ctx, { me: { person: 'rama-hugo-brandt' }, people: [{ id: 'rama-hugo-brandt', name: 'Hugo Brandt' }] })
      const { page } = await openRama(ctx)
      await page.waitForFunction(() => /Hugo Brandt/.test(document.getElementById('meBtn').title), null, { timeout: 7000 }).catch(() => {})
      const title = await page.locator('#meBtn').getAttribute('title')
      check(eng, 'the workspace names the visitor\'s card', /Hugo Brandt/.test(title), `${title} ${JSON.stringify(await page.evaluate(async () => { const t = (await import('./js/neorgon-workspace.js')).NeoWorkspace.current.team(); return { s: t.status, f: t.frame, me: t.ws?.me, i: t.issues } }))}`)
      await ctx.close()
    }

    // 4. Save the whole org: the review on the Workspace page, then back; a second save adds nobody.
    {
      const ctx = await context(browser)
      const { page } = await openRama(ctx)
      const seen = []
      page.on('request', (r) => seen.push(r.url()))
      await page.locator('#handBtn').click()
      await page.locator('[data-handoff="ws-org"]').click()
      await page.waitForURL(/\/workspace\/#save=/, { timeout: 8000 }).catch(() => {})
      const head = await page.locator('.ws-flow-card h2').textContent({ timeout: 8000 }).catch(() => '')
      check(eng, 'the Workspace page reviews Rama\'s people', /Rama wants to add \d+ people/.test(head), head)
      await page.locator('[data-act="flow-save"]').click()
      await page.locator('a.ws-away', { hasText: 'Back to Rama' }).click()
      await page.waitForURL(`${RAMA}/**`, { timeout: 8000 })
      await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 15000 })
      await page.locator('#handBtn').click()
      await page.locator('[data-handoff="ws-org"]').click()
      await page.waitForURL(/\/workspace\/#save=/, { timeout: 8000 }).catch(() => {})
      const again = await page.locator('.ws-flow-card .ws-help').first().textContent({ timeout: 8000 }).catch(() => '')
      check(eng, 'saving the same org again changes nothing', /Saving would change nothing/.test(again), again)
      check(eng, 'no request ever carried a team in its URL', !seen.some((u) => /neo-ws=/.test(u)))
      await ctx.close()
    }

    // 4b. A pick's round trip: the answer is taken, stripped from the address bar, and no request carries it.
    {
      const ctx = await context(browser)
      await seed(ctx, { me: { person: 'rama-hugo-brandt' }, people: [{ id: 'rama-hugo-brandt', name: 'Hugo Brandt' }] })
      const { page } = await openRama(ctx)
      const seen = []
      page.on('request', (r) => seen.push(r.url()))
      // load() navigates away, so the evaluate may lose its context: that is the point, not a failure.
      await page.evaluate(async () => { (await import('./js/neorgon-workspace.js')).NeoWorkspace.current.load() }).catch(() => {})
      await page.waitForURL(/\/workspace\/#pick/, { timeout: 8000 })
      await page.locator('[data-act="flow-share"]').click({ timeout: 8000 })
      await page.waitForURL(`${RAMA}/**`, { timeout: 8000 })
      await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 15000 })
      check(eng, 'the answer leaves the address bar', !/neo-ws=/.test(page.url()), page.url().slice(0, 80))
      check(eng, 'the picked team names the card', /Hugo Brandt/.test(await page.locator('#meBtn').getAttribute('title')))
      check(eng, 'no request carried the answer', !seen.slice(1).some((u) => /neo-ws=/.test(u)), seen.filter((u) => /neo-ws=/.test(u)).length + ' with it')
      await ctx.close()
    }

    // 5. On a phone: Hand off is in the header and its menu fits; nothing reads under 12px.
    {
      const ctx = await context(browser, { width: 390, height: 844 })
      const { page } = await openRama(ctx)
      check(eng, 'Hand off is reachable on a phone', await page.locator('#handBtn').isVisible())
      await page.locator('.header-overflow > button').first().click()
      await page.locator('#settingsBtn').click()
      check(eng, 'Settings opens from the phone menu', await page.locator('dialog.neo-ws-sheet').evaluate((d) => d.open).catch(() => false))
      await page.keyboard.press('Escape')
      await page.locator('#handBtn').click()
      const box = await page.locator('#handMenu').boundingBox()
      check(eng, 'its menu fits the screen', !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box))
      await page.keyboard.press('Escape')
      const small = await smallText(page)
      check(eng, 'no reading text under 12px', small.length === 0, small.slice(0, 5).join(', '))
      await ctx.close()
    }

    // 6. At 1440 with the profile panel open: its headings, the cards' counts and the kbd hints are 12px or more.
    {
      const ctx = await context(browser)
      const { page } = await openRama(ctx, '&at=noor-haddad')
      const opened = await page.locator('.panel__section h3').count()
      const small = await smallText(page)
      check(eng, 'no reading text under 12px at 1440, panel open', opened > 0 && small.length === 0, `${opened} panel headings; ${small.slice(0, 5).join(', ')}`)
      const want = ['searchBtn', 'meBtn', 'orgBtn', 'handBtn', 'settingsBtn']
      const seen = {}
      await page.locator('.header-title-link').focus()
      for (let i = 0; i < 10 && Object.keys(seen).length < want.length; i++) {
        await page.keyboard.press(eng === 'webkit' ? 'Alt+Tab' : 'Tab')
        const [id, ring] = await page.evaluate(() => [document.activeElement.id, getComputedStyle(document.activeElement).outlineColor])
        if (want.includes(id)) seen[id] = ring
      }
      const rings = want.map((id) => seen[id] || `${id} not reached`)
      check(eng, 'one focus ring across the header actions', new Set(rings).size === 1, rings.join(' | '))
      await ctx.close()
    }

    // 7. The phone header: the kept controls share one height and never lie on top of each other.
    for (const width of [390, 360, 320]) {
      const ctx = await context(browser, { width, height: 780 })
      const { page } = await openRama(ctx)
      const row = await page.evaluate(() => [...document.querySelectorAll('.header-title-link, .header-actions > button, .header-actions > .menu-wrap > button, .header-overflow-toggle, .neo-auth button, .neo-auth a, .header-home')]
        .map((el) => ({ el: el.id || el.className.split(' ')[0], r: el.getBoundingClientRect() }))
        .filter((x) => x.r.width && x.r.top < 80)
        .map((x) => ({ el: x.el, l: x.r.left, rt: x.r.right, h: Math.round(x.r.height) }))
        .sort((a, b) => a.l - b.l))
      const clash = row.slice(1).filter((x, i) => x.l < row[i].rt - 0.5).map((x) => x.el)
      const heights = new Set(row.filter((x) => x.el !== 'header-title-link').map((x) => x.h))
      check(eng, `the phone header fits at ${width}`, clash.length === 0 && row.at(-1).rt <= width && heights.size === 1, `${row.map((x) => `${x.el} ${Math.round(x.l)}-${Math.round(x.rt)} h${x.h}`).join(', ')}`)
      await ctx.close()
    }

    // 9. A save that may not arrive: the frame never answered (nothing listens on DEAD_PORT), or the browser is offline. Rama warns and stays.
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      await ctx.addInitScript((dead) => { try { localStorage.setItem('neo-ws:dev-origin', dead) } catch { /* no storage */ } }, DEAD)
      const { page, errors } = await openRama(ctx)
      await page.evaluate(async () => { window.__ws = (await import('./js/neorgon-workspace.js')).NeoWorkspace.current })
      await page.waitForFunction(() => window.__ws.team().frame === 'none', null, { timeout: 9000, polling: 250 }).catch(() => {})
      const start = page.url()
      await page.locator('#handBtn').click()
      await page.locator('[data-handoff="ws-org"]').click()
      const warn = page.locator('#wsWarnDialog')
      await warn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
      check(eng, 'an unreachable workspace warns before leaving', await warn.evaluate((d) => d.open).catch(() => false) && page.url() === start)
      check(eng, 'the warning starts on Stay here', await page.evaluate(() => document.activeElement?.dataset.wsWarn) === 'stay')
      await page.screenshot({ path: `${SHOTS}/rama-warn-${eng}.png` }).catch(() => {})
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
      check(eng, 'Stay here closes it, keeps the page and returns focus to Hand off', !(await warn.evaluate((d) => d.open)) && page.url() === start && await page.evaluate(() => document.activeElement?.id) === 'handBtn')
      await page.locator('#handBtn').click()
      await page.locator('[data-handoff="ws-org"]').click()
      const leaving = page.waitForRequest((r) => r.url().startsWith(`${DEAD}/workspace/`), { timeout: 5000 }).then(() => true, () => false)
      await page.locator('[data-ws-warn="go"]').click()
      check(eng, 'Open it anyway still goes to the Workspace page', await leaving)
      check(eng, 'no page errors while warning', errors.filter((e) => !/ERR_CONNECTION|connection refused|Could not connect|NS_ERROR/i.test(e)).length === 0, errors.slice(0, 3).join(' | '))
      await ctx.close()

      const live = await context(browser)
      const opened = await openRama(live)
      await live.setOffline(true)
      await opened.page.locator('#handBtn').click()
      await opened.page.locator('[data-handoff="ws-org"]').click()
      await opened.page.locator('#wsWarnDialog').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
      const text = await opened.page.locator('#wsWarnBody').textContent().catch(() => '')
      check(eng, 'offline, the warning says so', /offline/.test(text), text.slice(0, 60))
      await live.setOffline(false)
      await live.close()
    }

    // 8. Analytics on the production host (Chromium): no beacon runs while the address holds a pick's answer.
    // On localhost the Header Kit starts no analytics, so this serves the page as rama.neorgon.com from disk.
    if (eng === 'chromium') {
      const prod = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const local = (base) => async (route) => {
        const u = new URL(route.request().url())
        try {
          const res = await fetch(base + u.pathname + u.search)
          await route.fulfill({ status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/html' }, body: Buffer.from(await res.arrayBuffer()) })
        } catch { await route.abort().catch(() => {}) }   // a server stopped, or the page already gone
      }
      await prod.route(/^https:\/\/rama\.neorgon\.com\//, local(RAMA))
      await prod.route(/^https:\/\/(www\.)?neorgon\.com\//, local(FRAME))
      await prod.route(/^https:\/\/(cdn\.neorgon\.org|clerk\.neorgon\.com|challenges\.cloudflare\.com)\//, (route) => route.fulfill({ status: 200, body: '' }))
      await prod.addInitScript(() => {
        window.__beacons = []
        const append = Node.prototype.appendChild
        Node.prototype.appendChild = function (el) {
          if (el && el.tagName === 'SCRIPT' && /goatcounter|zgo\.at|cloudflareinsights/.test(el.src || '')) {
            const note = () => window.__beacons.push(location.href)
            el.addEventListener('load', note); el.addEventListener('error', note)
          }
          return append.call(this, el)
        }
      })
      const sent = []
      prod.on('request', (r) => { if (/zgo\.at|goatcounter|cloudflareinsights/.test(r.url())) sent.push(r.url()) })
      await prod.route(/zgo\.at|goatcounter\.com|cloudflareinsights\.com/, (route) => setTimeout(() => route.abort(), 50))
      const page = await prod.newPage()
      await page.goto('https://rama.neorgon.com/')
      await page.evaluate(() => sessionStorage.setItem('neo-ws:return-hash', JSON.stringify({ h: '', t: Date.now(), k: 'pick' })))
      const payload = await W.encodePayload(W.normalizeWorkspace({ people: [{ id: 'zed', name: 'Zed Answer' }] }).ws)
      await page.goto('about:blank')
      await page.goto(W.answerLink('https://rama.neorgon.com/', { payload, stamp: W.makeStamp() }, { selfHostname: 'neorgon.com' }))
      await page.waitForTimeout(2000)
      const runs = await page.evaluate(() => window.__beacons)
      const cached = await page.evaluate(() => localStorage.getItem('neo-ws:cache') || '')
      check(eng, 'production host: analytics run and the answer is taken', runs.length > 0 && !page.url().includes('neo-ws=') && cached.includes('Zed Answer'), JSON.stringify(runs))
      check(eng, 'production host: no beacon runs or sends while the address carries neo-ws=', runs.every((h) => !h.includes('neo-ws=')) && sent.every((u) => !u.includes('neo-ws=')), JSON.stringify(runs))
      await prod.close()
    }
  } catch (err) {
    check(eng, 'ran to the end', false, String(err).slice(0, 300))
  } finally {
    await browser.close()
  }
}

stop()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed} of ${results.length} passed`)
process.exit(failed ? 1 : 0)
