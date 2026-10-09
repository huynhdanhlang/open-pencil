import 'fake-indexeddb/auto'
import { expect, spyOn, test } from 'bun:test'

import { BUILTIN_IO_FORMATS, IORegistry, parseFigFile } from '@open-pencil/core/io'
import { SceneGraph, collectSceneMutation } from '@open-pencil/scene-graph'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import {
  admitRender,
  startRender,
  markRenderStep,
  shouldDeferRenderPaint,
  measureRenderWork,
  readRenderStatus
} from '@/app/automation/bridge/render-admission'
import { structuralFontRoots } from '@/app/automation/execution/editor'

test('component conversion and instance creation prepare only their actual font forests', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const frame = store.graph.createNode('FRAME', pageId, { name: 'Master' })
  store.graph.createNode('TEXT', frame.id, { text: 'Master text' })
  const unrelated = store.graph.createNode('TEXT', pageId, { text: 'Unrelated' })
  const prepareFonts = spyOn(fonts, 'ensureGraphFonts').mockResolvedValue(false)
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const target = { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' }
  try {
    const converted = (await handleTargetCommand(target, 'tool', {
      name: 'create_component',
      args: { id: frame.id }
    })) as { result: { id: string } }
    const componentId = converted.result.id
    expect(prepareFonts.mock.calls.at(-1)?.[1]).toEqual([componentId])
    const response = (await handleTargetCommand(target, 'tool', {
      name: 'create_instance',
      args: { component_id: componentId }
    })) as { result: { id: string } }
    expect(prepareFonts.mock.calls.at(-1)?.[1]).toEqual([response.result.id])
    expect(prepareFonts.mock.calls.at(-1)?.[1]).not.toContain(unrelated.id)
    expect(store.graph.getNode(response.result.id)?.componentId).toBe(componentId)
    store.undo.undo()
    expect(store.graph.getNode(response.result.id)).toBeUndefined()
    store.undo.redo()
    expect(store.graph.getNode(response.result.id)?.componentId).toBe(componentId)
  } finally {
    prepareFonts.mockRestore()
    store.dispose()
  }
})
import * as fonts from '@/app/editor/fonts'
import { createEditorStore } from '@/app/editor/session/create'
import { createDeferred } from '@/app/runtime/deferred'

test('font roots cover nested additions once and retain disjoint forests', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]!.id
  const { result, impact } = await collectSceneMutation(graph, () => {
    const outer = graph.createNode('FRAME', page)
    const inner = graph.createNode('FRAME', outer.id)
    graph.createNode('TEXT', inner.id, { text: 'Nested' })
    const separate = graph.createNode('TEXT', page, { text: 'Separate root' })
    return { outer, separate }
  })
  expect(structuralFontRoots(graph, 'diff_apply', impact)).toEqual([
    result.outer.id,
    result.separate.id
  ])
})

test('reparent font preparation keeps the moved subtree and preserves Undo', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const unrelated = store.graph.createNode('TEXT', pageId, { text: 'Unrelated' })
  const prepareFonts = spyOn(fonts, 'ensureGraphFonts').mockResolvedValue(false)
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const target = { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' }
  try {
    const response = (await handleTargetCommand(target, 'tool', {
      name: 'render',
      args: { jsx: '<Frame name="Container" />' }
    })) as { result: { id: string } }
    const container = response.result.id
    await handleTargetCommand(target, 'tool', {
      name: 'reparent_node',
      args: { id: unrelated.id, parent_id: container }
    })
    const roots = prepareFonts.mock.calls.at(-1)?.[1]
    expect(roots).toContain(unrelated.id)
    expect(roots).not.toContain(pageId)
    expect(store.graph.getNode(unrelated.id)?.parentId).toBe(container)
    store.undo.undo()
    expect(store.graph.getNode(unrelated.id)?.parentId).toBe(pageId)
    store.undo.redo()
    expect(store.graph.getNode(unrelated.id)?.parentId).toBe(container)
  } finally {
    prepareFonts.mockRestore()
    store.dispose()
  }
})

