/** A pattern and what replaces each match, applied with `String.replace`. */
type ScrubRule = readonly [pattern: RegExp, replacement: string]

const REDACTED = '[redacted]'

/** Queries, fragments, and inline credentials, which carry keys, tokens, and document names. */
const URL_RULES: ScrubRule[] = [
  [/\b((?:https?|tauri|file):\/\/[^\s?#'")]*)[?#][^\s'")]*/g, '$1'],
  // A query on a bare path or file name, such as `/Designs/app.fig?token=…`.
  [/([^\s?'"(]*[/.][^\s?#'")]*)\?[^\s'")]+/g, '$1'],
  [/(\/\/)[^/\s:@]+:[^/\s@]+@/g, `$1${REDACTED}@`]
]

/**
 * Credentials the shape rules below miss, after gitleaks (MIT, https://github.com/gitleaks/gitleaks):
 * AWS access key IDs are too short for the long-run rule, and a JWT's dots split it into runs
 * while its payload can name the user.
 */
const CREDENTIAL_RULES: ScrubRule[] = [
  [
    /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g,
    REDACTED
  ],
  [/\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g, REDACTED],
  [/\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g, REDACTED],
  [/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`],
  // Prefixed keys such as `sk-ant-…`, `sk-proj-…`, `sk_live_…`, and `rk_live_…`.
  [/\b(?:sk|pk|rk|key|token|secret)[-_][\w-]{8,}/gi, REDACTED],
  // Long unbroken runs are keys or encoded content, not code locations.
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, REDACTED]
]

/** Details that identify a person. A domain needs a letter TLD, so `vue@3.5.41` stays. */
const PERSONAL_RULES: ScrubRule[] = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g, REDACTED],
  [/(\/(?:Users|home)\/)[^/\s]+/g, '$1~'],
  [/([A-Za-z]:\\Users\\)[^\\\s]+/g, '$1~']
]

// URL rules run first, so that `user:pass@host` is not left half-redacted as an email.
const RULES: readonly ScrubRule[] = [...URL_RULES, ...CREDENTIAL_RULES, ...PERSONAL_RULES]

/**
 * Remove what could unlock an account or identify a person from an error message or stack
 * before it is stored: URL queries and credentials, keys and tokens, emails, and the user's
 * name in home folder paths.
 */
export function scrubDiagnosticText(text: string): string {
  return RULES.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text
  )
}
