// ── The wires between cards ──────────────────────────────────
// Measured from the laid-out cards, never computed from the model, so a font,
// a long title or a phone layout can never leave a line pointing at air.
// The line from the top of the chart down to the focused person is the
// "path": brighter, with a pulse travelling down it.

const R = 10 // corner radius

export function drawWires(chart, v) {
  const svg = chart.querySelector('#wires')
  if (!svg) return
  const box = chart.getBoundingClientRect()
  const w = Math.ceil(chart.scrollWidth)
  const h = Math.ceil(chart.scrollHeight)
  svg.setAttribute('width', w)
  svg.setAttribute('height', h)
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)

  const at = (el) => {
    const r = el.getBoundingClientRect()
    return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top, cx: (r.left + r.right) / 2 - box.left, cy: (r.top + r.bottom) / 2 - box.top }
  }
  // One pass over the cards, then lookups: a querySelector per card was quadratic at a few thousand.
  const nodes = new Map([...chart.querySelectorAll('.node[data-person]')].map((el) => [el.dataset.person, el]))
  const nodeOf = (id) => nodes.get(id)
  const base = []
  const path = []
  const put = (d, onPath, extra = '') => (onPath ? path : base).push({ d, extra })

  // The chain: pill to pill, then the last pill to the lead.
  const stack = [...v.chain, v.parent].map(nodeOf).filter(Boolean).map(at)
  for (let i = 1; i < stack.length; i++) put(`M${stack[i - 1].cx} ${stack[i - 1].b}V${stack[i].t}`, true)

  // Lead to row: down, along a bus, down into each card.
  const lead = nodeOf(v.parent)
  if (lead && v.row.length) {
    const L = at(lead)
    const cards = v.row.map((id) => ({ id, el: nodeOf(id) })).filter((c) => c.el).map((c) => ({ id: c.id, ...at(c.el) }))
    const stacked = cards.length > 1 && cards.every((c) => Math.abs(c.cx - cards[0].cx) < 2)
    if (stacked) {
      // A phone stacks the row under the lead: a rail down the left, a branch into each card.
      const railX = L.l + 20
      for (const c of cards) {
        const r = Math.min(R, (c.cy - L.b) / 2, (c.l - railX) / 2)
        put(c.l > railX + 4 ? `M${railX} ${L.b}V${c.cy - r}Q${railX} ${c.cy} ${railX + r} ${c.cy}H${c.l}` : `M${railX} ${L.b}V${c.t}`, c.id === v.focus)
      }
    } else if (cards.length) {
      const busY = (L.b + Math.min(...cards.map((c) => c.t))) / 2
      for (const c of cards) {
        const dx = Math.sign(c.cx - L.cx)
        const r = Math.min(R, Math.abs(c.cx - L.cx) / 2, (c.t - busY) / 1.5, (busY - L.b) / 1.5)
        const d = dx === 0 || r < 1
          ? `M${L.cx} ${L.b}V${busY}H${c.cx}V${c.t}`
          : `M${L.cx} ${L.b}V${busY - r}Q${L.cx} ${busY} ${L.cx + dx * r} ${busY}H${c.cx - dx * r}Q${c.cx} ${busY} ${c.cx} ${busY + r}V${c.t}`
        put(d, c.id === v.focus)
      }
    }
  }

  // Each row card to its reports: a rail down the left, a branch into each.
  for (const col of chart.querySelectorAll('.col')) {
    const head = col.querySelector(':scope > .node')
    const list = col.querySelector(':scope > .reports')
    if (!head || !list) continue
    const H = at(head)
    const railX = H.l + 22
    for (const item of list.querySelectorAll(':scope > li > .node, :scope > li > .bucket')) {
      const c = at(item)
      if (c.l <= railX + 4) continue
      const r = Math.min(R, (c.cy - H.b) / 2, (c.l - railX) / 2)
      const dashed = item.classList.contains('bucket--open') ? ' stroke-dasharray="4 5"' : ''
      put(`M${railX} ${H.b}V${c.cy - r}Q${railX} ${c.cy} ${railX + r} ${c.cy}H${c.l}`, false, dashed)
    }
  }

  const parts = []
  for (const { d, extra } of base) parts.push(`<path class="wire" d="${d}"${extra}/>`)
  for (const { d } of path) parts.push(`<path class="wire wire--path" d="${d}"/><path class="wire wire--pulse" d="${d}"/>`)
  svg.innerHTML = `<defs><linearGradient id="wireGlow" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${h}">` +
    '<stop offset="0" style="stop-color:var(--accent-bright)"/><stop offset="1" style="stop-color:var(--wire-violet)"/></linearGradient></defs>' +
    parts.join('')
}

/** Redraw on resize without re-rendering the cards. */
export function redrawWires(chart, v) {
  if (v && chart.querySelector('#wires')) drawWires(chart, v)
}
