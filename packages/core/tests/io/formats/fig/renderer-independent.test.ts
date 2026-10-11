import { expect, spyOn, test } from 'bun:test'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { parseFigBuffer } from '@open-pencil/fig'
import { encodePathCommandsBlob, type ShapedText } from '@open-pencil/fig/node-change'
import { SceneGraph } from '@open-pencil/scene-graph'

import { fontManager } from '#core/text/fonts'

test.each([false, true])(
  'prepared FIG preserves multiline decorations without worker fonts (saved glyphs: %p)',
  async (saved) => {
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', graph.getPages()[0].id, {
      text: 'A\nB',
      fontSize: 20,
      textDecoration: 'UNDERLINE',
      width: 100,
      height: 60
    })
    const shaped: ShapedText = {
      glyphs: [0, 2].map((firstCharacter, index) => ({
        firstCharacter,
        x: 0,
        y: 20 + index * 30,
        fontSize: 20,
        advance: 12,
        commands: [{ type: 'Z' }]
      })),
      baselines: [],
      logicalIndexToCharacterOffsetMap: [0, 0, 0]
    }
    if (saved)
      node.derivedTextGlyphs = shaped.glyphs.map(({ commands, ...glyph }) => ({
        ...glyph,
        commandsBlob: encodePathCommandsBlob(commands ?? [{ type: 'Z' }], 20)
      }))
    const decorations = [20, 50].map((y, index) => ({
      firstCharacter: index * 2,
      x: 0,
      y: y + 4,
      width: 12,
      height: 2
    }))
    const provider = spyOn(fontManager, 'providerCanvasKit').mockImplementation(() => {
      throw new Error('Prepared worker must not initialize native fonts')
    })
    try {
      const bytes = await exportFigFile(graph, undefined, undefined, undefined, false, {
        rendering: 'none',
        prepared: {
          shapedText: new Map([[node.id, shaped]]),
          textDecorations: new Map([[node.id, decorations]]),
          fontDigests: new Map()
        }
      })
      const exported = parseFigBuffer(bytes.slice().buffer).nodeChanges.find(
        (change) => change.type === 'TEXT'
      )
      expect(
        exported?.derivedTextData?.decorations?.flatMap((decoration) => decoration.rects)
      ).toEqual(decorations.map(({ x, y, width, height }) => ({ x, y, w: width, h: height })))
      expect(provider).not.toHaveBeenCalled()
    } finally {
      provider.mockRestore()
    }
  }
)

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
