import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import { createApp, effectScope, watchEffect } from 'vue'

import { fontResolver } from '@open-pencil/core/text'
import { EDITOR_KEY } from '@open-pencil/vue'

import {
  admitRender,
  startRender,
  markRenderStep,
  readRenderStatus
} from '@/app/automation/bridge/render-admission'
import {
  getActiveEditorStoreOrNull,
  setActiveEditorStore,
  useActiveEditorStoreRef
} from '@/app/editor/active-store'
import { useDocumentFontStatus } from '@/app/editor/fonts/status'
import { createFontStatusRefresh } from '@/app/editor/fonts/status-refresh'
import { createEditorStore } from '@/app/editor/session/create'

test('actual font resolution events coalesce status scans during admitted construction', async () => {
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
  const previous = getActiveEditorStoreOrNull()
  const store = createEditorStore()
  const scope = effectScope()
  let scans = 0
  try {
    setActiveEditorStore(store)
    const app = createApp({})
    app.provide(EDITOR_KEY, store)
    app.runWithContext(() =>
      scope.run(() => {
        const { status } = useDocumentFontStatus()
        watchEffect(
          () => {
            void status.value
            scans++
          },
          { flush: 'sync' }
        )
      })
    )
    const baseline = scans
    await admitRender(store.graph, undefined, async () => {
      startRender(store.graph, undefined, store.state.currentPageId)
      markRenderStep(store.graph, 'construction')
      for (let index = 0; index < 56; index++) fontResolver.reset('owned-status-refresh-fixture')
      expect(scans).toBe(baseline)
      expect(frames.size).toBe(1)
      markRenderStep(store.graph, 'fonts')
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(0)
      expect(scans).toBe(baseline + 1)
      expect(readRenderStatus(store.graph)?.workMs.construction?.['font-status']).toBeUndefined()
      expect(readRenderStatus(store.graph)?.workMs.fonts?.['font-status']?.count).toBe(1)
    })
  } finally {
    scope.stop()
    store.dispose()
    if (previous) setActiveEditorStore(previous)
    else useActiveEditorStoreRef().value = undefined
    globalThis.requestAnimationFrame = originalRequest
    globalThis.cancelAnimationFrame = originalCancel
  }
})

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
