import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createFigBuildQueue } from '@/app/document/io/fig-build-queue'

for (const change of ['replacement', 'disposal'] as const) {
  test(`queued FIG builds cannot cross document ${change}`, async () => {
    let graph = new SceneGraph()
    const queue = createFigBuildQueue(() => graph)
    let release!: (bytes: Uint8Array) => void
    const first = queue.run(
      () =>
        new Promise<Uint8Array>((resolve) => {
          release = resolve
        })
    )
    await Promise.resolve()
    let calls = 0
    const queued = queue.run(async () => {
      calls++
      return new Uint8Array([2])
    })
    if (change === 'replacement') graph = new SceneGraph()
    else queue.dispose()
    release(new Uint8Array([1]))
    expect(await first).toEqual(new Uint8Array([1]))
    await expect(queued).rejects.toThrow('Document changed before FIG build')
    expect(calls).toBe(0)
  })
}

test('a failed build releases the queue for the next request', async () => {
  const graph = new SceneGraph()
  const queue = createFigBuildQueue(() => graph)
  const failed = queue.run(async () => {
    throw new Error('Encoding failed')
  })
  const next = queue.run(async () => new Uint8Array([3]))
  await expect(failed).rejects.toThrow('Encoding failed')
  expect(await next).toEqual(new Uint8Array([3]))
})