test('diff fonts include every root added by one fragment hunk', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const parent = store.graph.createNode('FRAME', pageId, { name: 'Parent' })
  const unrelated = store.graph.createNode('TEXT', pageId, { text: 'Unrelated' })
  const prepareFonts = spyOn(fonts, 'ensureGraphFonts').mockResolvedValue(false)
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  try {
    await handleTargetCommand(
      { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' },
      'tool',
      {
        name: 'diff_apply',
        args: {
          patch: `@@ /Parent/Added added to #${parent.id} at 0\n+<><Text name="First">A</Text><Text name="Second">B</Text></>`
        }
      }
    )
    const children = store.graph.getChildren(parent.id)
    expect(children.map((node) => node.name)).toEqual(['First', 'Second'])
    const roots = prepareFonts.mock.calls.at(-1)?.[1]
    for (const child of children) expect(roots).toContain(child.id)
    expect(roots).not.toContain(unrelated.id)
    store.undo.undo()
    expect(store.graph.getChildren(parent.id)).toHaveLength(0)
    store.undo.redo()
    expect(store.graph.getChildren(parent.id).map((node) => node.name)).toEqual(['First', 'Second'])
  } finally {
    prepareFonts.mockRestore()
    store.dispose()
  }
})

test('a started structural edit finishes and remains reversible after caller cancellation', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const frame = store.graph.createNode('FRAME', pageId, { name: 'Before' })
  const waiting = createDeferred<void>()
  const release = createDeferred<void>()
  const prepareFonts = spyOn(fonts, 'ensureGraphFonts').mockImplementation(async () => {
    waiting.resolve()
    await release.promise
    return false
  })
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const cancel = new AbortController()
  const pending = handleTargetCommand(
    { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' },
    'tool',
    {
      name: 'diff_apply',
      args: { patch: `@@ /Before #${frame.id}\n-name="Before"\n+name="After"` }
    },
    { id: 'started-structural', signal: cancel.signal }
  )
  try {
    await waiting.promise
    cancel.abort(new Error('Caller timed out'))
    release.resolve()
    await pending
    expect(store.graph.getNode(frame.id)?.name).toBe('After')
    store.undo.undo()
    expect(store.graph.getNode(frame.id)?.name).toBe('Before')
    store.undo.redo()
    expect(store.graph.getNode(frame.id)?.name).toBe('After')
  } finally {
    release.resolve()
    prepareFonts.mockRestore()
    store.dispose()
  }
})

test('expired queued structural edits do not run later or retain an Undo snapshot', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const frame = store.graph.createNode('FRAME', pageId, { name: 'Before' })
  let release!: () => void
  const lane = store.runDocumentOperation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  await Promise.resolve()
  const cancel = new AbortController()
  const snapshot = spyOn(store, 'snapshotPage')
  const prepareFonts = spyOn(fonts, 'ensureGraphFonts').mockResolvedValue(false)
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const pending = handleTargetCommand(
    { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' },
    'tool',
    {
      name: 'diff_apply',
      args: { patch: `@@ /Before #${frame.id}\n-name="Before"\n+name="After"` }
    },
    { id: 'expired-structural', signal: cancel.signal }
  )
  // Observe rejection immediately, before releasing the queued document owner.
  const outcome = pending.then(
    () => 'applied',
    (error: Error) => error.message
  )
  try {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    const manual = store.graph.createNode('RECTANGLE', pageId, { name: 'Manual work' })
    cancel.abort(new Error('Request expired'))
    release()
    await lane
    expect(await outcome).toBe('Request expired')
    expect(store.graph.getNode(frame.id)?.name).toBe('Before')
    expect(store.graph.getNode(manual.id)?.name).toBe('Manual work')
    expect(snapshot).not.toHaveBeenCalled()
    expect(store.undo.canUndo).toBe(false)
  } finally {
    release()
    await lane
    snapshot.mockRestore()
    prepareFonts.mockRestore()
    store.dispose()
  }
})

test('diff apply prepares fonts from actual changed nodes, excluding the unrelated page', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const frame = store.graph.createNode('FRAME', pageId, { name: 'Before' })
  store.graph.createNode('TEXT', frame.id, { text: 'Changed subtree' })
  const unrelated = store.graph.createNode('TEXT', pageId, { text: 'Unrelated' })
  const prepareFonts = spyOn(fonts, 'ensureGraphFonts').mockResolvedValue(false)
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const target = { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' }
  try {
    await handleTargetCommand(target, 'tool', {
      name: 'diff_apply',
      args: { patch: `@@ /Before #${frame.id}\n-name="Before"\n+name="After"` }
    })
    expect(prepareFonts.mock.calls.at(-1)?.[1]).toEqual([frame.id])
    expect(prepareFonts.mock.calls.at(-1)?.[1]).not.toContain(unrelated.id)
    expect(store.graph.getNode(frame.id)?.name).toBe('After')
    store.undo.undo()
    expect(store.graph.getNode(frame.id)?.name).toBe('Before')
    store.undo.redo()
    expect(store.graph.getNode(frame.id)?.name).toBe('After')
  } finally {
    prepareFonts.mockRestore()
    store.dispose()
  }
})

