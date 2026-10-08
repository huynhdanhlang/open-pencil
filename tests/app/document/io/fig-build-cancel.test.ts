import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createFigBuildQueue } from '@/app/document/io/fig-build-queue'

test('cancelled queued work rejects before the active work finishes and never starts', async () => {
  const graph = new SceneGraph()
  const queue = createFigBuildQueue(() => graph)
  let release!: () => void
  const active = queue.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  await Promise.resolve()
  const cancel = new AbortController()
  let calls = 0
  const pending = queue.run(async () => {
    calls++
  }, cancel.signal)
  cancel.abort(new Error('Request expired before start'))
  await expect(pending).rejects.toThrow('Request expired before start')
  expect(calls).toBe(0)
  release()
  await active
  await queue.run(async () => {
    calls++
  })
  expect(calls).toBe(1)
})

test('cancellation after start does not race a committed mutation or free the lane early', async () => {
  const graph = new SceneGraph()
  const queue = createFigBuildQueue(() => graph)
  const cancel = new AbortController()
  let release!: () => void
  let finished = false
  const active = queue.run(
    () =>
      new Promise<void>((resolve) => {
        release = () => {
          finished = true
          resolve()
        }
      }),
    cancel.signal
  )
  await Promise.resolve()
  cancel.abort()
  const next = queue.run(async () => {
    expect(finished).toBe(true)
  })
  release()
  await Promise.all([active, next])
})

test('disposal releases pending payloads without waiting for an active build', async () => {
  const graph = new SceneGraph()
  const stable = createFigBuildQueue(() => graph)
  let release!: () => void
  const active = stable.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  await Promise.resolve()
  const pending = stable.run(async () => {
    throw new Error('Must not start')
  })
  stable.dispose()
  await expect(pending).rejects.toThrow('Document changed before FIG build')
  release()
  await active
})
