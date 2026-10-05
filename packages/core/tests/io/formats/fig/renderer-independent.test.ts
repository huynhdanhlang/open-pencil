import { expect, spyOn, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

import { fontManager } from '#core/text/fonts'

test('renderer-independent FIG preserves editable content while CanvasKit is unavailable', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'Recovery component',
    width: 100,
    height: 80
  })
  graph.createNode('TEXT', component.id, {
    name: 'Recovery text',
    text: 'Thiết kế chưa lưu',
    fontSize: 16
  })
  graph.createInstance(component.id, page.id)
  const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const imageHash = '0000000000000000000000000000000000000001'
  graph.images.set(imageHash, image)
  graph.createNode('RECTANGLE', page.id, {
    name: 'Recovery image',
    fills: [
      { type: 'IMAGE', color: { r: 1, g: 1, b: 1, a: 1 }, imageHash, opacity: 1, visible: true }
    ]
  })
  const provider = spyOn(fontManager, 'providerCanvasKit').mockImplementation(() => {
    throw new WebAssembly.RuntimeError('Aborted(). Build with -sASSERTIONS for more info.')
  })
  try {
    let failure: unknown
    try {
      await exportFigFile(graph)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(WebAssembly.RuntimeError)
    provider.mockClear()
    const bytes = await exportFigFile(graph, undefined, undefined, page.id, false, {
      rendering: 'none'
    })
    const restored = await parseFigFile(bytes.slice().buffer)
    expect(provider).not.toHaveBeenCalled()
    const nodes = [...restored.getAllNodes()]
    expect(nodes.find((node) => node.name === 'Recovery text')?.text).toBe('Thiết kế chưa lưu')
    const restoredComponent = nodes.find((node) => node.name === component.name)
    expect(restoredComponent?.type).toBe('COMPONENT')
    expect(nodes.find((node) => node.type === 'INSTANCE')?.componentId).toBe(restoredComponent?.id)
    expect(restored.images.get(imageHash)).toEqual(image)
  } finally {
    provider.mockRestore()
  }
})
