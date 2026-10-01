// Shared by the Node tests. js-yaml is the page's parser (pinned 4.3.2 from
// jsdelivr in index.html); Node borrows the monorepo root's copy when there is
// one, and a YAML test skips itself on a standalone clone instead of failing.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const MONOREPO = join(ROOT, '..', '..')

let yaml = null
try {
  yaml = (await import(join(MONOREPO, 'node_modules/js-yaml/dist/js-yaml.mjs'))).default
} catch { /* standalone clone: YAML tests skip */ }

export const hasYaml = !!yaml
export const yamlSkip = hasYaml ? false : 'js-yaml is not installed at the monorepo root'

/** The same call yaml.js makes in the page: CORE_SCHEMA, so dates stay strings. */
export const parseYaml = (text) => yaml.load(text, { schema: yaml.CORE_SCHEMA })
/** The same call yaml.js makes in the page: the DEFAULT schema, so date-like strings come out quoted. */
export const dumpYaml = (doc) => yaml.dump(doc, { lineWidth: 100, noRefs: true })

export const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8')
export const sampleRaw = () => parseYaml(readText('examples/lanternfish.yaml'))
