import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'
import { UndoManager } from '@open-pencil/scene-graph/undo'

import { executeAtomicTool } from '#core/editor/history/atomic-tool'
import { FigmaAPI } from '#core/figma-api'
import { computeLayout } from '#core/layout'
import { setLayoutChild } from '#core/tools/modify/layout'

test.each(['HORIZONTAL', 'VERTICAL'] as const)(
  'leaf Fill follows the %s parent cross axis and Fixed clears it',
  (layoutMode) => {
    const graph = new SceneGraph()
    const api = new FigmaAPI(graph)
    const parent = graph.createNode('FRAME', api.currentPageId, {
      layoutMode,
      width: 752,
      height: 200,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 8,
      paddingBottom: 8
    })
    const dimension = layoutMode === 'VERTICAL' ? 'width' : 'height'
    const sizing = layoutMode === 'VERTICAL' ? 'sizing_horizontal' : 'sizing_vertical'
    for (const type of ['TEXT', 'RECTANGLE'] as const) {
      const child = graph.createNode(type, parent.id, {
        width: 228,
        height: 24,
        text: 'Counter',
        textAutoResize: 'NONE',
        textAlignHorizontal: 'RIGHT'
      })
      setLayoutChild.execute(api, { id: child.id, [sizing]: 'FILL' })
      computeLayout(graph, parent.id)
      expect(child[dimension]).toBe(parent[dimension] - 16)
      graph.updateNode(parent.id, { [dimension]: 1000 })
      computeLayout(graph, parent.id)
      expect(child[dimension]).toBe(984)
      setLayoutChild.execute(api, { id: child.id, [sizing]: 'FIXED' })
      expect(child.layoutAlignSelf).toBe('AUTO')
      graph.updateNode(parent.id, { [dimension]: 1200 })
      computeLayout(graph, parent.id)
      expect(child[dimension]).toBe(984)
      expect(child.textAlignHorizontal).toBe('RIGHT')
    }
  }
)

test('a canonical layout-child transaction is scoped above 20k nodes and preserves Undo', () => {
  const graph = new SceneGraph()
  const api = new FigmaAPI(graph)
  const undo = new UndoManager()
  const parent = graph.createNode('FRAME', api.currentPageId, {
    layoutMode: 'VERTICAL',
    width: 752,
    height: 100,
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED'
  })
  const child = graph.createNode('RECTANGLE', parent.id, { width: 228, height: 24 })
  const foreign = graph.addPage('Unrelated')
  while (graph.nodes.size <= 20_000) graph.createNode('RECTANGLE', foreign.id)
  const unrelated = graph.getChildren(foreign.id)[0]
  unrelated.source.fig.rawNodeFields.notCloneable = () => undefined
  const editor = {
    graph,
    runLayoutForNode: () => computeLayout(graph, parent.id),
    requestRender: () => undefined,
    pushUndoEntry: undo.push.bind(undo)
  }
  executeAtomicTool(editor, api, setLayoutChild, {
    id: child.id,
    sizing_horizontal: 'FILL',
    align_self: 'STRETCH'
  })
  expect(child.width).toBe(752)
  expect(child.layoutAlignSelf).toBe('STRETCH')
  unrelated.name = 'Later unrelated edit'
  undo.undo()
  expect(child.width).toBe(228)
  expect(child.layoutAlignSelf).toBe('AUTO')
  undo.redo()
  expect(child.width).toBe(752)
  expect(unrelated.name).toBe('Later unrelated edit')
  expect(() => executeAtomicTool(editor, api, { ...setLayoutChild }, { id: child.id })).toThrow(
    'maximum 20000'
  )
})

test('layout-child failure rolls back sizing, geometry and source markers', () => {
  const graph = new SceneGraph()
  const api = new FigmaAPI(graph)
  const child = api.createRectangle()
  const before = structuredClone(graph.getNode(child.id))
  const undo = new UndoManager()
  const editor = {
    graph,
    runLayoutForNode: () => {
      throw new Error('Layout failed')
    },
    requestRender: () => undefined,
    pushUndoEntry: undo.push.bind(undo)
  }
  expect(() =>
    executeAtomicTool(editor, api, setLayoutChild, {
      id: child.id,
      sizing_horizontal: 'FILL',
      align_self: 'STRETCH'
    })
  ).toThrow('Layout failed')
  expect(graph.getNode(child.id)).toEqual(before)
  expect(undo.canUndo).toBe(false)
})

test('combined flow and sizing use the final positioning while explicit alignment wins', () => {
  const graph = new SceneGraph()
  const api = new FigmaAPI(graph)
  const parent = graph.createNode('FRAME', api.currentPageId, {
    layoutMode: 'VERTICAL',
    width: 752,
    height: 100,
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED'
  })
  const child = graph.createNode('RECTANGLE', parent.id, {
    width: 228,
    height: 24,
    layoutPositioning: 'ABSOLUTE'
  })
  setLayoutChild.execute(api, { id: child.id, positioning: 'AUTO', sizing_horizontal: 'FILL' })
  computeLayout(graph, parent.id)
  expect(child.width).toBe(752)
  setLayoutChild.execute(api, { id: child.id, positioning: 'ABSOLUTE', sizing_horizontal: 'FIXED' })
  graph.updateNode(parent.id, { width: 1000 })
  computeLayout(graph, parent.id)
  expect(child.width).toBe(752)
  setLayoutChild.execute(api, {
    id: child.id,
    positioning: 'AUTO',
    sizing_horizontal: 'FILL',
    align_self: 'MAX'
  })
  expect(child.layoutAlignSelf).toBe('MAX')
})
