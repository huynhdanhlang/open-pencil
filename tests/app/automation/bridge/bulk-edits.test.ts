import 'fake-indexeddb/auto'
import { expect, spyOn, test } from 'bun:test'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import * as fonts from '@/app/editor/fonts'
import { createEditorStore } from '@/app/editor/session/create'
import { createDeferred } from '@/app/runtime/deferred'

test('bulk dry run and rejected plans never lay out or capture history', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const frame = store.graph.createNode('FRAME', pageId, {
    width: 1,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'AUTO'
  })
  store.graph.createNode('RECTANGLE', frame.id, { width: 100 })
  const before = store.snapshotPage()
  const snapshot = spyOn(store, 'snapshotPage')
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const target = { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' }
  try {
    await handleTargetCommand(target, 'tool', {
      name: 'diff_apply',
      args: {
        dryRun: true,
        operations: [{ kind: 'update', id: frame.id, attributes: 'rounded={12}' }]
      }
    })
    await handleTargetCommand(target, 'tool', {
      name: 'diff_apply',
      args: { operations: [{ kind: 'update', id: frame.id, attributes: 'unknown={12}' }] }
    })
    expect(snapshot).not.toHaveBeenCalled()
    expect(store.graph.getNode(frame.id)?.width).toBe(1)
    expect(store.undo.canUndo).toBe(false)
    snapshot.mockRestore()
    expect(store.snapshotPage()).toEqual(before)
  } finally {
    snapshot.mockRestore()
    store.dispose()
  }
})

test('artwork preparation preserves UI edits and captures no history during I/O', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const frame = store.graph.createNode('FRAME', pageId)
  const waiting = createDeferred<void>()
  const release = createDeferred<void>()
  const figma = makeFigmaFromStore(store, pageId)
  figma.icons = {
    ...figma.icons,
    icons: async () => {
      waiting.resolve()
      await release.promise
      return new Map()
    }
  }
  const snapshot = spyOn(store, 'snapshotPage')
  const { handleTargetCommand } = createAutomationCommandHandlers(() => figma)
  try {
    const request = handleTargetCommand(
      { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' },
      'tool',
      {
        name: 'diff_apply',
        args: {
          operations: [
            { kind: 'add', parentId: frame.id, index: 0, jsx: '<Icon name="owned:missing" />' }
          ]
        }
      }
    )
    await waiting.promise
    const manual = store.graph.createNode('RECTANGLE', frame.id, { name: 'User edit' })
    expect(snapshot).not.toHaveBeenCalled()
    release.resolve()
    const response = await request
    expect(response).toMatchObject({ result: { error: expect.any(String) } })
    expect(store.graph.getNode(manual.id)?.name).toBe('User edit')
    expect(snapshot).not.toHaveBeenCalled()
  } finally {
    release.resolve()
    snapshot.mockRestore()
    store.dispose()
  }
})

test('component propagation and explicit edits across pages replay as one group', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const related = store.graph.addPage('Related').id
  const master = store.graph.createNode('COMPONENT', pageId, { name: 'Master' })
  const child = store.graph.createNode('RECTANGLE', master.id, { width: 10 })
  const instance = store.graph.createInstance(master.id, related)!
  const copyId = instance.childIds[0]
  const other = store.graph.createNode('FRAME', related, { name: 'Other' })
  const before = store.snapshotPage(pageId, undefined, [related])
  const snapshot = spyOn(store, 'snapshotPage')
  const prepareFonts = spyOn(fonts, 'ensureGraphFonts').mockResolvedValue(false)
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  try {
    expect(
      await handleTargetCommand(
        { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' },
        'tool',
        {
          name: 'diff_apply',
          args: {
            page_ids: [pageId, related],
            operations: [
              { kind: 'update', id: child.id, attributes: 'w={24}' },
              { kind: 'update', id: other.id, attributes: 'rounded={12}' },
              { kind: 'add', parentId: other.id, index: 0, jsx: '<Text>Related 🎬</Text>' }
            ]
          }
        }
      )
    ).toMatchObject({ result: { applied: 3, failed: 0 } })
    expect(snapshot).toHaveBeenCalledTimes(2)
    snapshot.mockRestore()
    expect(store.graph.getNode(copyId)?.width).toBe(24)
    const after = store.snapshotPage(pageId, undefined, [related])
    store.undo.undo()
    expect(store.snapshotPage(pageId, undefined, [related])).toEqual(before)
    expect(store.undo.canUndo).toBe(false)
    store.undo.redo()
    expect(store.snapshotPage(pageId, undefined, [related])).toEqual(after)
  } finally {
    snapshot.mockRestore()
    prepareFonts.mockRestore()
    store.dispose()
  }
})
