// ── Role catalogue ───────────────────────────────────────────
// The built-in roles a document can name by id (`role: eng-manager`) without
// declaring them. A document's own `roles:` merges over these by id, so a
// team can rename a title or recolour a track without restating the rest.
// Pure: no DOM, Node-tested.

/** track: exec | management | ic | support. level is a label, never maths. */
export const DEFAULT_ROLES = {
  ceo: { title: 'Chief Executive Officer', track: 'exec', level: 'E1' },
  cto: { title: 'Chief Technology Officer', track: 'exec', level: 'E1' },
  cpo: { title: 'Chief Product Officer', track: 'exec', level: 'E1' },
  coo: { title: 'Chief Operating Officer', track: 'exec', level: 'E1' },
  'vp-engineering': { title: 'VP, Engineering', track: 'exec', level: 'E2' },
  'vp-product': { title: 'VP, Product', track: 'exec', level: 'E2' },
  'eng-director': { title: 'Director, Engineering', track: 'management', level: 'M3' },
  'product-director': { title: 'Director, Product', track: 'management', level: 'M3' },
  'design-director': { title: 'Director, Design', track: 'management', level: 'M3' },
  'eng-manager-sr': { title: 'Senior Engineering Manager', track: 'management', level: 'M2' },
  'eng-manager': { title: 'Engineering Manager', track: 'management', level: 'M1' },
  'design-manager': { title: 'Design Manager', track: 'management', level: 'M1' },
  'principal-engineer': { title: 'Principal Engineer', track: 'ic', level: 'IC6' },
  'staff-engineer': { title: 'Staff Engineer', track: 'ic', level: 'IC5' },
  'lead-engineer': { title: 'Lead Software Engineer', track: 'ic', level: 'IC4' },
  'senior-engineer': { title: 'Senior Software Engineer', track: 'ic', level: 'IC3' },
  engineer: { title: 'Software Engineer', track: 'ic', level: 'IC2' },
  'associate-engineer': { title: 'Associate Software Engineer', track: 'ic', level: 'IC1' },
  sre: { title: 'Site Reliability Engineer', track: 'ic', level: 'IC3' },
  'lead-sre': { title: 'Lead Site Reliability Engineer', track: 'ic', level: 'IC4' },
  'data-engineer': { title: 'Data Engineer', track: 'ic', level: 'IC3' },
  'qa-engineer': { title: 'Quality Engineer', track: 'ic', level: 'IC2' },
  'security-engineer': { title: 'Security Engineer', track: 'ic', level: 'IC3' },
  'product-manager': { title: 'Product Manager', track: 'ic', level: 'P2' },
  'senior-pm': { title: 'Senior Product Manager', track: 'ic', level: 'P3' },
  designer: { title: 'Product Designer', track: 'ic', level: 'D2' },
  'senior-designer': { title: 'Senior Product Designer', track: 'ic', level: 'D3' },
  researcher: { title: 'UX Researcher', track: 'ic', level: 'D2' },
  'tech-writer': { title: 'Technical Writer', track: 'support', level: 'IC2' },
  'program-manager': { title: 'Technical Program Manager', track: 'support', level: 'P3' },
  'chief-of-staff': { title: 'Chief of Staff', track: 'support', level: 'M2' },
  'exec-assistant': { title: 'Executive Assistant', track: 'support', level: 'S2' },
  contractor: { title: 'Contract Engineer', track: 'ic', level: '' },
}

export const TRACKS = ['exec', 'management', 'ic', 'support']

/** Colour per track, used when a role sets none. Hex only: it lands in style attributes. */
export const TRACK_COLORS = { exec: '#f472b6', management: '#a78bfa', ic: '#38bdf8', support: '#fbbf24' }

const EXEC_WORDS = /\b(chief|ceo|cto|cfo|coo|cpo|ciso|president|founder|vp|vice president|svp|evp|general manager)\b/i
const MGMT_WORDS = /\b(manager|director|head of|mgr|lead of)\b/i
const SUPPORT_WORDS = /\b(assistant|coordinator|chief of staff|program manager|writer|operations)\b/i

/** A free-text title's track, for people whose role is not in the catalogue. */
export function guessTrack(title = '') {
  if (EXEC_WORDS.test(title)) return 'exec'
  if (SUPPORT_WORDS.test(title)) return 'support'
  if (MGMT_WORDS.test(title)) return 'management'
  return 'ic'
}
