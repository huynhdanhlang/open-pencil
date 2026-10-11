import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test } from 'bun:test'

import { clearTurns, recordTurn, restoreTurn, revertTurn, turnEdits } from '@/app/ai/chat/turns'
import { createEditorStore } from '@/app/editor/session/create'

let store: ReturnType<typeof createEditorStore>
beforeEach(() => {
  store = createEditorStore()
})
afterEach(() => {
  clearTurns()
  store.dispose()
})

test('disposing a document releases its turn records and rejects late replies without touching another document', () => {
  const other = createEditorStore()
  const entry = { label: 'AI: probe', forward: () => undefined, inverse: () => undefined }
  store.pushUndoEntry(entry)
  other.pushUndoEntry(entry)
  recordTurn('closed-store', store, [
    { tool: 'probe', toolCallId: 'closed', entry: new WeakRef(entry), undone: false }
  ])
  recordTurn('other-store', other, [
    { tool: 'probe', toolCallId: 'other', entry: new WeakRef(entry), undone: false }
  ])
  try {
    store.dispose()
    expect(turnEdits('closed-store')).toBeNull()
    recordTurn('late-closed-store', store, [
      { tool: 'probe', toolCallId: 'late', entry: new WeakRef(entry), undone: false }
    ])
    expect(turnEdits('late-closed-store')).toBeNull()
    expect(revertTurn('other-store')).toBe(true)
    expect(restoreTurn('other-store')).toBe(true)
  } finally {
    other.dispose()
  }
})

test('turn records do not retain entries forgotten by the history owner', async () => {
  const weak = (() => {
    const entry = { label: 'AI: collectible', forward: () => undefined, inverse: () => undefined }
    store.pushUndoEntry(entry)
    recordTurn('collectible', store, [
      { tool: 'collectible', toolCallId: 'collectible', entry: new WeakRef(entry), undone: false }
    ])
    return new WeakRef(entry)
  })()
  store.undo.clear()
  await Bun.sleep(0)
  Bun.gc(true)
  await Bun.sleep(0)
  expect(weak.deref()).toBeUndefined()
  expect(turnEdits('collectible')).toEqual({
    count: 1,
    undone: 0,
    revertable: false,
    restorable: false
  })
  expect(revertTurn('collectible')).toBe(false)
})
