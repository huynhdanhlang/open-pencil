import 'fake-indexeddb/auto'
import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import * as fonts from '@/app/editor/fonts'
import { createEditorStore } from '@/app/editor/session/create'

for (const payload of [
  { jsx: '<Frame name="Expired" />' },
  { tree: { type: 'frame', props: { name: 'Expired' }, children: [] } }
]) {
  test(`expired ${'jsx' in payload ? 'JSX' : 'tree'} render never prepares or snapshots a page`, async () => {
    const store = createEditorStore(new SceneGraph())
    const prepare = spyOn(store, 'preparePageNodes')
    const snapshot = spyOn(store, 'snapshotPage')
    const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
    try {
      await expect(
        handleTargetCommand(
          {
            store,
            documentId: 'owned',
            documentName: 'Owned',
            pageId: store.state.currentPageId,
            pageName: 'Page'
          },
          'tool',
          { name: 'render', args: payload },
          { id: 'expired', deadlineAt: Date.now() - 1 }
        )
      ).rejects.toThrow('expired before render started')
      expect(prepare).not.toHaveBeenCalled()
      expect(snapshot).not.toHaveBeenCalled()
      expect(store.undo.canUndo).toBe(false)
    } finally {
      prepare.mockRestore()
      snapshot.mockRestore()
      store.dispose()
    }
  })
}

test('queued cancellation releases the render admission, creates no Undo and preserves manual edits', async () => {
  const store = createEditorStore()
  let release!: () => void
  const lane = store.runDocumentOperation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  await Promise.resolve()
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const target = {
    store,
    documentId: 'owned',
    documentName: 'Owned',
    pageId: store.state.currentPageId,
    pageName: 'Page'
  }
  const cancel = new AbortController()
  const snapshot = spyOn(store, 'snapshotPage')
  const args = { name: 'render', args: { jsx: '<Frame name="Queued" />' } }
  const pending = handleTargetCommand(target, 'tool', args, { id: 'queued', signal: cancel.signal })
  try {
    for (let i = 0; i < 5; i++) await Promise.resolve()
    await expect(handleTargetCommand(target, 'tool', args)).rejects.toThrow(
      'A render is still running'
    )
    const manual = store.graph.createNode('RECTANGLE', target.pageId, { name: 'Manual work' })
    cancel.abort(new Error('Request expired'))
    await expect(pending).rejects.toThrow('Request expired')
    expect(snapshot).not.toHaveBeenCalled()
    expect(store.graph.getNode(manual.id)?.name).toBe('Manual work')
    expect(store.undo.canUndo).toBe(false)
  } finally {
    release()
    await lane
    snapshot.mockRestore()
    store.dispose()
  }
})

test('late cancellation preserves the completed render and manual content without accepting a retry', async () => {
  Object.assign(globalThis, { window: { innerWidth: 1024, innerHeight: 768 } })
  const store = createEditorStore()
  let release!: () => void
  let awaitingFonts = false
  const fontWait = spyOn(fonts, 'ensureGraphFonts').mockImplementation(async () => {
    awaitingFonts = true
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const target = {
    store,
    documentId: 'owned',
    documentName: 'Owned',
    pageId: store.state.currentPageId,
    pageName: 'Page'
  }
  const cancel = new AbortController()
  const args = {
    name: 'render',
    args: {
      tree: { type: 'frame', props: { name: 'Completed despite caller timeout' }, children: [] }
    }
  }
  const pending = handleTargetCommand(target, 'tool', args, {
    id: '00000000-0000-4000-8000-000000000003',
    signal: cancel.signal
  })
  try {
    for (let i = 0; i < 100 && !awaitingFonts; i++) await Promise.resolve()
    expect(awaitingFonts).toBe(true)
    cancel.abort(new Error('Caller timeout'))
    const manual = store.graph.createNode('RECTANGLE', target.pageId, {
      name: 'Manual edit during fonts'
    })
    await expect(handleTargetCommand(target, 'tool', args)).rejects.toThrow(
      'A render is still running'
    )
    release()
    const result = await pending
    expect(result).toMatchObject({ ok: true })
    expect(store.graph.getNode(manual.id)?.name).toBe('Manual edit during fonts')
    expect(
      store.graph
        .getChildren(target.pageId)
        .filter((node) => node.name === 'Completed despite caller timeout')
    ).toHaveLength(1)
    const status = await handleTargetCommand(target, 'tool', {
      name: 'get_runtime_status',
      args: {}
    })
    expect(status).toMatchObject({
      result: {
        automationRender: {
          phase: 'completed',
          cancellation: 'before-start-only',
          requestId: '00000000-0000-4000-8000-000000000003'
        }
      }
    })
  } finally {
    if (release) release()
    await pending.catch(() => undefined)
    fontWait.mockRestore()
    store.dispose()
    Reflect.deleteProperty(globalThis, 'window')
  }
})

test('replacement during preparation cannot render into the replacement graph', async () => {
  const store = createEditorStore()
  const original = store.graph
  const replacement = new SceneGraph()
  const pageId = store.state.currentPageId
  // Deliberately reuse the page identity, so a page-ID guard alone cannot protect it.
  replacement.nodes.clear()
  replacement.nodes.set(pageId, structuredClone(original.getNode(pageId)!))
  const prepare = spyOn(store, 'preparePageNodes').mockImplementation(async () => {
    store.replaceGraph(replacement)
    return true
  })
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  try {
    await expect(
      handleTargetCommand(
        { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' },
        'tool',
        { name: 'render', args: { jsx: '<Frame />' } }
      )
    ).rejects.toThrow('Document changed before render started')
    expect(replacement.nodes.size).toBe(1)
    expect(store.undo.canUndo).toBe(false)
  } finally {
    store.replaceGraph(original)
    prepare.mockRestore()
    store.dispose()
  }
})

test('a page closed while render is queued cannot acquire a snapshot or Undo', async () => {
  const store = createEditorStore()
  const page = store.graph.addPage('Owned target')
  let release!: () => void
  const lane = store.runDocumentOperation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  await Promise.resolve()
  const snapshot = spyOn(store, 'snapshotPage')
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const pending = handleTargetCommand(
    { store, documentId: 'owned', documentName: 'Owned', pageId: page.id, pageName: page.name },
    'tool',
    { name: 'render', args: { jsx: '<Frame />' } }
  )
  try {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    store.graph.deleteNode(page.id)
    release()
    await lane
    await expect(pending).rejects.toThrow('Page closed before render started')
    expect(snapshot).not.toHaveBeenCalled()
    expect(store.undo.canUndo).toBe(false)
  } finally {
    release()
    await lane
    snapshot.mockRestore()
    store.dispose()
  }
})

test('runtime status does not load the target page to inspect an admitted request', async () => {
  const store = createEditorStore()
  const prepare = spyOn(store, 'preparePageNodes').mockRejectedValue(new Error('Must not import'))
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  Object.assign(globalThis, { window: { innerWidth: 1024, innerHeight: 768 } })
  try {
    const result = await handleTargetCommand(
      {
        store,
        documentId: 'owned',
        documentName: 'Owned',
        pageId: store.state.currentPageId,
        pageName: 'Page'
      },
      'tool',
      { name: 'get_runtime_status', args: {} }
    )
    expect(result).toMatchObject({ ok: true })
    expect(prepare).not.toHaveBeenCalled()
  } finally {
    prepare.mockRestore()
    store.dispose()
    Reflect.deleteProperty(globalThis, 'window')
  }
})
