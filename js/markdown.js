// ── Markdown, a little ───────────────────────────────────────
// Notes in a document are untrusted text. Everything is escaped first; the
// patterns below only ever promote already-escaped text into a handful of
// inline tags, and a link must be https. No raw HTML survives, by design.

import { escHtml } from './utils.js'

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)"'<>]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

export function renderMarkdown(text) {
  const blocks = escHtml(String(text || '').trim()).split(/\n{2,}/)
  return blocks.map((b) => {
    const lines = b.split('\n')
    if (lines.every((l) => /^\s*[-*] /.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`
    return `<p>${lines.map(inline).join('<br>')}</p>`
  }).join('')
}
