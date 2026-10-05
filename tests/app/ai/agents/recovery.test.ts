import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import { createAgentTaskJournal } from '@/app/ai/agents/journal'
import { AgentTaskService } from '@/app/ai/agents/service'

test('a transient terminal-write failure is retried by status and does not permanently block dispatch', async () => {
  const backing = createAgentTaskJournal('recovery-test-' + crypto.randomUUID())
  let failTerminal = true
  const journal = {
    ...backing,
    async update(record: Parameters<typeof backing.update>[0]) {
      if (record.receipt.status === 'completed' && failTerminal) {
        failTerminal = false
        throw new Error('Disk temporarily unavailable')
      }
      return backing.update(record)
    }
  }
  const owner = new AgentTaskService({
    journal,
    run: async () => ({ text: 'Useful review', model: 'configured' })
  })
  const input = {
    request_id: 'first',
    prompt: 'Review',
    document_id: 'tab-test',
    page_id: '0:1',
    node_ids: ['0:2']
  }
  const capture = async () => ({
    version: 1 as const,
    document_id: 'tab-test',
    page_id: '0:1',
    node_ids: ['0:2'],
    sha256: 'a'.repeat(64),
    context: '<Frame />',
    provider: 'acp:codex',
    requested_model: null
  })
  const task = await owner.dispatch(input, capture)
  let status = await owner.status(task.task_id)
  for (let i = 0; i < 100 && status.status !== 'completed'; i++) {
    await Bun.sleep(1)
    status = await owner.status(task.task_id)
  }
  expect(status.status).toBe('completed')
  expect(status.result).toBe('Useful review')
  const next = await owner.dispatch({ ...input, request_id: 'next' }, capture)
  expect(next.task_id).not.toBe(task.task_id)
  await owner.cancel(next.task_id)
})
