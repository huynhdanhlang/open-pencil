import type { AgentDispatchInput, AgentTaskReceipt } from '@open-pencil/core/rpc'

export type HelperSnapshot = AgentTaskReceipt['snapshot'] & {
  context: string
  provider: string
  requested_model: string | null
  requested_effort?: string | null
}
export type HelperRunInput = {
  prompt: string
  context: string
  requestedModel: string | null
  requestedEffort?: string | null
}
export type HelperRunResult = { text: string; model: string | null; effort?: string | null }
export type HelperRunner = (
  input: HelperRunInput,
  signal: AbortSignal,
  progress: (message: string) => void
) => Promise<HelperRunResult>
export type StoredAgentTask = {
  receipt: AgentTaskReceipt
  fingerprint: string
  input: AgentDispatchInput
  context: string
  prompt: string
}
export interface AgentTaskJournal {
  reserve(record: StoredAgentTask): Promise<StoredAgentTask>
  findRequest(id: string): Promise<StoredAgentTask | undefined>
  read(id: string): Promise<StoredAgentTask | undefined>
  update(record: StoredAgentTask): Promise<StoredAgentTask>
  recover(now: number): Promise<void>
  prune(now: number): Promise<void>
}
