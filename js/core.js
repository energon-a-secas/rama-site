// ── Pure helpers ─────────────────────────────────────────────
// Shared by the schema, the tree and the exports. No DOM, so Node can test
// everything that imports only from here.

/** Letters NFKD leaves whole: without these, "Łukasz" and "Søren" lose a letter in their ids. */
const FOLD = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ß: 'ss', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', þ: 'th', Þ: 'Th', ð: 'd', Ð: 'D', ħ: 'h', Ħ: 'H', ı: 'i' }

/** Spell out the letters NFKD leaves whole, for ids and for search ("lukasz" finds "Łukasz"). */
export const unfold = (s) => s.replace(/[łŁøØđĐßæÆœŒþÞðÐħĦı]/g, (c) => FOLD[c])

/** A stable id from a name: lowercase ascii, hyphens, max 48 chars, the same cap as Floorplan so ids survive the handoff. */
export function slug(s) {
  return unfold(String(s ?? ''))
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48).replace(/-+$/, '')
}

/** #rgb or #rrggbb, else the fallback. Every colour that reaches a style attribute passes here. */
export function safeColor(v, fallback = '') {
  return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback
}

/**
 * A short plain string, trimmed and capped. Numbers and booleans become strings.
 * CRLF and CR become LF and the other control characters go, so no value can
 * start a line in a vCard or a CSV; a cut never leaves half a surrogate pair.
 */
export function str(v, max = 200) {
  if (v == null) return ''
  let s
  if (typeof v === 'number' || typeof v === 'boolean') s = String(v)
  else if (typeof v === 'string') s = v
  else return ''
  s = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
  if (s.length > max) s = s.slice(0, max).trimEnd()
  if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1)
  return typeof s.toWellFormed === 'function' ? s.toWellFormed() : s
}

/** Only https (and mailto/tel where asked). Anything else is dropped, never rewritten. */
export function safeUrl(v, { mailto = false, tel = false } = {}) {
  if (typeof v === 'string' && v.trim().length > 2000) return ''
  const s = str(v, 2000)
  if (!s) return ''
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s
  if (mailto && /^mailto:[^\s"'<>]+$/i.test(s)) return s
  if (tel && /^tel:[+\d ().-]+$/i.test(s)) return s
  return ''
}

/** A plain address: no ?, &, = or % that could add a bcc or a body to a mailto: link. */
export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(s)

/** 32-bit FNV-1a: a hue per person that survives reloads and exports. */
export function hash(s) {
  let h = 0x811c9dc5
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

/** First letters of the first and last word, whole graphemes; an emoji counts, punctuation never does. */
const MARK = /\p{L}|\p{Extended_Pictographic}/u
export function initials(name = '') {
  const words = String(name).replace(/\(.*?\)/g, '').trim().split(/\s+/).filter((w) => MARK.test(w))
  if (!words.length) return '?'
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  const firstLetter = (w) => {
    const from = w.slice(w.search(MARK))
    const g = seg ? seg.segment(from)[Symbol.iterator]().next().value?.segment || '' : [...from][0] || ''
    const up = g.toUpperCase()
    return up.length > g.length ? g : up // ß stays ß rather than becoming SS
  }
  return firstLetter(words[0]) + (words.length > 1 ? firstLetter(words[words.length - 1]) : '')
}

/** Levenshtein distance, capped: only used to suggest a key someone meant to type. */
export function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** UTF-8 safe base64url, the fleet's link payload encoding (Floorplan #d=, Reparto #p=). */
export function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(b64) {
  const bin = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/'))
  // ignoreBOM keeps a leading U+FEFF, so encode then decode gives back exactly what went in.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

/**
 * A detail's value as a link, or '' when it is not one. A declared field's
 * type and prefix decide (wiki: { type: url, prefix: https://wiki/people/ });
 * an undeclared value links only when it is already an https URL.
 */
export function fieldHref(def, value) {
  if (typeof value !== 'string' || !value) return ''
  const type = def?.type || 'text'
  if (type === 'email') return isEmail(value) ? `mailto:${value}` : ''
  if (type === 'phone') return /^[+\d ().-]{3,40}$/.test(value) && (value.match(/\d/g) || []).length >= 3 ? `tel:${value.replace(/[^\d+]/g, '')}` : ''
  if (def?.prefix) {
    try { return safeUrl(def.prefix + encodeURIComponent(value)) } catch { return '' }
  }
  return safeUrl(value)
}

// ── Clocks ───────────────────────────────────────────────────
const OFFSET = /^([+-])(\d{1,2})(?::(\d{2}))?$/

/** "+2" becomes an Etc zone Intl understands; IANA names pass through. Throws on a half-hour offset, which has no Etc zone. */
export function tzName(tz) {
  const m = OFFSET.exec(tz)
  if (!m) return tz
  if (m[3] && m[3] !== '00') throw new Error('Intl has no half-hour Etc zones')
  return `Etc/GMT${m[1] === '+' ? '-' : '+'}${Number(m[2])}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const clocks = new Map()

/** The time of day at a zone (hour 0 to 24, minutes as a fraction) and the weekday (0 is Sunday), or null for a zone Intl does not know. */
export function clockAt(tz, now = new Date()) {
  const m = OFFSET.exec(tz || '')
  if (m) {
    const t = new Date(now.getTime() + (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) * 6e4)
    return { hour: t.getUTCHours() + t.getUTCMinutes() / 60, day: t.getUTCDay() }
  }
  if (!tz) return null
  try {
    // One formatter per zone: a 5000-person org shares a handful, and each costs tens of microseconds.
    if (!clocks.has(tz)) clocks.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' }))
    const parts = clocks.get(tz).formatToParts(now)
    const get = (type) => parts.find((x) => x.type === type)?.value
    return { hour: (Number(get('hour')) % 24) + Number(get('minute')) / 60, day: WEEKDAYS.indexOf(get('weekday')) }
  } catch {
    return null
  }
}

/**
 * Where someone's day is: night (22 to 7, any day), weekend (the waking hours
 * of a Saturday or Sunday), work (9 to 18 on a weekday), edge (the weekday's
 * 7 to 9 and 18 to 22), or none without a clock. Night comes first, so a
 * weekend view still shows who is asleep.
 */
export function dayPart(clock) {
  if (!clock) return 'none'
  if (clock.hour < 7 || clock.hour >= 22) return 'night'
  if (clock.day === 0 || clock.day === 6) return 'weekend'
  return clock.hour >= 9 && clock.hour < 18 ? 'work' : 'edge'
}
