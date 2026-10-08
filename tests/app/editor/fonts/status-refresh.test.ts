import { expect, test } from 'bun:test'

import { createFontStatusRefresh } from '@/app/editor/fonts/status-refresh'

test('font status keeps mutations immediate except during admitted construction, and flushes final state', () => {
  const originalRequest = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 0
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++nextId, callback)
    return nextId
  }
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id)
  }
  let deferring = false
  let refreshes = 0
  const status = createFontStatusRefresh(
    () => refreshes++,
    () => deferring
  )
  const tick = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(0)
  }
  try {
    status.mutated()
    expect(refreshes).toBe(1)
    deferring = true
    for (let i = 0; i < 263; i++) {
      status.mutated()
      tick()
    }
    expect(refreshes).toBe(1)
    expect(frames.size).toBe(1)
    deferring = false
    tick()
    expect(refreshes).toBe(2)
    expect(frames.size).toBe(0)
    deferring = true
    status.mutated()
    status.immediate()
    expect(refreshes).toBe(3)
    expect(frames.size).toBe(0)
    status.mutated()
    const stale = [...frames.values()][0]
    status.dispose()
    stale(0)
    status.mutated()
    status.immediate()
    expect(refreshes).toBe(3)
    expect(frames.size).toBe(0)
  } finally {
    status.dispose()
    globalThis.requestAnimationFrame = originalRequest
    globalThis.cancelAnimationFrame = originalCancel
  }
})
