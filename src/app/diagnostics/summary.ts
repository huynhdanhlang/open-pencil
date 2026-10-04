import type { DiagnosticEvent, DiagnosticValue } from './types'

export type DiagnosticEventSummary = {
  id: string
  category: string
  label: string
  /** A short line under the label, such as a duration or an error message. */
  detail: string | null
  level: DiagnosticEvent['level']
  timestamp: number
  /** Every recorded field, for the expanded row. */
  fields: [name: string, value: string][]
  stack: string | null
}

/** The diagnostics messages a summary reads; the app's `diagnostics` i18n namespace has them. */
export interface DiagnosticLabels {
  chatCompleted: string
  chatFailed: string
  storageFailed: string
  documentFailed: string
  acpFailed: string
  mcpFailed: string
  modelStep: (values: { model: string }) => string
  modelStepTokens: (values: { input: string; output: string }) => string
  toolCompleted: (values: { tool: string }) => string
  toolFailed: (values: { tool: string }) => string
  durationMs: (values: { ms: number }) => string
  runtimeError: (values: { name: string }) => string
}

function text(value: DiagnosticValue | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : String(value)
}

/** `errorName: message`, or whichever of the two was recorded. */
function errorDetail(attributes: DiagnosticEvent['attributes']): string | null {
  const name = text(attributes.errorName)
  const message = text(attributes.message)
  if (name && message) return `${name}: ${message}`
  return message ?? name ?? text(attributes.errorCode)
}

function describe(event: DiagnosticEvent, labels: DiagnosticLabels): [string, string | null] {
  const { attributes } = event
  switch (event.name) {
    case 'model.step.completed':
      return [
        labels.modelStep({ model: text(attributes.model) ?? '?' }),
        labels.modelStepTokens({
          input: text(attributes.inputTokens) ?? '?',
          output: text(attributes.outputTokens) ?? '?'
        })
      ]
    case 'tool.completed': {
      const tool = text(attributes.tool) ?? '?'
      const label =
        attributes.failed === true ? labels.toolFailed({ tool }) : labels.toolCompleted({ tool })
      const ms = attributes.durationMs
      const duration = typeof ms === 'number' ? labels.durationMs({ ms: Math.round(ms) }) : null
      return [label, text(attributes.message) ? errorDetail(attributes) : duration]
    }
    case 'chat.completed':
      return [labels.chatCompleted, text(attributes.finishReason)]
    case 'chat.failed':
      return [labels.chatFailed, errorDetail(attributes)]
    case 'runtime.error':
      return [
        labels.runtimeError({ name: text(attributes.errorName) ?? 'Error' }),
        text(attributes.message)
      ]
    case 'storage.operation.failed':
      return [labels.storageFailed, errorDetail(attributes)]
    case 'document.operation.failed':
      return [labels.documentFailed, errorDetail(attributes)]
    case 'acp.transport.failed':
      return [labels.acpFailed, errorDetail(attributes)]
    case 'mcp.connection.failed':
      return [labels.mcpFailed, errorDetail(attributes)]
    default:
      // The event's own name says more than a generic label.
      return [event.name, null]
  }
}

export function summarizeDiagnosticEvent(
  event: DiagnosticEvent,
  labels: DiagnosticLabels
): DiagnosticEventSummary {
  const [label, detail] = describe(event, labels)
  const { stack, ...rest } = event.attributes
  const fields = Object.entries(rest).flatMap(([name, value]): [string, string][] => {
    const shown = text(value)
    return shown === null ? [] : [[name, shown]]
  })
  if (event.durationMs !== undefined) fields.push(['durationMs', String(event.durationMs)])
  if (event.runId) fields.push(['runId', event.runId])
  return {
    id: event.id,
    category: event.category,
    label,
    detail,
    level: event.level,
    timestamp: event.timestamp,
    fields,
    stack: text(stack)
  }
}
