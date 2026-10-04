import { diagnosticErrorDetails } from '../error'
import { recordDiagnostic } from '../recorder'

/** Where an uncaught failure surfaced: the window, an unhandled rejection, or a Vue component. */
export type RuntimeErrorSource = 'window' | 'rejection' | 'vue'

/** A render loop can throw every frame; one record per distinct error per window is enough. */
const REPEAT_WINDOW_MS = 2000
let lastError: { key: string; at: number } | null = null

/**
 * Record an uncaught error with its scrubbed message and stack. `info` is Vue's hint about
 * where a component error happened, such as `render function` or `watcher callback`.
 */
export function recordRuntimeError(
  error: unknown,
  source: RuntimeErrorSource,
  info?: string
): void {
  const details = diagnosticErrorDetails(error)
  const key = `${source}\n${details.errorName}\n${details.message ?? ''}\n${details.stack ?? ''}`
  const now = Date.now()
  if (lastError?.key === key && now - lastError.at < REPEAT_WINDOW_MS) return
  lastError = { key, at: now }
  recordDiagnostic({
    category: 'runtime',
    level: 'error',
    name: 'runtime.error',
    attributes: {
      source,
      errorName: details.errorName,
      errorCode: details.errorCode,
      message: details.message,
      stack: details.stack,
      info: info ?? null
    }
  })
}
