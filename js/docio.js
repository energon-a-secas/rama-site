// ── Document text in and out ─────────────────────────────────
// Every way a document arrives (the editor, a file, a paste, #d=, ?src=, the
// example) is text, and readDoc() is the one place that turns text into a
// normalized model. YAML, JSON and CSV are told apart by their first bytes.

import { normalizeOrg, orgToDoc } from './schema.js'
import { csvToDoc } from './formats.js'
import { parseYaml, dumpYaml } from './yaml.js'
import { toBase64Url, fromBase64Url } from './core.js'

export const YAML_HEADER = '# Rama org document. Schema and examples: https://rama.neorgon.com/llms.txt\n'
/** A document past this is refused before parsing: no real org needs it, and a page should not hang on one. */
export const MAX_TEXT = 3_000_000
export const LINK_PREFIX = '#d='

/** What the text looks like: 'json', 'csv' or 'yaml'. */
export function sniff(text, name = '') {
  const t = String(text).replace(/^﻿/, '').trimStart()
  if (/\.json$/i.test(name) || t.startsWith('{') || t.startsWith('[')) return 'json'
  if (/\.(csv|tsv)$/i.test(name)) return 'csv'
  const first = t.split(/\r?\n/, 1)[0] || ''
  if (!/^#/.test(first) && !/:\s/.test(first) && !/:$/.test(first) && /[,\t;]/.test(first) && /name/i.test(first)) return 'csv'
  return 'yaml'
}

function yamlError(e) {
  const line = e?.mark?.line
  const reason = e?.reason || e?.message || 'could not read the YAML'
  return Number.isFinite(line) ? `Line ${line + 1}: ${reason}` : String(reason)
}

/**
 * Text -> { model, issues, format, raw }. model is null only when nothing
 * could be read at all; issues then holds the one error that says why.
 */
export function readDoc(text, { name = '', title = '' } = {}) {
  const src = String(text ?? '')
  if (src.length > MAX_TEXT) return fail(`That document is ${Math.round(src.length / 1e6)} MB; Rama reads up to ${MAX_TEXT / 1e6} MB`)
  const format = sniff(src, name)
  let raw
  try {
    if (format === 'json') raw = JSON.parse(src.replace(/^﻿/, ''))
    else if (format === 'csv') raw = csvToDoc(src, title || name.replace(/\.[^.]+$/, '') || 'Imported org')
    else raw = parseYaml(src)
  } catch (e) {
    return fail(format === 'json' ? `Not valid JSON: ${e.message}` : format === 'csv' ? e.message : yamlError(e), format)
  }
  if (raw == null) raw = {}
  const { model, issues } = normalizeOrg(raw)
  return { model, issues, format, raw }
}

const fail = (msg, format = 'yaml') => ({ model: null, issues: [{ level: 'error', msg }], format, raw: null })

/** A model as editor text. CSV never round-trips as CSV: it becomes YAML once read. */
export function modelToText(model, format = 'yaml') {
  const doc = orgToDoc(model)
  return format === 'json' ? `${JSON.stringify(doc, null, 2)}\n` : YAML_HEADER + dumpYaml(doc)
}

/** Text in the other format, keeping YAML comments when nothing needs converting. */
export function convertText(text, to) {
  const { model, issues } = readDoc(text)
  if (!model) return { text: null, issues }
  return { text: modelToText(model, to), issues }
}

export const shareLink = (text, base = `${location.origin}${location.pathname}`) => `${base}${LINK_PREFIX}${toBase64Url(text)}`

/** The document carried by #d=, or null. Throws on a damaged payload. */
export function textFromHash(hash = location.hash) {
  if (!hash.startsWith(LINK_PREFIX)) return null
  return fromBase64Url(hash.slice(LINK_PREFIX.length))
}

/**
 * ?src=<url>: https only, never credentials in the URL. On localhost an http
 * URL to the page's own origin works too, so a local file can be tried.
 */
export function srcUrl(search = location.search) {
  const v = new URLSearchParams(search).get('src')
  if (!v) return null
  let u
  try { u = new URL(v) } catch { return null }
  if (u.username || u.password) return null
  if (u.protocol === 'https:') return u.href
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  if (local && u.protocol === 'http:' && u.origin === location.origin) return u.href
  return null
}

export async function fetchText(url) {
  const res = await fetch(url, { credentials: 'omit', redirect: 'follow', cache: 'no-cache' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText || 'error'}`)
  const len = Number(res.headers.get('content-length'))
  if (Number.isFinite(len) && len > MAX_TEXT) throw new Error('the file is too large')
  return res.text()
}
