import { afterEach, expect, spyOn, test } from 'bun:test'

import { createDocumentViewportActions, yieldToUI } from '@/app/document/io/browser'

const originalFrame = globalThis.requestAnimationFrame
const originalCancel = globalThis.cancelAnimationFrame
const originalTimeout = globalThis.setTimeout
const callbacks = new Map<number, FrameRequestCallback>()

function suspendFrames() {
  let nextId = 0
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.set(++nextId, callback)
    return nextId
  }
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id)
}

afterEach(() => {
  // Finish old-code pending promises too, so a failing regression leaves no work behind.
  for (const callback of callbacks.values()) callback(0)
  callbacks.clear()
  globalThis.requestAnimationFrame = originalFrame
  globalThis.cancelAnimationFrame = originalCancel
})

test('document loading can yield while display frames are suspended', async () => {
  suspendFrames()
  const completed = await Promise.race([
    yieldToUI().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250))
  ])
  expect(completed).toBe(true)
  expect(callbacks.size).toBe(0)
})

test('viewport fit completes while display frames are suspended', async () => {
  suspendFrames()
  let fits = 0
  const actions = createDocumentViewportActions(
    { zoomToFit: () => fits++ },
    { width: 1600, height: 1000 }
  )
  const completed = await Promise.race([
    actions.fitCurrentPageToViewport().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250))
  ])
  expect(completed).toBe(true)
  expect(fits).toBe(1)
})

test('loading yields even when the hidden WebView suspends both frames and timers', async () => {
  suspendFrames()
  const blocked = originalTimeout(() => undefined, 60_000)
  const timers = spyOn(globalThis, 'setTimeout').mockReturnValue(blocked)
  try {
    const completed = await Promise.race([
      yieldToUI().then(() => true),
      new Promise<boolean>((resolve) => originalTimeout(() => resolve(false), 250))
    ])
    expect(completed).toBe(true)
    expect(callbacks.size).toBe(0)
  } finally {
    timers.mockRestore()
    clearTimeout(blocked)
  }
})

test('a normal display frame resumes loading immediately', async () => {
  suspendFrames()
  let completed = false
  const work = yieldToUI().then(() => {
    completed = true
  })
  expect(completed).toBe(false)
  const callback = callbacks.values().next().value
  if (!callback) throw new Error('No requested display frame')
  callback(0)
  await work
  expect(completed).toBe(true)
})
