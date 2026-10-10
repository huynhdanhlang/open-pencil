import { expect, test } from 'bun:test'

import { createSSRApp, effectScope, reactive } from 'vue'

import { createDefaultEditorState, createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'
import { colorToFill } from '@open-pencil/scene-graph/color'

import { useSelectionColors } from '#vue/controls/selection-colors/use'
import { EDITOR_KEY } from '#vue/editor/context'

test('keeps the picker row on its paint after Undo, Redo, and continued editing', () => {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const editor = createEditor({ graph, state: reactive(createDefaultEditorState(pageId)) })
  const red = graph.createNode('RECTANGLE', pageId, { fills: [colorToFill('#ff0000')] })
  const blue = graph.createNode('RECTANGLE', pageId, { fills: [colorToFill('#0000ff')] })
  editor.select([red.id, blue.id])
  const app = createSSRApp({ render: () => null })
  app.provide(EDITOR_KEY, editor)
  const scope = effectScope()
  const selection = app.runWithContext(() => scope.run(useSelectionColors))
  if (!selection) throw new Error('Selection colors scope was not created')
  try {
    selection.begin()
    selection.replace(1, { color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1 })
    expect(graph.getNode(red.id)?.fills[0]?.color).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(selection.colors.value[1]?.color).toEqual({ r: 0, g: 0, b: 0, a: 1 })

    editor.undo.undo()
    expect(graph.getNode(red.id)?.fills[0]?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(selection.colors.value[1]?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    editor.undo.redo()
    expect(selection.colors.value[1]?.color).toEqual({ r: 0, g: 0, b: 0, a: 1 })

    selection.replace(1, { color: { r: 1, g: 1, b: 0, a: 1 }, opacity: 1 })
    selection.finish()
    expect(graph.getNode(red.id)?.fills[0]?.color).toEqual({ r: 1, g: 1, b: 0, a: 1 })
    expect(graph.getNode(blue.id)?.fills[0]?.color).toEqual({ r: 0, g: 0, b: 1, a: 1 })
    editor.undo.undo()
    expect(graph.getNode(red.id)?.fills[0]?.color).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  } finally {
    scope.stop()
    editor.dispose()
  }
})

test('recovers the live list when Undo removes a paint from an open picker', () => {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const editor = createEditor({ graph, state: reactive(createDefaultEditorState(pageId)) })
  const frame = graph.createNode('FRAME', pageId, { fills: [colorToFill('#ff0000')] })
  graph.createNode('RECTANGLE', frame.id, { fills: [colorToFill('#0000ff')] })
  editor.select([frame.id])
  editor.updateNodeWithUndo(
    frame.id,
    { fills: [colorToFill('#ff0000'), colorToFill('#00ff00')] },
    'Add fill'
  )
  const app = createSSRApp({ render: () => null })
  app.provide(EDITOR_KEY, editor)
  const scope = effectScope()
  const selection = app.runWithContext(() => scope.run(useSelectionColors))
  if (!selection) throw new Error('Selection colors scope was not created')
  try {
    selection.begin()
    expect(selection.colors.value).toHaveLength(3)
    editor.undo.undo()
    expect(selection.colors.value).toHaveLength(2)
    expect(selection.colors.value.map((entry) => entry.color)).toEqual([
      { r: 0, g: 0, b: 1, a: 1 },
      { r: 1, g: 0, b: 0, a: 1 }
    ])
  } finally {
    scope.stop()
    editor.dispose()
  }
})
