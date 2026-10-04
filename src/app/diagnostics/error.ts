export type DiagnosticErrorInfo = {
  errorName: string
  errorCode: string | null
  retryable: boolean | null
}

function isRetryableError(error: unknown): boolean | null {
  if (!(error instanceof Error)) return null
  if (error.name === 'AbortError') return false
  if ('status' in error && typeof error.status === 'number') {
    return error.status === 408 || error.status === 429 || error.status >= 500
  }
  return null
}

export function describeDiagnosticError(error: unknown): DiagnosticErrorInfo {
  if (!(error instanceof Error)) {
    return { errorName: 'UnknownError', errorCode: null, retryable: null }
  }
  const code = 'code' in error && typeof error.code === 'string' ? error.code : null
  return { errorName: error.name || 'Error', errorCode: code, retryable: isRetryableError(error) }
}

export type DiagnosticErrorDetails = DiagnosticErrorInfo & {
  message: string | null
  stack: string | null
}

const MAX_MESSAGE_LENGTH = 500
const MAX_STACK_LINES = 25
const MAX_STACK_LENGTH = 4000

const SCRUBBERS: [RegExp, string][] = [
  // Query strings and fragments can carry keys, tokens, and document names.
  [/\b((?:https?|tauri|file):\/\/[^\s?#'")]*)[?#][^\s'")]*/g, '$1'],
  // So can a query on a bare path or file name, such as `/Designs/app.fig?token=…`.
  [/([^\s?'"(]*[/.][^\s?#'")]*)\?[^\s'")]+/g, '$1'],
  [/\bBearer\s+\S+/gi, 'Bearer [redacted]'],
  [/\b(?:sk|pk|rk|key|token|secret)[-_][A-Za-z0-9_-]{8,}/gi, '[redacted]'],
  // Long unbroken runs are keys or encoded content, not code locations.
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]'],
  [/(\/(?:Users|home)\/)[^/\s]+/g, '$1~'],
  [/([A-Za-z]:\\Users\\)[^\\\s]+/g, '$1~']
]

function scrub(text: string): string {
  return SCRUBBERS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text
  )
}

/**
 * AI SDK and provider errors (`AI_APICallError`, `AI_InvalidPromptError`, …) and errors that
 * carry a response can quote prompts, responses, or request URLs in their message.
 */
function mayQuoteContent(error: Error): boolean {
  return error.name.startsWith('AI_') || 'responseBody' in error || 'requestBodyValues' in error
}

/**
 * Errors the engine raises on its own bugs, such as `x.map is not a function`. Their messages
 * name code, not content, unlike the errors a tool throws on purpose, which quote its input.
 */
export function isInternalError(error: unknown): error is Error {
  return (
    error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError
  )
}

/**
 * The metadata of `describeDiagnosticError`, plus the message and stack of a runtime failure,
 * scrubbed of URL queries, key-like strings, and home folder names and bounded in length.
 * A provider error keeps its stack but not its message, which can quote user content.
 */
export function diagnosticErrorDetails(error: unknown): DiagnosticErrorDetails {
  const info = describeDiagnosticError(error)
  if (!(error instanceof Error)) {
    const text = typeof error === 'string' ? error : null
    return { ...info, message: text ? scrub(text).slice(0, MAX_MESSAGE_LENGTH) : null, stack: null }
  }
  const stack = error.stack
    ? scrub(error.stack).split('\n').slice(0, MAX_STACK_LINES).join('\n').slice(0, MAX_STACK_LENGTH)
    : null
  const message = mayQuoteContent(error) ? null : scrub(error.message).slice(0, MAX_MESSAGE_LENGTH)
  return { ...info, message: message || null, stack }
}
