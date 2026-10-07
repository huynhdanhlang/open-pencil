import 'fake-indexeddb/auto'
import { expect, test, vi } from 'bun:test'

import * as chatModule from '@/app/ai/chat/use'
import { closeTab, createTab, getTabById } from '@/app/tabs'

test('tab close awaits chat teardown before recovery persistence and disposal', async () => {
  const tab = createTab()
  const ready = Promise.withResolvers<undefined>()
  const started = Promise.withResolvers<undefined>()
  const originalRelease = chatModule.releaseAIChatEditor
  const release = vi.spyOn(chatModule, 'releaseAIChatEditor').mockImplementation(async (editor) => {
    started.resolve(undefined)
    await ready.promise
    await originalRelease(editor)
  })
  const persist = vi.spyOn(tab.store, 'persistRecoveryNow').mockResolvedValue(undefined)
  const dispose = vi.spyOn(tab.store, 'dispose')
  try {
    const closing = closeTab(tab.id, 'save')
    await started.promise
    expect(getTabById(tab.id)?.store).toBe(tab.store)
    expect(persist).not.toHaveBeenCalled()
    expect(dispose).not.toHaveBeenCalled()
    ready.resolve(undefined)
    await closing
    expect(persist).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(getTabById(tab.id)).toBeUndefined()
  } finally {
    ready.resolve(undefined)
    release.mockRestore()
    persist.mockRestore()
    dispose.mockRestore()
    if (getTabById(tab.id)) await closeTab(tab.id, 'discard')
  }
})

test('a recovery failure after chat release leaves the tab open and permits history reattachment', async () => {
  const tab = createTab()
  const history = chatModule.useAIChat().history
  await history.initialize()
  const documentId = history.current.value?.documentId
  const persist = vi
    .spyOn(tab.store, 'persistRecoveryNow')
    .mockRejectedValue(new Error('Recovery unavailable'))
  const dispose = vi.spyOn(tab.store, 'dispose')
  try {
    await expect(closeTab(tab.id, 'save')).rejects.toThrow('Recovery unavailable')
    expect(getTabById(tab.id)?.store).toBe(tab.store)
    expect(dispose).not.toHaveBeenCalled()
    await history.initialize()
    expect(history.current.value?.documentId).toBe(documentId)
  } finally {
    persist.mockRestore()
    dispose.mockRestore()
    await closeTab(tab.id, 'discard')
  }
})
