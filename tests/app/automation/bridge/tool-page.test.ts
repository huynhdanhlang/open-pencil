import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { BUILTIN_IO_FORMATS, IORegistry, parseFigFile } from '@open-pencil/core/io'
import { SceneGraph, type Vector } from '@open-pencil/scene-graph'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore, type EditorStore } from '@/app/editor/session/create'

const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
let stores: EditorStore[] = []

beforeEach(() => {
  // The automation FigmaAPI reads the viewport size from the window.
  Object.assign(globalThis, { window: { innerWidth: 1024, innerHeight: 768 } })
})

afterEach(() => {
  for (const store of stores) store.dispose()
  stores = []
  Reflect.deleteProperty(globalThis, 'window')
})

/** A `.fig` opened like the app does: only the first page has its layers. */
async function storeWithUnshownPage(): Promise<{ store: EditorStore; pageId: string }> {
  const source = new SceneGraph()
  source.createNode('FRAME', source.getPages()[0].id, { name: 'First frame' })
  const second = source.addPage('Second')
  source.createNode('FRAME', second.id, { name: 'Second frame', width: 70, height: 35 })
  const written = await new IORegistry(BUILTIN_IO_FORMATS).writeDocument('fig', source)
  const bytes = written.data as Uint8Array
  const graph = await parseFigFile(bytes.slice().buffer, { populate: 'first-page' })
  const store = createEditorStore(graph)
  stores.push(store)
  const page = graph.getPages().find((p) => p.name === 'Second')
  if (!page) throw new Error('Missing second page')
  expect(graph.getChildren(page.id)).toHaveLength(0)
  return { store, pageId: page.id }
}

function target(store: EditorStore, pageId: string): AutomationTarget {
  return {
    store,
    documentId: 'tab-1',
    documentName: 'Document',
    pageId,
    pageName: store.graph.getNode(pageId)?.name ?? ''
  }
}

