import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io'
import { populateFigPage } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/core/kiwi'
import { applyFigPopulationDelta } from '@open-pencil/core/kiwi/fig/population/delta'
import { recoverReaderPage } from '@open-pencil/core/kiwi/fig/session/document-state'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createDocumentChanges } from '@/app/document/io/changes'
import { createDocumentRecovery } from '@/app/document/recovery/controller'
import { createMemoryRecoveryStore } from '@/app/document/recovery/memory'

test('repainting and selection do not dirty a document; content mutations do', () => {
  const editor = createEditor()
  const changes = createDocumentChanges(editor)
  try {
    editor.requestRender()
    editor.requestRepaint()
    editor.clearSelection()
    expect(changes.hasUnsavedChanges()).toBe(false)
    editor.createShape('RECTANGLE', 0, 0, 100, 100)
    expect(changes.hasUnsavedChanges()).toBe(true)
    changes.markSaved()
    expect(changes.hasUnsavedChanges()).toBe(false)
    editor.undo.record({
      label: 'Variable edit',
      forward: () => undefined,
      inverse: () => undefined
    })
    expect(changes.hasUnsavedChanges()).toBe(true)
  } finally {
    changes.dispose()
    editor.dispose()
  }
})

test('saving an earlier revision cannot clear edits made while exporting or picking a file', () => {
  const editor = createEditor()
  const changes = createDocumentChanges(editor)
  try {
    editor.createShape('RECTANGLE', 0, 0, 100, 100)
    const saving = changes.capture()
    editor.createShape('ELLIPSE', 0, 0, 100, 100)
    changes.markSaved(saving)
    expect(changes.hasUnsavedChanges()).toBe(true)
    changes.markSaved()
    expect(changes.hasUnsavedChanges()).toBe(false)
    changes.markChanged()
    expect(changes.hasUnsavedChanges()).toBe(true)
  } finally {
    changes.dispose()
    editor.dispose()
  }
})

test('laying out a page does not dirty a document; an edit that relays it out does', () => {
  const editor = createEditor()
  const changes = createDocumentChanges(editor)
  try {
    const page = editor.state.currentPageId
    const row = editor.graph.createNode('FRAME', page, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      itemSpacing: 8,
      width: 10,
      height: 10
    })
    editor.graph.createNode('RECTANGLE', row.id, { width: 40, height: 20 })
    editor.graph.createNode('RECTANGLE', row.id, { width: 40, height: 20 })
    changes.markSaved()

    computeAllLayouts(editor.graph, page)
    expect(editor.graph.getNode(row.id)?.width).toBe(88)
    expect(changes.hasUnsavedChanges()).toBe(false)

    editor.graph.updateNode(row.id, { itemSpacing: 16 })
    computeAllLayouts(editor.graph, page)
    expect(changes.hasUnsavedChanges()).toBe(true)
  } finally {
    changes.dispose()
    editor.dispose()
  }
})

test('materializing imported nodes preserves the content revision and existing dirty edits', () => {
  const editor = createEditor()
  const changes = createDocumentChanges(editor)
  try {
    const page = editor.state.currentPageId
    const original = editor.graph.createNode('RECTANGLE', page, { width: 20 })
    changes.markSaved()
    const saved = changes.capture()
    const imported = { ...original, id: 'imported-child', width: 40 }
    applyFigPopulationDelta(editor.graph, {
      created: [[imported.id, imported]],
      updated: [[original.id, { width: 30 }]],
      deleted: [],
      instanceIndex: [],
      populatedRootIds: [page]
    })
    expect(editor.graph.getNode(imported.id)?.width).toBe(40)
    expect(editor.graph.getNode(original.id)?.width).toBe(30)
    expect(changes.capture()).toBe(saved)
    expect(changes.hasUnsavedChanges()).toBe(false)

    editor.graph.updateNode(original.id, { width: 50 })
    const dirty = changes.capture()
    applyFigPopulationDelta(editor.graph, {
      created: [],
      updated: [],
      deleted: [imported.id],
      instanceIndex: [],
      populatedRootIds: [page]
    })
    expect(changes.capture()).toBe(dirty)
    expect(changes.hasUnsavedChanges()).toBe(true)
  } finally {
    changes.dispose()
    editor.dispose()
  }
})

test('imported population does not build recovery archives; real edits are protected', async () => {
  const editor = createEditor()
  const changes = createDocumentChanges(editor)
  let builds = 0
  const store = createMemoryRecoveryStore()
  const recovery = createDocumentRecovery({
    state: { ...editor.state, documentName: 'Owned population regression' },
    version: changes.capture,
    store,
    recoveryId: 'imported-population',
    buildFigFile: () => {
      builds++
      return new Uint8Array([builds])
    }
  })
  try {
    editor.graph.applyImportedStateDuring(() => {
      editor.graph.createNode('FRAME', editor.state.currentPageId, { width: 100 })
    })
    await recovery.persistNow()
    expect(builds).toBe(0)
    expect(await store.list()).toEqual([])
    editor.createShape('RECTANGLE', 0, 0, 40, 20)
    await recovery.persistNow()
    expect(builds).toBe(1)
    expect((await store.read('imported-population'))?.figBytes).toEqual(new Uint8Array([1]))
  } finally {
    recovery.disposeRecovery()
    changes.dispose()
    editor.dispose()
  }
})

test('reader fallback page loading preserves clean and authored dirty revisions', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.getPages()[0].id, { name: 'First' })
  source.createNode('RECTANGLE', source.addPage('Second').id, { name: 'Second' })
  source.createNode('RECTANGLE', source.addPage('Third').id, { name: 'Third' })
  const bytes = await exportFigFile(source)
  const graph = await parseFigFile(bytes.slice().buffer, { populate: 'first-page' })
  const editor = createEditor({ graph })
  const changes = createDocumentChanges(editor)
  try {
    const saved = changes.capture()
    expect(recoverReaderPage(graph, graph.getPages()[1].id)).toBe(true)
    expect(graph.getChildren(graph.getPages()[1].id)[0].name).toBe('Second')
    expect(changes.capture()).toBe(saved)
    expect(changes.hasUnsavedChanges()).toBe(false)
    const first = graph.getChildren(graph.getPages()[0].id)[0]
    graph.updateNode(first.id, { name: 'Authored edit' })
    const dirty = changes.capture()
    expect(recoverReaderPage(graph, graph.getPages()[2].id)).toBe(true)
    expect(changes.capture()).toBe(dirty)
    expect(changes.hasUnsavedChanges()).toBe(true)
    expect(graph.getNode(first.id)?.name).toBe('Authored edit')
  } finally {
    changes.dispose()
    editor.dispose()
  }
})

test("loading a page's layers from the opened file does not dirty a document", async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.addPage('Second').id, { name: 'Loaded later' })
  const bytes = await exportFigFile(source)
  const graph = await parseFigFile(bytes.slice().buffer, { populate: 'first-page' })
  const editor = createEditor({ graph })
  const changes = createDocumentChanges(editor)
  try {
    const page = graph.getPages()[1]
    expect(populateFigPage(graph, page.id)).toBe(true)
    computeAllLayouts(graph, page.id)
    expect(graph.getChildren(page.id)).toHaveLength(1)
    expect(changes.hasUnsavedChanges()).toBe(false)

    editor.graph.createNode('RECTANGLE', page.id, { width: 10, height: 10 })
    expect(changes.hasUnsavedChanges()).toBe(true)
  } finally {
    changes.dispose()
    editor.dispose()
  }
})
