import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import { createAgentTaskJournal } from '@/app/ai/agents/journal'
import { AgentTaskService } from '@/app/ai/agents/service'

const input = {
  request_id: 'review-1',
  prompt: 'Review layout',
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
  context: '<Frame name="Card" />',
  provider: 'acp:codex',
  requested_model: 'gpt-6.1-sol'
})
const journal = () => createAgentTaskJournal('helper-test-' + crypto.randomUUID())
async function failure(operation: Promise<unknown>): Promise<string> {
  try {
    await operation
    throw new Error('Expected rejection')
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
async function settled(owner: AgentTaskService, id: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (!['queued', 'running'].includes((await owner.status(id)).status)) return
    await Bun.sleep(1)
  }
  throw new Error('Task did not settle')
}

test('concurrent identical dispatch creates one real task and conflicting retry is rejected', async () => {
  let runs = 0
  const owner = new AgentTaskService({
    journal: journal(),
    run: async () => {
      runs++
      return { text: 'Increase padding', model: 'gpt-6.1-sol[high]' }
    }
  })
  const [first, replay] = await Promise.all([
    owner.dispatch(input, capture),
    owner.dispatch(input, capture)
  ])
  expect(first.task_id).toBe(replay.task_id)
  await settled(owner, first.task_id)
  expect(runs).toBe(1)
  expect((await owner.status(first.task_id)).result).toBe('Increase padding')
  expect(await failure(owner.dispatch({ ...input, prompt: 'Different' }, capture))).toContain(
    'request_conflict'
  )
  const noCapture = async () => {
    throw new Error('Original tab closed')
  }
  expect((await owner.dispatch(input, noCapture)).task_id).toBe(first.task_id)
})

test('cancel releases the single helper slot and repeat cancel is idempotent', async () => {
  const owner = new AgentTaskService({
    journal: journal(),
    run: async (_, signal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return { text: 'cancelled', model: null }
    }
  })
  const task = await owner.dispatch(input, capture)
  expect(await failure(owner.dispatch({ ...input, request_id: 'second' }, capture))).toContain(
    'helper_busy'
  )
  expect((await owner.cancel(task.task_id)).status).toBe('cancelled')
  expect((await owner.cancel(task.task_id)).status).toBe('cancelled')
  const next = await owner.dispatch({ ...input, request_id: 'third' }, capture)
  expect(next.task_id).not.toBe(task.task_id)
  await owner.cancel(next.task_id)
})

test('feedback includes immutable previous result and links a new task', async () => {
  const received: string[] = []
  const owner = new AgentTaskService({
    journal: journal(),
    run: async (run) => {
      received.push(run.prompt)
      return { text: 'Review ' + received.length, model: 'configured' }
    }
  })
  const first = await owner.dispatch(input, capture)
  await settled(owner, first.task_id)
  const next = await owner.dispatch(
    {
      ...input,
      request_id: 'correction',
      prompt: 'Explain tradeoffs',
      previous_task_id: first.task_id
    },
    capture
  )
  await settled(owner, next.task_id)
  expect(received[1]).toContain('Review 1')
  expect((await owner.status(first.task_id)).result).toBe('Review 1')
  expect((await owner.status(next.task_id)).previous_task_id).toBe(first.task_id)
})

test('restart interrupts pending state without rerunning inference', async () => {
  const store = journal()
  const owner = new AgentTaskService({
    journal: store,
    run: async (_, signal) => {
      await new Promise<void>((r) => {
        signal.addEventListener('abort', () => r(), { once: true })
      })
      return { text: '', model: null }
    }
  })
  const task = await owner.dispatch(input, capture)
  await store.recover(Date.now())
  expect((await store.read(task.task_id))?.receipt.status).toBe('interrupted')
  await owner.cancel(task.task_id)
})

test('UTF-8 prompt limit is enforced before capturing or starting a helper', async () => {
  let runs = 0
  const owner = new AgentTaskService({
    journal: journal(),
    run: async () => {
      runs++
      return { text: '', model: null }
    }
  })
  expect(await failure(owner.dispatch({ ...input, prompt: '界'.repeat(2800) }, capture))).toContain(
    'Invalid'
  )
  expect(runs).toBe(0)
})
