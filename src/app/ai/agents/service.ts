import { uniq } from 'es-toolkit/array'

import {
  parseAgentDispatch,
  HELPER_LIMITS,
  helperTaskTerminal,
  utf8Bytes
} from '@open-pencil/core/rpc'
import type { AgentDispatchInput, AgentTaskReceipt } from '@open-pencil/core/rpc'

import { createMutex } from '@/app/ai/tools/mutex'

import type { AgentTaskJournal, HelperRunner, HelperSnapshot, StoredAgentTask } from './types'

export class AgentTaskService {
  private readonly ready: Promise<void>
  private readonly acquire = createMutex()
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>()
  private readonly pendingTerminalWrites = new Map<string, StoredAgentTask>()
  private readonly now: () => number

  constructor(
    private readonly options: {
      journal: AgentTaskJournal
      run: HelperRunner
      now?: () => number
      event?: (name: string, receipt: AgentTaskReceipt) => void
    }
  ) {
    this.now = options.now ?? Date.now
    this.ready = options.journal.recover(this.now()).then(() => options.journal.prune(this.now()))
  }

  async dispatch(
    raw: AgentDispatchInput,
    capture: () => Promise<HelperSnapshot>
  ): Promise<AgentTaskReceipt> {
    const input = parseAgentDispatch(raw)
    input.node_ids = uniq(input.node_ids)
    const fingerprint = JSON.stringify(input)
    await this.ready
    const release = await this.acquire()
    try {
      await this.flushTerminalWrites()
      await this.options.journal.prune(this.now())
      const existing = await this.options.journal.findRequest(input.request_id)
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new Error('request_conflict: request_id already has a different payload')
        return structuredClone(existing.receipt)
      }
      if (this.active.size > 0)
        throw new Error('helper_busy: one dispatched helper is already active')
      let prompt = input.prompt
      if (input.previous_task_id) {
        const previous = await this.options.journal.read(input.previous_task_id)
        if (previous?.receipt.status !== 'completed')
          throw new Error('invalid_previous_task: feedback requires a retained completed result')
        prompt = `Previous advisory result:\n${previous.receipt.result ?? ''}\n\nMain agent feedback:\n${input.prompt}`
      }
      const snapshot = await capture()
      if (snapshot.provider !== 'acp:codex')
        throw new Error('unsupported_provider: snapshot helpers currently require configured Codex')
      if (
        utf8Bytes(snapshot.context) + utf8Bytes(prompt) - utf8Bytes(input.prompt) >
        HELPER_LIMITS.contextBytes
      )
        throw new Error('context_too_large: split the selected review scope')
      const { context, provider, requested_model, requested_effort, ...identity } = snapshot
      const timestamp = new Date(this.now()).toISOString()
      const record: StoredAgentTask = {
        input,
        fingerprint,
        context,
        prompt,
        receipt: {
          task_id: `task-${crypto.randomUUID()}`,
          request_id: input.request_id,
          status: 'queued',
          provider,
          requested_model,
          requested_effort: requested_effort ?? null,
          actual_model: null,
          actual_effort: null,
          created_at: timestamp,
          updated_at: timestamp,
          snapshot: identity,
          ...(input.previous_task_id ? { previous_task_id: input.previous_task_id } : {})
        }
      }
      const stored = await this.options.journal.reserve(record)
      if (stored.fingerprint !== fingerprint)
        throw new Error('request_conflict: request_id already has a different payload')
      if (stored.receipt.task_id !== record.receipt.task_id) return structuredClone(stored.receipt)
      const controller = new AbortController()
      const done = Promise.resolve().then(() => this.execute(record, controller))
      this.active.set(record.receipt.task_id, { controller, done })
      this.options.event?.('helper.dispatched', record.receipt)
      return structuredClone(record.receipt)
    } finally {
      release()
    }
  }

  async status(taskId: string): Promise<AgentTaskReceipt> {
    await this.ready
    await this.flushTerminalWrites(taskId)
    const record = await this.options.journal.read(taskId)
    if (!record || this.now() - Date.parse(record.receipt.updated_at) > HELPER_LIMITS.retentionMs)
      throw new Error('task_not_found: unknown or expired helper task')
    return structuredClone(record.receipt)
  }

  async cancel(taskId: string): Promise<AgentTaskReceipt> {
    await this.ready
    const active = this.active.get(taskId)
    if (active) {
      active.controller.abort()
      await active.done
    }
    return this.status(taskId)
  }

  private async execute(initial: StoredAgentTask, controller: AbortController): Promise<void> {
    let record = initial
    const timedOut = { value: false }
    const timer = setTimeout(() => {
      timedOut.value = true
      controller.abort()
    }, HELPER_LIMITS.deadlineMs)
    try {
      controller.signal.throwIfAborted()
      record = await this.options.journal.update({
        ...record,
        receipt: {
          ...record.receipt,
          status: 'running',
          progress: 'Reviewing supplied design snapshot',
          updated_at: new Date(this.now()).toISOString()
        }
      })
      if (helperTaskTerminal(record.receipt.status)) return
      const result = await this.options.run(
        {
          prompt: record.prompt,
          context: record.context,
          requestedModel: record.receipt.requested_model,
          requestedEffort: record.receipt.requested_effort
        },
        controller.signal,
        () => undefined
      )
      controller.signal.throwIfAborted()
      if (utf8Bytes(result.text) > HELPER_LIMITS.resultBytes) throw new Error('result_too_large')
      record.receipt = {
        ...record.receipt,
        status: 'completed',
        result: result.text,
        actual_model: result.model,
        actual_effort: result.effort ?? null,
        progress: 'Review complete'
      }
    } catch (error) {
      const rawCode = error instanceof Error ? error.message.split(':')[0] : 'helper_failed'
      const codes = [
        'unsupported_helper_boundary',
        'unsupported_provider',
        'result_too_large',
        'missing_adapter',
        'unavailable_login',
        'configured_model_mismatch',
        'configured_effort_mismatch'
      ]
      let code = codes.includes(rawCode) ? rawCode : 'helper_failed'
      if (controller.signal.aborted) code = 'cancelled'
      if (timedOut.value) code = 'helper_timeout'
      record.receipt = {
        ...record.receipt,
        status: code === 'cancelled' ? 'cancelled' : 'failed',
        error: {
          code,
          message:
            code === 'cancelled'
              ? 'Helper cancelled'
              : `Helper failed (${code}); no design changes were applied. Dispatch a new request to retry.`
        },
        progress: undefined
      }
    } finally {
      clearTimeout(timer)
      try {
        const timestamp = new Date(this.now()).toISOString()
        record = {
          ...record,
          receipt: { ...record.receipt, updated_at: timestamp, completed_at: timestamp }
        }
        this.pendingTerminalWrites.set(record.receipt.task_id, record)
        record = await this.options.journal.update(record)
        this.pendingTerminalWrites.delete(record.receipt.task_id)
        this.options.event?.('helper.finished', record.receipt)
      } catch {
        this.options.event?.('helper.persistence_failed', {
          ...record.receipt,
          error: { code: 'persistence_failed', message: 'Helper result could not be persisted' }
        })
      } finally {
        this.active.delete(initial.receipt.task_id)
      }
    }
  }

  private async flushTerminalWrites(taskId?: string): Promise<void> {
    const pending = taskId
      ? [this.pendingTerminalWrites.get(taskId)].filter((record) => record !== undefined)
      : [...this.pendingTerminalWrites.values()]
    for (const record of pending) {
      try {
        const persisted = await this.options.journal.update(record)
        this.pendingTerminalWrites.delete(record.receipt.task_id)
        this.options.event?.('helper.finished', persisted.receipt)
      } catch {
        throw new Error(
          'persistence_unavailable: helper result is awaiting durable storage; retry status'
        )
      }
    }
  }
}
