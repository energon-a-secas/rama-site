// ── Search and "which card is yours" ─────────────────────────
// Two dialogs over one list: the palette (/ or Ctrl+K) jumps to anyone, the
// picker links this browser to one card. Both are a combobox: the input keeps
// focus, arrow keys move aria-activedescendant, Enter takes the selected row.

import { state, ui, person, setPicked } from './state.js'
import { searchPeople, matchRange } from './tree.js'
import { escHtml, showToast, $ } from './utils.js'
import { openDialog } from './dialogs.js'
import { avatar } from './people.js'
import { go } from './nav.js'
import { draw } from './render.js'

function crumb(id) {
  const ix = state.ix
  const chain = ix.chain(id).slice(0, -1).filter((x) => !person(x).virtual)
  return chain.slice(-2).map((x) => person(x).name).join(' › ')
}

/** Text with the part the query matched in <mark>, escaped either way. */
function marked(text, q) {
  const r = q.trim() ? matchRange(text, q) : null
  if (!r) return escHtml(text)
  return `${escHtml(text.slice(0, r[0]))}<mark>${escHtml(text.slice(r[0], r[1]))}</mark>${escHtml(text.slice(r[1]))}`
}

/** Why a row matched, when it was not the name. */
function why(p, q) {
  const s = q.trim().toLowerCase()
  if (!s || p.name.toLowerCase().includes(s)) return ''
  const tag = p.tags.find((t) => t.toLowerCase().includes(s))
  if (tag) return tag
  if (p.title.toLowerCase().includes(s)) return ''
  const team = (state.ix.teamsOf.get(p.id) || []).map(({ team: t }) => state.ix.teamById.get(t)?.name).find((n) => n?.toLowerCase().includes(s))
  if (team) return team
  if (p.location.toLowerCase().includes(s)) return p.location
  return p.email.find((e) => e.startsWith(s)) || ''
}

function defaults() {
  const ix = state.ix
  const ids = [state.me.id, ui.focus && ix.parentOf(ui.focus), ix.top, ...ix.kids(ix.top)]
  return [...new Set(ids.filter((id) => id && !person(id).virtual))].slice(0, 8)
}

function combobox({ input, list, onPick, empty, count }) {
  let active = 0
  let ids = []
  const paint = () => {
    const q = input.value
    ids = q.trim() ? searchPeople(state.ix, q, 12) : empty()
    active = Math.min(active, Math.max(0, ids.length - 1))
    list.innerHTML = ids.length
      ? ids.map((id, i) => {
        const p = person(id)
        const hint = why(p, q)
        return `<li role="option" id="${list.id}-${i}" class="result" data-pick="${escHtml(id)}" aria-selected="${i === active}">` +
          `${avatar(p, 'sm')}<span class="result__text"><span class="result__name">${marked(p.name, q)}${id === state.me.id ? ' <span class="tag tag--you">You</span>' : ''}</span>` +
          // The title is marked only when the name did not match, so one row never lights up twice.
          `<span class="result__title">${matchRange(p.name, q) ? escHtml(p.title || '') : marked(p.title || '', q)}${hint ? ` <span class="result__why">${marked(hint, q)}</span>` : ''}</span></span>` +
          `<span class="result__crumb">${escHtml(crumb(id))}</span></li>`
      }).join('')
      : q.trim()
        ? `<li class="result result--none" role="presentation">Nobody matches "${escHtml(q.trim())}". Try a first name, a skill or a city.</li>`
        : ''
    input.setAttribute('aria-activedescendant', ids.length ? `${list.id}-${active}` : '')
    input.setAttribute('aria-expanded', String(ids.length > 0))
    // Say how many matched, for screen readers: the list itself changes silently.
    if (count && q.trim()) count.textContent = ids.length ? `${ids.length} ${ids.length === 1 ? 'person' : 'people'} found` : 'Nobody found'
  }
  const select = (i) => {
    active = (i + ids.length) % Math.max(1, ids.length)
    for (const li of list.querySelectorAll('[role="option"]')) li.setAttribute('aria-selected', String(li.id === `${list.id}-${active}`))
    input.setAttribute('aria-activedescendant', `${list.id}-${active}`)
    $(`${list.id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }
  input.setAttribute('role', 'combobox')
  input.addEventListener('input', () => { active = 0; paint() })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(active + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(active - 1) }
    else if (e.key === 'Enter' && ids[active]) { e.preventDefault(); onPick(ids[active]) }
    // A search field's own Escape clears it and keeps the dialog open; here Escape always closes, like any palette.
    else if (e.key === 'Escape') { e.preventDefault(); input.closest('dialog')?.close() }
  })
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-pick]')
    if (li) onPick(li.dataset.pick)
  })
  return { paint, reset: () => { input.value = ''; active = 0; paint() } }
}

let palette = null
let picker = null

export function bindSearch() {
  palette = combobox({
    input: $('searchInput'),
    list: $('searchResults'),
    count: $('searchCount'),
    empty: defaults,
    onPick: (id) => {
      $('searchDialog').close()
      ui.panel = true
      // The person already in focus: go() does nothing, so draw to open the panel.
      if (id === ui.focus) draw()
      else go(id, { focusDom: true })
    },
  })
  picker = combobox({
    input: $('whoInput'),
    list: $('whoResults'),
    count: $('whoCount'),
    empty: () => [],
    onPick: (id) => {
      $('whoDialog').close()
      setPicked(id)
      showToast(`This browser opens ${state.ix.model.title} on ${person(id).name} now`, { duration: 3200 })
      if (ui.focus === id) draw()
      else go(id, { focusDom: true })
    },
  })
  // A click on the palette's backdrop closes it, like Escape.
  $('searchDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close() })
}

export function openSearch(opener) {
  if (!state.ix) return
  palette.reset()
  openDialog($('searchDialog'), opener)
  $('searchInput').focus()
}

export function openPicker(opener) {
  if (!state.ix) return
  picker.reset()
  // Sign-in finds a card by email: worth offering only when signed out and the org has emails at all.
  $('whoAuth').hidden = !!state.emails.length || !state.model.people.some((p) => p.email.length)
  openDialog($('whoDialog'), opener)
  $('whoInput').focus()
}
