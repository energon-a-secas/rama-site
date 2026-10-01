// ── YAML ─────────────────────────────────────────────────────
// js-yaml 4.3.2 is loaded as a global before app.js (pinned, SRI, allowed by
// exact path in the CSP). CORE_SCHEMA keeps 2026-10-01 a string instead of a
// Date, and refuses the custom tags a hostile document could carry.

const lib = () => {
  if (!window.jsyaml) throw new Error('The YAML parser did not load; JSON still works')
  return window.jsyaml
}

export const parseYaml = (text) => lib().load(text, { schema: lib().CORE_SCHEMA, json: true })

export const dumpYaml = (doc) => lib().dump(doc, { lineWidth: 100, noRefs: true, schema: lib().CORE_SCHEMA })

export const yamlReady = () => !!window.jsyaml
