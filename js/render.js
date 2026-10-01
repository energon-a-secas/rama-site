// ── Drawing the page ─────────────────────────────────────────
// draw() repaints whatever depends on the focus; drawAll() also repaints what
// depends on the document (title, numbers, the notice). Neither saves.

import { state, ui, person } from './state.js'
import { renderChart } from './render-chart.js'
import { renderOverview } from './overview.js'
import { renderPanel } from './panel.js'
import { escHtml, $ } from './utils.js'
import { plural } from './core.js'
import { icon } from './icons.js'

let lastView = null

export function draw() {
  showView()
  if (!ui.focus && state.ix) ui.focus = state.ix.top
  // The panel first: opening it narrows the stage, and the wires are measured from the final layout.
  renderPanel()
  if (ui.view === 'chart') lastView = renderChart()
  else renderOverview()
  renderHeader()
}

export function drawAll() {
  renderStagebar()
  renderNotice()
  draw()
}

/** The focus view the chart last drew, for redrawing wires on resize. */
export const chartView = () => lastView

function showView() {
  const chart = ui.view === 'chart'
  $('chart').hidden = !chart
  $('overview').hidden = chart
  $('stage').setAttribute('aria-label', chart ? 'Org chart' : 'Org overview')
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === ui.view))
  document.body.dataset.mode = ui.view
}

function renderStagebar() {
  const ix = state.ix
  $('orgTitle').textContent = ix ? ix.model.title : 'No org loaded'
  document.title = ix && ix.model.people.length ? `${ix.model.title} | Rama` : 'Rama | Org Chart Explorer'
  if (!ix) { $('orgStats').innerHTML = ''; return }
  const s = ix.stats
  const items = [
    [s.people, 'person', 'people'],
    [s.managers, 'manager'],
    [s.levels, 'level'],
    [s.countries, 'country', 'countries'],
    [s.teams, 'team'],
    [s.open, 'open role'],
  ].filter(([n], i) => n || i === 0)
  $('orgStats').innerHTML = items.map(([n, one, many]) => `<li><b>${n}</b> ${escHtml(plural(n, one, many).replace(/^\d+ /, ''))}</li>`).join('')
}

function renderNotice() {
  const el = $('notice')
  const warns = state.issues.filter((i) => i.level !== 'info')
  const ix = state.ix
  // A document with people and teams but no reporting lines (a Floorplan file, say) draws flat; say how to fix that.
  const flat = ix && ix.model.people.length > 1 && ix.stats.managers === 0
  if (!warns.length && !flat) { el.hidden = true; el.innerHTML = ''; return }
  el.hidden = false
  const lines = []
  if (warns.length) lines.push(`${plural(warns.length, 'thing')} in the document ${warns.length === 1 ? 'needs' : 'need'} a look: ${warns[0].msg}${warns.length > 1 ? ', and more' : ''}.`)
  if (flat) lines.push(`Nobody reports to anyone yet${ix.model.teams.length ? ', though the teams came through' : ''}. Add manager: to each person to draw the reporting lines.`)
  el.innerHTML = `${icon('alert', { size: 15 })}<span>${lines.map(escHtml).join(' ')}</span>` +
    '<button type="button" class="btn-link" data-action="edit">Open the editor</button>'
}

export function renderHeader() {
  const me = person(state.me.id)
  const btn = $('meBtn')
  btn.title = me ? `Go to your card, ${me.name} (M)` : 'Pick your card (M)'
  btn.classList.toggle('is-set', !!me)
  const f = person(ui.focus)
  const ix = state.ix
  if (!f || !ix) return
  const scope = ix.kids(f.id).length ? f : person(ix.parentOf(f.id)) || f
  $('handScope').textContent = scope.virtual ? 'the whole org, as rooms' : `everyone under ${scope.name}, as rooms`
  const lead = ix.kids(f.id).length ? f : person(ix.parentOf(f.id))
  $('handTeam').textContent = lead && !lead.virtual ? `plan ${lead.name}'s team` : 'plan the top-level team'
}

export function announce(text) {
  const el = $('announce')
  el.textContent = ''
  requestAnimationFrame(() => { el.textContent = text })
}