test('batch update prepares fonts only in changed roots and preserves one reversible edit', async () => {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const frame = store.graph.createNode('FRAME', pageId, { name: 'Before' })
  store.graph.createNode('TEXT', frame.id)
  const unrelated = store.graph.createNode('TEXT', pageId)
  const fontWait = spyOn(fonts, 'ensureGraphFonts').mockResolvedValue(false)
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const target = { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' }
  try {
    await handleTargetCommand(target, 'tool', {
      name: 'batch_update',
      args: { operations: JSON.stringify([{ id: frame.id, props: { name: 'After', padding: 8 } }]) }
    })
    expect(fontWait.mock.calls.at(-1)?.[1]).toEqual([frame.id])
    expect(fontWait.mock.calls.at(-1)?.[1]).not.toContain(unrelated.id)
    await handleTargetCommand(target, 'undo', {})
    expect(store.graph.getNode(frame.id)?.name).toBe('Before')
    await handleTargetCommand(target, 'redo', {})
    expect(store.graph.getNode(frame.id)?.name).toBe('After')
  } finally {
    fontWait.mockRestore()
    store.dispose()
  }
})

test('render work measurements preserve results/errors and retain only admitted numeric timings', async () => {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  expect(measureRenderWork(graph, 'font-status', () => 42)).toBe(42)
  expect(readRenderStatus(graph)).toBeNull()
  await admitRender(graph, undefined, async () => {
    startRender(graph, undefined, pageId)
    markRenderStep(graph, 'construction')
    expect(measureRenderWork(graph, 'font-status', () => 42)).toBe(42)
    expect(() =>
      measureRenderWork(graph, 'design-check', () => {
        throw new Error('original')
      })
    ).toThrow('original')
  })
  const status = readRenderStatus(graph)
  expect(status?.workMs.construction?.['font-status']?.count).toBe(1)
  expect(status?.workMs.construction?.['design-check']?.count).toBe(1)
  measureRenderWork(graph, 'font-status', () => 99)
  expect(readRenderStatus(graph)?.workMs.construction?.['font-status']?.count).toBe(1)
  if (status?.workMs.construction?.['font-status'])
    status.workMs.construction['font-status'].count = 99
  expect(readRenderStatus(graph)?.workMs.construction?.['font-status']?.count).toBe(1)
})

test('moving a render parent during destination preparation aborts before snapshots', async () => {
  const store = createEditorStore()
  const shown = store.state.currentPageId
  const original = store.graph.addPage('Original destination')
  const moved = store.graph.addPage('Moved destination')
  const parent = store.graph.createNode('FRAME', original.id)
  const ready = createDeferred<boolean>()
  const entered = createDeferred<void>()
  const prepare = spyOn(store, 'preparePageNodes').mockImplementation((id) => {
    if (id === shown) return Promise.resolve(true)
    entered.resolve()
    return ready.promise
  })
  const snapshot = spyOn(store, 'snapshotPage')
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const pending = handleTargetCommand(
    { store, documentId: 'owned', documentName: 'Owned', pageId: shown, pageName: 'Page' },
    'tool',
    {
      name: 'render',
      args: { jsx: '<Frame />', parent_id: parent.id }
    }
  )
  try {
    await entered.promise
    store.graph.reparentNode(parent.id, moved.id)
    ready.resolve(true)
    await expect(pending).rejects.toThrow('placement changed pages')
    expect(snapshot).not.toHaveBeenCalled()
    expect(store.graph.getNode(parent.id)?.parentId).toBe(moved.id)
    expect(store.graph.getChildren(parent.id)).toHaveLength(0)
  } finally {
    ready.resolve(false)
    prepare.mockRestore()
    snapshot.mockRestore()
    store.dispose()
  }
})

test('partial construction defers paints only in its admitted page and always releases on failure', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  expect(shouldDeferRenderPaint(graph, page, 'scene')).toBe(false)
  await expect(
    admitRender(graph, undefined, async () => {
      startRender(graph, undefined, page)
      markRenderStep(graph, 'construction')
      expect(shouldDeferRenderPaint(graph, page, 'scene')).toBe(true)
      expect(shouldDeferRenderPaint(graph, 'other-page', 'scene')).toBe(false)
      markRenderStep(graph, 'fonts')
      expect(shouldDeferRenderPaint(graph, page, 'overlays')).toBe(false)
      markRenderStep(graph, 'construction')
      throw new Error('Owned construction failed')
    })
  ).rejects.toThrow('Owned construction failed')
  expect(shouldDeferRenderPaint(graph, page, 'scene')).toBe(false)
})