describe('automation tools on a page that has not been shown', () => {
  test('view commands prepare a newly shown page once and preserve history', async () => {
    const { store, pageId } = await storeWithUnshownPage()
    const prepare = spyOn(store, 'preparePageNodes')
    const switchPage = spyOn(store, 'switchPage')
    const stop = store.onPreparationEvent('preparation:updated', (preparation) => {
      if (preparation.phase === 'preparing-render') {
        store.preparationController.acknowledgePresentation(store.state.sceneVersion)
      }
    })
    try {
      await handleTargetCommand(target(store, pageId), 'tool', {
        name: 'viewport_set',
        args: { x: 20, y: 10, zoom: 0.5 }
      })
      expect(store.graph.getChildren(pageId)).toHaveLength(1)
      expect(store.state.currentPageId).toBe(pageId)
      expect(switchPage).toHaveBeenCalledTimes(1)
      expect(prepare).not.toHaveBeenCalled()
      await handleTargetCommand(target(store, pageId), 'tool', {
        name: 'select_nodes',
        args: { ids: [store.graph.getChildren(pageId)[0].id] }
      })
      expect(switchPage).toHaveBeenCalledTimes(1)
      expect(prepare).not.toHaveBeenCalled()
      expect(store.undo.canUndo).toBe(false)
      store.graph.deleteNode(pageId)
      await expect(
        handleTargetCommand(target(store, pageId), 'tool', {
          name: 'viewport_set',
          args: { zoom: 1 }
        })
      ).rejects.toThrow('closed')
    } finally {
      stop()
      prepare.mockRestore()
      switchPage.mockRestore()
    }
  })
  test('selection reveals the scoped page and fit respects actual canvas bounds', async () => {
    const { store, pageId } = await storeWithUnshownPage()
    store.setViewportSize(800, 600)
    const nodes = store.graph.getChildren(pageId)
    expect(nodes).toHaveLength(0)
    await store.preparePageNodes(pageId)
    const frame = store.graph.getChildren(pageId)[0]
    store.graph.updateNode(frame.id, { width: 900, height: 600 })
    // Engine coverage supplies the presentation receipt; the native probe verifies the real view.
    const stop = store.onPreparationEvent('preparation:updated', (preparation) => {
      if (preparation.phase === 'preparing-render') {
        store.preparationController.acknowledgePresentation(store.state.sceneVersion)
      }
    })
    try {
      await handleTargetCommand(target(store, pageId), 'tool', {
        name: 'select_nodes',
        args: { ids: [frame.id] }
      })
    } finally {
      stop()
    }
    expect(store.state.currentPageId).toBe(pageId)
    expect([...store.state.selectedIds]).toEqual([frame.id])
    await handleTargetCommand(target(store, pageId), 'tool', {
      name: 'viewport_zoom_to_fit',
      args: { ids: [frame.id] }
    })
    const read = (await handleTargetCommand(target(store, pageId), 'tool', {
      name: 'viewport_get',
      args: {}
    })) as { result: { center: Vector; zoom: number } }
    expect(read.result.center).toEqual({ x: 450, y: 300 })
    expect(read.result.zoom).toBeCloseTo(800 / 1060)
    expect(store.undo.canUndo).toBe(false)
  })
  test('selection writes reach the editor and the next scoped read', async () => {
    const store = createEditorStore()
    stores.push(store)
    const pageId = store.state.currentPageId
    const frame = store.graph.createNode('FRAME', pageId)
    await handleTargetCommand(target(store, pageId), 'tool', {
      name: 'select_nodes',
      args: { ids: [frame.id] }
    })
    expect([...store.state.selectedIds]).toEqual([frame.id])
    const read = (await handleTargetCommand(target(store, pageId), 'tool', {
      name: 'get_selection',
      args: {}
    })) as { result: { selection: Array<{ id: string }> } }
    expect(read.result.selection.map((node) => node.id)).toEqual([frame.id])
    expect(store.undo.canUndo).toBe(false)
  })

  test('viewport writes use the canvas size and survive the next scoped read', async () => {
    const store = createEditorStore()
    stores.push(store)
    store.setViewportSize(800, 600)
    const pageId = store.state.currentPageId
    await handleTargetCommand(target(store, pageId), 'tool', {
      name: 'viewport_set',
      args: { x: 500, y: 300, zoom: 0.5 }
    })
    expect(store.state.zoom).toBe(0.5)
    expect(store.state.panX).toBe(150)
    expect(store.state.panY).toBe(150)
    const read = (await handleTargetCommand(target(store, pageId), 'tool', {
      name: 'viewport_get',
      args: {}
    })) as { result: { center: Vector; zoom: number } }
    expect(read.result.center).toEqual({ x: 500, y: 300 })
    expect(read.result.zoom).toBe(0.5)
    expect(store.undo.canUndo).toBe(false)
    for (const [requested, actual] of [
      [0.01, 0.02],
      [1000, 256]
    ]) {
      const response = (await handleTargetCommand(target(store, pageId), 'tool', {
        name: 'viewport_set',
        args: { x: 500, y: 300, zoom: requested }
      })) as { result: { zoom: number } }
      expect(response.result.zoom).toBe(actual)
      expect(store.state.zoom).toBe(actual)
    }
  })

  test('view commands reject node IDs belonging to another page', async () => {
    const store = createEditorStore()
    stores.push(store)
    const pageId = store.state.currentPageId
    const other = store.graph.addPage('Other')
    const node = store.graph.createNode('FRAME', other.id)
    for (const name of ['select_nodes', 'viewport_zoom_to_fit']) {
      await expect(
        handleTargetCommand(target(store, pageId), 'tool', {
          name,
          args: { ids: [node.id] }
        })
      ).rejects.toThrow('outside the target page')
    }
    expect(store.state.currentPageId).toBe(pageId)
    expect([...store.state.selectedIds]).toEqual([])
    expect(store.undo.canUndo).toBe(false)
  })
  test('find_nodes sees the layers of the target page', async () => {
    const { store, pageId } = await storeWithUnshownPage()
    const shown = store.state.currentPageId

    const response = (await handleTargetCommand(target(store, pageId), 'tool', {
      name: 'find_nodes',
      args: { name: 'Second frame' }
    })) as { result: { count: number } }

    expect(response.result.count).toBe(1)
    expect(store.state.currentPageId).toBe(shown)
  })

  test('a shape created there joins the existing layers', async () => {
    const { store, pageId } = await storeWithUnshownPage()

    await handleTargetCommand(target(store, pageId), 'tool', {
      name: 'create_shape',
      args: { type: 'RECTANGLE', x: 0, y: 0, width: 10, height: 10, name: 'Added' }
    })

    expect(store.graph.getChildren(pageId).map((node) => node.name)).toEqual([
      'Second frame',
      'Added'
    ])
  })

  test('a tool measures the target page after its layout runs', async () => {
    const store = createEditorStore()
    stores.push(store)
    const other = store.graph.addPage('Other').id
    // Not laid out yet: the row hugs one 80 px child but still says 10 px.
    const row = store.graph.createNode('FRAME', other, {
      width: 10,
      height: 20,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED'
    })
    store.graph.createNode('FRAME', row.id, { width: 80, height: 20 })

    const response = (await handleTargetCommand(target(store, other), 'tool', {
      name: 'get_node',
      args: { id: row.id }
    })) as { result: { width: number } }

    expect(response.result.width).toBe(80)
  })
})
