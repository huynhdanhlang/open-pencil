import { pick } from 'es-toolkit'
import * as v from 'valibot'

import { describeDiagnosticError, diagnosticErrorDetails, isInternalError } from '../error'
import { recordDiagnostic } from '../recorder'
import { isUsageEnabled } from '../settings'
import type { DiagnosticEvent, DiagnosticLevel, DiagnosticValue } from '../types'

const modelStepSchema = v.object({
  provider: v.string(),
  model: v.string(),
  inputTokens: v.nullable(v.number()),
  outputTokens: v.nullable(v.number()),
  cacheReadTokens: v.nullable(v.number()),
  cacheWriteTokens: v.nullable(v.number())
})

const chatCompletedSchema = v.object({ finishReason: v.nullable(v.string()) })
const chatFailedSchema = v.object({
  errorName: v.string(),
  errorCode: v.optional(v.nullable(v.string())),
  message: v.optional(v.nullable(v.string())),
  stack: v.optional(v.nullable(v.string()))
})
const toolCompletedSchema = v.object({
  tool: v.string(),
  durationMs: v.number(),
  mutates: v.boolean(),
  failed: v.boolean(),
  errorName: v.optional(v.string()),
  message: v.optional(v.nullable(v.string())),
  stack: v.optional(v.nullable(v.string()))
})

export type AIDiagnosticContext = Pick<DiagnosticEvent, 'sessionId' | 'runId'>

function recordAIEvent(
  name: 'model.step.completed' | 'chat.completed' | 'chat.failed' | 'tool.completed',
  attributes: Record<string, DiagnosticValue>,
  schema: v.GenericSchema,
  context: AIDiagnosticContext = {},
  level: DiagnosticLevel = name === 'chat.failed' ? 'error' : 'info'
): void {
  const parsed = v.safeParse(schema, attributes)
  if (!parsed.success) {
    console.warn(`[Diagnostics] Invalid AI event: ${name}`)
    return
  }
  if (name === 'model.step.completed' && !isUsageEnabled()) return
  const output = parsed.output as Record<string, DiagnosticValue>
  recordDiagnostic({
    ...context,
    category: 'ai',
    level,
    name,
    attributes: output
  } satisfies Omit<DiagnosticEvent, 'id' | 'timestamp'>)
}

export function recordModelStepCompleted(
  input: v.InferOutput<typeof modelStepSchema>,
  context?: AIDiagnosticContext
): void {
  recordAIEvent('model.step.completed', input, modelStepSchema, context)
}

export function recordChatCompleted(
  input: v.InferOutput<typeof chatCompletedSchema>,
  context?: AIDiagnosticContext
): void {
  recordAIEvent('chat.completed', input, chatCompletedSchema, context)
}

export function recordChatFailed(
  input: v.InferOutput<typeof chatFailedSchema>,
  context?: AIDiagnosticContext
): void {
  recordAIEvent('chat.failed', input, chatFailedSchema, context)
}

/**
 * A failed tool is a warning, since models often call one wrongly. When the engine itself
 * broke, it is an error with the message and stack; otherwise only the error's name is kept.
 */
export function recordToolCompleted(
  input: Omit<v.InferOutput<typeof toolCompletedSchema>, 'errorName' | 'message' | 'stack'>,
  context?: AIDiagnosticContext,
  cause?: unknown
): void {
  const record = (attributes: Record<string, DiagnosticValue>, level: DiagnosticLevel) =>
    recordAIEvent(
      'tool.completed',
      { ...input, ...attributes },
      toolCompletedSchema,
      context,
      level
    )
  if (!input.failed) return record({}, 'info')
  if (isInternalError(cause)) {
    return record(pick(diagnosticErrorDetails(cause), ['errorName', 'message', 'stack']), 'error')
  }
  record(cause === undefined ? {} : pick(describeDiagnosticError(cause), ['errorName']), 'warning')
}