for (const payload of [
  { jsx: '<Frame name="Cross-page render" />' },
  { tree: { type: 'frame', props: { name: 'Cross-page render' }, children: [] } }
]) {
  test('parent placement owns the paint gate and reversible page for raw/tree renders', async () => {
    Object.assign(globalThis, { window: { innerWidth: 1024, innerHeight: 768 } })
    const source = new SceneGraph()
    const sourcePage = source.addPage('Destination')
    source.createNode('RECTANGLE', sourcePage.id, { name: 'Retained before render' })
    const written = await new IORegistry(BUILTIN_IO_FORMATS).writeDocument('fig', source)
    const bytes = written.data as Uint8Array
    const lazy = await parseFigFile(bytes.slice().buffer, { populate: 'first-page' })
    const store = createEditorStore(lazy)
    const shown = store.state.currentPageId
    const destination = store.graph.getPages().find((page) => page.name === 'Destination')
    if (!destination) throw new Error('Missing destination fixture')
    expect(store.graph.getChildren(destination.id)).toHaveLength(0)
    const fontWait = spyOn(fonts, 'ensureGraphFonts').mockResolvedValue(false)
    const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
    const target = {
      store,
      documentId: 'owned',
      documentName: 'Owned',
      pageId: shown,
      pageName: 'Page'
    }
    try {
      const response = (await handleTargetCommand(target, 'tool', {
        name: 'render',
        args: { ...payload, parent_id: destination.id }
      })) as { result: { id: string } }
      expect(store.graph.getNode(response.result.id)?.parentId).toBe(destination.id)
      expect(
        store.graph
          .getChildren(destination.id)
          .some((node) => node.name === 'Retained before render')
      ).toBe(true)
      const status = (await handleTargetCommand(target, 'tool', {
        name: 'get_runtime_status',
        args: {}
      })) as {
        result: { automationRender: { pageId: string } }
      }
      expect(status.result.automationRender.pageId).toBe(destination.id)
      await handleTargetCommand(target, 'undo', {})
      expect(store.graph.getNode(response.result.id)).toBeUndefined()
      expect(store.graph.getNode(destination.id)).toBeDefined()
      expect(store.graph.getChildren(destination.id).map((node) => node.name)).toEqual([
        'Retained before render'
      ])
    } finally {
      fontWait.mockRestore()
      store.dispose()
      Reflect.deleteProperty(globalThis, 'window')
    }
  })
}

test('raw JSX prepares fonts only in its returned roots and retains one reversible edit', async () => {
  Object.assign(globalThis, { window: { innerWidth: 1024, innerHeight: 768 } })
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const existing = store.graph.createNode('TEXT', pageId, { name: 'Unrelated existing text' })
  const fontWait = spyOn(fonts, 'ensureGraphFonts').mockResolvedValue(false)
  const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
  const target = { store, documentId: 'owned', documentName: 'Owned', pageId, pageName: 'Page' }
  try {
    const response = (await handleTargetCommand(target, 'tool', {
      name: 'render',
      args: { jsx: '<Frame name="New root"><Text>Hello</Text></Frame>' }
    })) as { result: { id: string } }
    expect(fontWait.mock.calls.at(-1)?.[1]).toEqual([response.result.id])
    expect(fontWait.mock.calls.at(-1)?.[1]).not.toContain(existing.id)
    expect(store.undo.canUndo).toBe(true)
    await handleTargetCommand(target, 'undo', {})
    expect(store.graph.getNode(response.result.id)).toBeUndefined()
    expect(store.graph.getNode(existing.id)?.name).toBe('Unrelated existing text')
    await handleTargetCommand(target, 'redo', {})
    expect(store.graph.getNode(response.result.id)?.name).toBe('New root')
    const status = (await handleTargetCommand(target, 'tool', {
      name: 'get_runtime_status',
      args: {}
    })) as {
      result: {
        automationRender: { phase: string; step: string | null; stepMs: Record<string, number> }
      }
    }
    expect(status.result.automationRender.phase).toBe('completed')
    expect(status.result.automationRender.step).toBeNull()
    expect(Object.keys(status.result.automationRender.stepMs).sort()).toEqual(
      [
        'snapshot-before',
        'construction',
        'fonts',
        'layout-sync',
        'snapshot-after',
        'undo-commit'
      ].sort()
    )
    expect(Object.values(status.result.automationRender.stepMs).every((ms) => ms >= 0)).toBe(true)
  } finally {
    fontWait.mockRestore()
    store.dispose()
  }
})

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
