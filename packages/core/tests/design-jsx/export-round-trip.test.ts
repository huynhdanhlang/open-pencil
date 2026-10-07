import { describe, expect, it, test } from 'bun:test'

import { expectDefined, getNodeOrThrow } from '#core-tests/helpers/assert'
import { findByName, PROPERTY_CASES } from '#core-tests/helpers/property-cases'
import { pick } from 'es-toolkit'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { sceneNodeToJSX } from '@open-pencil/design-jsx'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor/create'
import { executeAtomicTool } from '#core/editor/history/atomic-tool'
import { FigmaAPI } from '#core/figma-api'
import { exportFigFile, parseFigFile } from '#core/io/formats/fig'
import { computeLayout } from '#core/layout'
import { setLayoutChild } from '#core/tools/modify/layout'
import { updateNode } from '#core/tools/modify/update'

test('leaf Fill survives component instances, complete JSX and FIG Save at large/mobile widths', async () => {
  const graph = new SceneGraph()
  const api = new FigmaAPI(graph)
  const source = graph.createNode('COMPONENT', api.currentPageId, {
    name: 'Responsive input',
    layoutMode: 'VERTICAL',
    width: 752,
    height: 120,
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    paddingLeft: 8,
    paddingRight: 8
  })
  for (const type of ['TEXT', 'RECTANGLE'] as const) {
    const child = graph.createNode(type, source.id, {
      name: type === 'TEXT' ? 'Counter' : 'Camera',
      width: 228,
      height: 24,
      text: '0 / 1000',
      textAutoResize: 'NONE',
      textAlignHorizontal: 'RIGHT'
    })
    setLayoutChild.execute(api, { id: child.id, sizing_horizontal: 'FILL' })
    expect(api.getNodeById(child.id)?.layoutSizingHorizontal).toBe('FILL')
  }
  computeLayout(graph, source.id)
  const instance = expectDefined(graph.createInstance(source.id, api.currentPageId), 'instance')
  graph.updateNode(instance.id, { width: 1000 })
  computeLayout(graph, instance.id)
  expect(graph.getChildren(instance.id).map((node) => node.width)).toEqual([984, 984])

  const jsx = sceneNodeToJSX(source.id, graph)
  const renderedGraph = new SceneGraph()
  const [rendered] = await renderJSX(renderedGraph, jsx)
  expect(rendered).toBeDefined()
  for (const width of [1000, 320]) {
    renderedGraph.updateNode(rendered.id, { width })
    computeLayout(renderedGraph, rendered.id)
    const children = renderedGraph.getChildren(rendered.id)
    expect(children.map((node) => node.width)).toEqual([width - 16, width - 16])
    expect(children[0].textAlignHorizontal).toBe('RIGHT')
  }
  const bytes = await exportFigFile(graph, undefined, undefined, undefined, false, {
    rendering: 'none'
  })
  const restored = await parseFigFile(bytes.slice().buffer as ArrayBuffer, { populate: 'all' })
  const restoredSource = [...restored.nodes.values()].find(
    (node) => node.name === source.name && node.type === 'COMPONENT'
  )
  expect(restoredSource).toBeDefined()
  if (!restoredSource) throw new Error('Missing saved component')
  const editor = createEditor({ graph: restored, skipInitialGraphSetup: true })
  editor.subscribeToGraph()
  try {
    const savedInstance = [...restored.nodes.values()].find((node) => node.type === 'INSTANCE')
    if (!savedInstance) throw new Error('Missing saved instance')
    // Exercise the imported-instance preservation branch as well as generated source metadata.
    savedInstance.source.format = 'fig'
    const importedWidths = restored.getChildren(savedInstance.id).map((node) => node.width)
    editor.runLayoutForNode(savedInstance.id)
    expect(restored.getChildren(savedInstance.id).map((node) => node.width)).toEqual(importedWidths)
    executeAtomicTool(editor, new FigmaAPI(restored), updateNode, {
      id: savedInstance.id,
      width: 320
    })
    expect(restored.getChildren(savedInstance.id).map((node) => node.width)).toEqual([304, 304])
    await editor.runMutationWithLayout(() => {
      restored.updateNode(restoredSource.id, { width: 320 })
    }, restoredSource.id)
    expect(restored.getChildren(restoredSource.id).map((node) => node.width)).toEqual([304, 304])
    expect(restored.getChildren(restoredSource.id)[0].textAlignHorizontal).toBe('RIGHT')
  } finally {
    editor.dispose()
    editor.releaseGraphResources()
  }
})

describe('attribute string round-trip', () => {
  it.each([
    // Unescaped, this name would inject `w={999}` into the exported frame.
    'a" w={999} x="',
    'Fish &amp; chips',
    'Back\\slash',
    'Two\nlines',
    'Tab\there',
    'Plain name'
  ])('keeps the layer name %p', async (name) => {
    const g = new SceneGraph()
    const [source] = await renderJSX(g, '<Frame w={10} h={10} />')
    getNodeOrThrow(g, source.id).name = name
    const [result] = await renderJSX(g, sceneNodeToJSX(source.id, g))
    expect(getNodeOrThrow(g, result.id)).toMatchObject({ name, width: 10 })
  })
})

describe('text content round-trip', () => {
  it.each([
    'Curly {braces} and <tags>',
    'Fish &amp; chips',
    'Line one\nLine two',
    '  padded  ',
    'Back\\slash',
    'Tab\there'
  ])('keeps the text %p', async (text) => {
    const g = new SceneGraph()
    const [source] = await renderJSX(g, '<Text color="#000">Placeholder</Text>')
    getNodeOrThrow(g, source.id).text = text
    const [result] = await renderJSX(g, sceneNodeToJSX(source.id, g))
    expect(getNodeOrThrow(g, result.id).text).toBe(text)
  })
})

test('size limits are limits, not a width', async () => {
  const graph = new SceneGraph()
  const [defaultWidth] = await renderJSX(graph, '<Frame h={10} />')
  const [limited] = await renderJSX(graph, '<Frame h={10} maxW={400} />')
  const width = (id: string | undefined) => graph.getNode(expectDefined(id, 'frame'))?.width
  expect(graph.getNode(expectDefined(limited, 'frame').id)?.maxWidth).toBe(400)
  expect(width(limited?.id)).toBe(width(defaultWidth?.id))
})

describe('design JSX export round trip', () => {
  test.each(PROPERTY_CASES.map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    async (_, testCase) => {
      const graph = new SceneGraph()
      const source = expectDefined(graph.getPages()[0], 'source page')
      const target = graph.addPage('Rendered')
      const { rootId, target: targetName } = testCase.build(graph, source.id)

      const jsx = sceneNodeToJSX(rootId, graph)
      const [rendered] = await renderJSX(graph, jsx, { parentId: target.id })
      const renderedRoot = expectDefined(rendered, 'render result').id

      const original = findByName(graph, rootId, targetName)
      const copy = findByName(graph, renderedRoot, targetName)
      expect(pick(copy, testCase.fields)).toEqual(pick(original, testCase.fields))
      // Everything the export wrote comes back, so exporting the copy changes nothing.
      expect(sceneNodeToJSX(renderedRoot, graph)).toBe(jsx)
    }
  )
})
