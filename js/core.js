// ── Pure helpers ─────────────────────────────────────────────
// Shared by the schema, the tree and the exports. No DOM, so Node can test
// everything that imports only from here.

/** A stable id from a name: lowercase ascii, hyphens, max 48 chars, the same cap as Floorplan so ids survive the handoff. */
export function slug(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** #rgb or #rrggbb, else the fallback. Every colour that reaches a style attribute passes here. */
export function safeColor(v, fallback = '') {
  return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback
}

/** A short plain string, trimmed and capped. Numbers and booleans become strings. */
export function str(v, max = 200) {
  if (v == null) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

/** Only https (and mailto/tel where asked). Anything else is dropped, never rewritten. */
export function safeUrl(v, { mailto = false, tel = false } = {}) {
  const s = str(v, 2000)
  if (!s) return ''
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s
  if (mailto && /^mailto:[^\s"'<>]+$/i.test(s)) return s
  if (tel && /^tel:[+\d\s().-]+$/i.test(s)) return s
  return ''
}

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s)

/** 32-bit FNV-1a: a hue per person that survives reloads and exports. */
export function hash(s) {
  let h = 0x811c9dc5
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

export function initials(name = '') {
  const parts = String(name).replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = [...parts[0]][0] || ''
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] : ''
  return (first + last).toUpperCase()
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
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
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
  if (type === 'phone') return /^[+\d\s().-]{3,40}$/.test(value) ? `tel:${value.replace(/[^\d+]/g, '')}` : ''
  if (def?.prefix) return safeUrl(def.prefix + encodeURIComponent(value))
  return safeUrl(value)
}
