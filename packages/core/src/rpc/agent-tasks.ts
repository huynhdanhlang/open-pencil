import * as v from 'valibot'

export const HELPER_LIMITS = {
  promptBytes: 8 * 1024,
  contextBytes: 64 * 1024,
  resultBytes: 64 * 1024,
  nodes: 200,
  deadlineMs: 180_000,
  receipts: 100,
  retentionMs: 24 * 60 * 60 * 1000
} as const

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}
const identifier = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(128),
  v.regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
)
export const agentDispatchSchema = v.strictObject({
  request_id: identifier,
  prompt: v.pipe(v.string(), v.minLength(1), v.maxLength(HELPER_LIMITS.promptBytes)),
  document_id: identifier,
  page_id: identifier,
  node_ids: v.pipe(v.array(identifier), v.minLength(1), v.maxLength(HELPER_LIMITS.nodes)),
  previous_task_id: v.optional(identifier)
})
export const agentTaskIdSchema = v.strictObject({ task_id: identifier })
export const agentTaskStatusSchema = v.picklist([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])
export type AgentTaskStatus = v.InferOutput<typeof agentTaskStatusSchema>
export type AgentDispatchInput = v.InferOutput<typeof agentDispatchSchema>
/** JSON Schema expresses character limits; this owner also enforces the UTF-8 wire budget. */
export function parseAgentDispatch(raw: unknown): AgentDispatchInput {
  const input = v.parse(agentDispatchSchema, raw)
  if (!input.prompt.trim() || utf8Bytes(input.prompt) > HELPER_LIMITS.promptBytes)
    throw new Error('Invalid helper prompt size')
  return input
}
export const agentSnapshotSchema = v.object({
  version: v.literal(1),
  document_id: identifier,
  page_id: identifier,
  node_ids: v.array(identifier),
  sha256: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))
})
export const agentTaskReceiptSchema = v.object({
  task_id: identifier,
  request_id: identifier,
  status: agentTaskStatusSchema,
  provider: v.string(),
  requested_model: v.nullable(v.string()),
  actual_model: v.nullable(v.string()),
  requested_effort: v.optional(v.nullable(v.string())),
  actual_effort: v.optional(v.nullable(v.string())),
  created_at: v.string(),
  updated_at: v.string(),
  completed_at: v.optional(v.string()),
  snapshot: agentSnapshotSchema,
  previous_task_id: v.optional(identifier),
  progress: v.optional(v.string()),
  result: v.optional(v.string()),
  error: v.optional(v.object({ code: v.string(), message: v.string() }))
})
export type AgentTaskReceipt = v.InferOutput<typeof agentTaskReceiptSchema>
export function helperTaskTerminal(status: AgentTaskStatus): boolean {
  return status !== 'queued' && status !== 'running'
}
