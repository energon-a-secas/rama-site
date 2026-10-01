// ── Who the visitor is ───────────────────────────────────────
// Three ways to find the visitor's card, strongest first: a ?me= in the link
// (someone sent them there on purpose), the card they picked with Me (saved
// per org in this browser), and the emails on their Neorgon account. None of
// them is required: with no match the chart opens at the top.

import { slug } from './core.js'

/** -> { id, source } where source is 'link' | 'picked' | 'account' | null. */
export function resolveMe(ix, { param = '', picked = '', emails = [] } = {}) {
  const byRef = (ref) => {
    const s = String(ref || '').trim().toLowerCase()
    if (!s) return null
    if (ix.byId.has(s) && !ix.byId.get(s).virtual) return s
    const sl = slug(s)
    for (const p of ix.model.people) {
      if (p.email.includes(s) || p.id === sl || p.name.toLowerCase() === s) return p.id
    }
    return null
  }
  const fromParam = byRef(param)
  if (fromParam) return { id: fromParam, source: 'link' }
  const fromPick = picked && ix.byId.has(picked) ? picked : byRef(picked)
  if (fromPick) return { id: fromPick, source: 'picked' }
  for (const e of emails) {
    const id = byRef(e)
    if (id) return { id, source: 'account' }
  }
  return { id: null, source: null }
}

/** The emails on a signed-in Neorgon account, lowercased. Empty when signed out. */
export function accountEmails(auth) {
  const user = auth?.signedIn ? auth.clerk?.user : null
  if (!user) return []
  const list = (user.emailAddresses || []).map((e) => e?.emailAddress).filter(Boolean)
  const primary = user.primaryEmailAddress?.emailAddress
  return [...new Set([primary, ...list].filter(Boolean).map((e) => String(e).toLowerCase()))]
}
