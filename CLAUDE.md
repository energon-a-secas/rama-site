# CLAUDE.md: Rama

Org chart explorer: load an organization from one YAML, JSON or CSV document,
open on your own card, walk up to your manager and across to peers, see the
whole org as rings, and hand the same people to Floorplan (rooms) and Reparto
(sprint capacity) through their link contracts. For anyone who needs to find
their way around an org, and for the manager who keeps the document.

**Live:** rama.neorgon.com · **Port:** 8896

## Run

```bash
make serve     # http://localhost:8896 (ES modules: file:// will not load them)
make test      # node --test over the pure core: schema, tree, handoffs, formats
```

The only dependency is js-yaml 4.3.2 from jsdelivr (pinned, SRI, allowed by exact path in the CSP),
loaded as a global before `js/app.js`. The Node tests borrow the monorepo root's js-yaml and skip
their YAML cases on a standalone clone.

## Architecture

The document is the source of truth; `readDoc()` is the one gate in front of it, and every view
reads the index `indexOrg()` builds from the model.

| Module | Owns |
|---|---|
| `js/schema.js` | `normalizeOrg(raw)`: a parsed tree to `{ model, issues }` (people, roles, fields, profiles, extras, reporting lines, loop cutting); `orgToDoc(model)` back to a canonical tree. **The contract**, written out in `llms.txt` |
| `js/teams.js`, `js/roles.js` | teams in Floorplan's group shape (member forms, shares, `person.team`); the built-in role catalogue and `guessTrack()` |
| `js/tree.js` | `indexOrg()`: children, chain, depth, division, org size (people, never open seats), teams per person, stats, the virtual `__org` top; `focusView()`; `searchPeople()` with accent folding and `matchRange()` for marking a hit; `between()`, the closest shared manager and the route through them |
| `js/handoff.js` | `toFloorplanDoc()` (team leads hand over as their team, other managers as reporting-line rooms, three levels, explicit ids) and `toRepartoDoc()` (one manager's direct reports, 40-character ids, 400 cap), plus the `#d=` and `#p=` links |
| `js/formats.js`, `js/core.js` | CSV in and out, Mermaid, vCard; slug, `unfold()` (ł, ß and the other letters NFKD keeps whole, shared by ids and search), `str()` (control characters out, no split surrogates), `safeUrl`, `safeColor`, `fieldHref`, base64url; `clockAt()` and `dayPart()` for local time |
| `js/docio.js`, `js/yaml.js` | text in and out: format sniffing, `readDoc()`, `#d=`, `?src=`; js-yaml with CORE_SCHEMA to read and the default schema to write |
| `js/state.js`, `js/me.js` | the document text and model, view state (`ui`), preferences, the per-org "this is me" pick; `resolveMe()` (`?me=` > picked > account email) |
| `js/render.js`, `js/render-chart.js`, `js/wires.js` | the page and the chart: chain pills, lead card, row, columns, buckets; wires measured from the laid-out cards |
| `js/overview.js` | the radial overview: division wedges, rings, the lit path and the visitor's violet route to it, pan and zoom, colour modes and the legend |
| `js/panel.js`, `js/people.js`, `js/markdown.js` | the profile panel; avatars, hues, status words and card labels; escape-first markdown |
| `js/nav.js` | `go(id)`, the only way the focus changes: view transitions, history (`?at=`), arrow-key steps |
| `js/search.js`, `js/editor.js`, `js/actions.js`, `js/boot.js`, `js/menus.js`, `js/events.js` | the palette and the picker, the document editor, exports and handoffs, the first document and card, header menus, wiring |
| `examples/lanternfish.yaml` | the invented sample org; fetched on a first visit, never saved until the visitor edits |

Vendored from `packages/neorgon-ui/`, never edit in place: `js/neorgon-{header,footer,beacon,dom,persist,auth,auth-sites}.js`, `js/neokeys/*.js` (the Keys kit), `css/neorgon-*.css`.

**Shortcuts are data, registered with the Keys kit** in `events.js` (`bindKeys()`): `?` is the kit's sheet, which lists them, turns them off and remaps them (WCAG 2.1.4). A new single-key shortcut goes there, never into a raw keydown handler; `onKey` keeps only Ctrl or Cmd+K and Escape. `e` is the fleet's export key, which is why Edit the document is `D`.

## Data

- `localStorage['rama-site:doc']` (persist kit, version 1) holds `{ text, format, title, savedAt }`: the visitor's **text**, comments and all, never the model. A CSV arrives as the YAML it was converted to.
- **Every org that arrives puts the saved one on the Restore list first** (`openDoc` in state.js). Links, imports, blank orgs and restores are saved at once; the example and a `?src=` file are shown, and saved only when edited (an edited `?src=` org drops `?src=` from the URL so a reload shows the edit). An unreadable document changes nothing, not even the list.
- `rama-site:previous` (version 2) is that Restore list: the last 8 orgs, newest first, deduplicated by text. Version 1 held one org and migrates to a one-entry list.
- `rama-site:preferences` holds `{ picked: { <org key>: <person id> }, view, panel, colorBy }`. The org key is the title's slug, or a hash of the title when it has no Latin letters.
- `ui` (focus, view, panel, colour mode, open buckets) is never part of a document.
- Signing in (Auth Kit, production Clerk) is used only to read the account's email addresses and match them to `people[].email`. Nothing is stored per account.

## Gotchas

- **`go(id)` is the only way to move.** It names the page frame (header, stage bar, panel, footer) `rama-frame-N` for one transition only, so chart.css can stack it above the cards in flight; the names are inline and removed after, so no site CSS touches the header kit. Every card is named `p-<id>`; ids are slugs, so the names are valid and unique per render.
- **`plan()` in render-chart.js decides what the chart draws**: the chain folds to the top plus four levels, the row to twelve peers around the focus, each column to eight. The view-transition gate in nav.js counts cards from the same `plan()`, and past 150 cards a move cuts instead of morphing. Draw something new in the chart, count it in `plan()`.
- **The panel renders before the chart.** Opening it narrows the stage, and `drawWires()` measures the final layout. Swap the order and every wire points at air.
- **Nothing on `<body>` may carry `data-view`.** The click delegation asks for `button[data-view]`; a `data-view` on the body once swallowed every action button. The body's view flag is `data-mode`.
- **Every count on the page is people, never open seats**: the stage bar, the overview legend and the wedge labels agree. Open roles get a legend row of their own only when colouring by employment.
- **Local time goes stale on an open tab.** In that colour mode the overview's build key carries a quarter-hour stamp, so the first move after it turns over recolours the dots; nothing ticks on its own.
- **The overview sizes marks in screen pixels.** `--u` on the SVG is drawing units per pixel, set when the overview is built (its key includes the SVG's size), and labels, the path and the halo multiply by it.
- **Floorplan slugs with NFD, Rama with NFKD.** The handoff writes every person's `id` explicitly so the two never disagree. Floorplan caps ids at 48, Reparto at 40; `toRepartoDoc` shortens and de-duplicates.
- **Profiles resolve once, before any person reads one** (`resolveProfiles` in schema.js), in declaration order and at most 32 deep. Resolving on demand was exponential for a diamond of shared parents (a short link hung the tab), made a cycle come out differently depending on who extended it first, and overflowed the stack on a long chain. Floorplan groups use the same profiles (`applyTeamProfile`: scalars override, `members` and `owns` add up).
- **`test/regressions.test.mjs` holds one test per defect the verification workflow confirmed.** A fix to the core gets its test there, named after the defect.
- **`str()` is the first line against injection**: it turns CR into LF and drops other control characters, so a value cannot start a vCard or CSV line. `formats.js` escapes again on the way out.
- **A document is untrusted input**: it can arrive from a stranger's `#d=` link or `?src=` URL. Interpolate through `escHtml`, colours through `safeColor`, links through `safeUrl`/`fieldHref`. The meta CSP is the second layer: no inline script beyond the theme guard's hash.
- **A foreign document's photos do not load until the visitor says so** (`state.foreign`, set for `#d=` and `?src=`, kept in the saved record and the Restore list). Each person can carry a unique photo URL, and which ones load (around the card Rama centres on, found by the visitor's account email) would tell the host who opened the link. The notice offers Show photos; `trustDoc()` clears the flag.
- **`img-src` and `connect-src` carry `https:`** on purpose (`photo:` URLs and `?src=`). Narrowing them would break both; the rest of the policy is exact hosts.
- **No Markdown is published**: `_config.yml` excludes it, so `/CLAUDE.html` must answer 404 after a push. `llms.txt` is served on purpose.

## Do not touch

- `js/neorgon-*.js`, `js/neokeys/*.js` and `css/neorgon-*.css`: vendored kits, regenerated by `packages/neorgon-ui/sync-*.sh`.
