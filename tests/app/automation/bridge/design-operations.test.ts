import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  runDesignOperation,
  getDesignOperation,
  cancelDesignOperation
} from '@/app/automation/bridge/design-operations'

test('long operation retains exact result without repeating mutation and refuses duplicate work', async () => {
  const graph = new SceneGraph()
  const other = new SceneGraph()
  const controller = new AbortController()
  let release!: () => void
  let calls = 0
  let acknowledged = false
  const context = {
    id: crypto.randomUUID(),
    signal: controller.signal,
    onAccepted: () => {
      acknowledged = true
    },
    cancel: () => controller.abort()
  }
  const work = runDesignOperation(graph, context, async () => {
    calls++
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return { ok: true, result: { id: 'owned-frame' } }
  })
  expect(acknowledged).toBe(true)
  expect(getDesignOperation(graph, context.id).status).toBe('pending')
  expect(() => getDesignOperation(other, context.id)).toThrow('not found')
  await expect(
    runDesignOperation(graph, { id: crypto.randomUUID() }, async () => {
      calls++
    })
  ).rejects.toThrow('still running')
  expect(cancelDesignOperation(graph, context.id).status).toBe('pending')
  expect(controller.signal.aborted).toBe(true)
  release()
  expect(await work).toEqual({ ok: true, result: { id: 'owned-frame' } })
  expect(getDesignOperation(graph, context.id)).toMatchObject({
    status: 'completed',
    response: { ok: true, result: { id: 'owned-frame' } }
  })
  expect(calls).toBe(1)
})

test('failed operation preserves error and bounded history replaces old receipts', async () => {
  const graph = new SceneGraph()
  const ids = Array.from({ length: 6 }, () => crypto.randomUUID())
  await expect(
    runDesignOperation(graph, { id: ids[0]! }, async () => {
      throw new Error('Owned failure')
    })
  ).rejects.toThrow('Owned failure')
  expect(getDesignOperation(graph, ids[0]!)).toMatchObject({
    status: 'failed',
    error: 'Owned failure'
  })
  for (const id of ids.slice(1))
    await runDesignOperation(graph, { id }, async () => ({ saved: true }))
  expect(() => getDesignOperation(graph, ids[0]!)).toThrow('not found')
  expect(getDesignOperation(graph, ids.at(-1)!)).toMatchObject({
    status: 'completed',
    response: { saved: true }
  })
})

test('completed receipt owns borrowed child arrays and limits retained result bytes', async () => {
  const graph = new SceneGraph()
  const children = ['first']
  const id = crypto.randomUUID()
  await runDesignOperation(graph, { id }, async () => ({ children }))
  children.push('later edit')
  expect(getDesignOperation(graph, id).response).toEqual({ children: ['first'] })
  const large = crypto.randomUUID()
  await runDesignOperation(graph, { id: large }, async () => ({ text: 'x'.repeat(600_000) }))
  expect(getDesignOperation(graph, large).status).toBe('completed')
  expect(getDesignOperation(graph, large).response).toBeUndefined()
  expect(getDesignOperation(graph, large).result_unavailable).toContain('512 KiB')
})
