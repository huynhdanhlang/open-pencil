import { expect, test } from 'bun:test'

import { parseFigBuffer } from '@open-pencil/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

import { shapeText } from '#core/canvas/text/shape'
import { getCanvasKit } from '#core/canvaskit'
import { exportFigFile } from '#core/io/formats/fig/export'
import { initCanvasKit } from '#core/io/formats/raster/headless'
import { fontManager } from '#core/text/fonts'

for (const [runtime, loadCanvasKit] of [
  ['native', getCanvasKit],
  ['headless', initCanvasKit]
] as const) {
  for (const text of [
    'Nguồn công cụ, giấy phép và phạm vi sử dụng cần được kiểm tra trước khi thay đổi.',
    'office affine\nTiếng Việt ở dòng tiếp theo'
  ]) {
    test(`FIG save retains editable line placement in ${runtime}: ${text.slice(0, 12)}`, async () => {
      const ck = await loadCanvasKit()
      const provider = ck.TypefaceFontProvider.Make()
      fontManager.attachProvider(ck, provider)
      try {
        const data = await Bun.file(
          new URL('../../../../../assets/Inter-Regular.ttf', import.meta.url)
        ).arrayBuffer()
        fontManager.markLoaded('Inter', 'Regular', data)
        const graph = new SceneGraph()
        const node = graph.createNode('TEXT', graph.getPages()[0].id, {
          text,
          fontFamily: 'Inter',
          fontSize: 18,
          lineHeight: 27,
          width: 399,
          height: 81,
          textAutoResize: 'HEIGHT',
          fontFeatures: [
            { tag: 'LIGA', enabled: true },
            { tag: 'CALT', enabled: true }
          ]
        })
        const shaped = shapeText(ck, provider, node)
        if (!shaped?.baselines) throw new Error('Native paragraph did not produce shaped text')
        expect(shaped?.baselines?.length).toBeGreaterThan(1)
        expect(shaped.glyphs.every((glyph) => glyph.firstCharacter < node.text.length)).toBe(true)
        const secondLine = shaped.baselines[1].firstCharacter
        expect(shaped.logicalIndexToCharacterOffsetMap[secondLine]).toBe(0)
        const bytes = await exportFigFile(graph, ck)
        const parsed = parseFigBuffer(bytes.buffer as ArrayBuffer)
        const saved = parsed.nodeChanges.find((change) => change.type === 'TEXT')
        expect(saved?.textAutoResize).toBe('HEIGHT')
        expect(saved?.textData?.characters).toBe(node.text)
        expect(saved?.derivedTextData?.baselines?.length).toBe(shaped?.baselines?.length)
        expect(
          new Set(saved?.derivedTextData?.glyphs?.map((glyph) => glyph.position.y)).size
        ).toBeGreaterThan(1)
        expect(
          saved?.derivedTextData?.glyphs?.map((glyph) => ({
            firstCharacter: glyph.firstCharacter,
            x: glyph.position.x,
            y: glyph.position.y
          }))
        ).toEqual(shaped.glyphs.map(({ firstCharacter, x, y }) => ({ firstCharacter, x, y })))
      } finally {
        fontManager.detachProvider(provider)
        provider.delete()
      }
    })
  }
}

test('FIG glyph identities use the saved font buffer despite an earlier provider face', async () => {
  const ck = await getCanvasKit()
  const data = await Bun.file(
    new URL('../../../../../assets/Inter-Regular.ttf', import.meta.url)
  ).arrayBuffer()
  const earlier = await Bun.file(
    new URL('../../../../../assets/NotoNaskhArabic-Regular.ttf', import.meta.url)
  ).arrayBuffer()
  fontManager.markLoaded('Inter', 'Regular', data)
  const graph = new SceneGraph()
  const node = graph.createNode('TEXT', graph.getPages()[0].id, {
    text: 'office affine\nTiếng Việt ở dòng tiếp theo',
    fontFamily: 'Inter',
    fontSize: 18,
    lineHeight: 27,
    width: 399,
    height: 81,
    textAutoResize: 'HEIGHT'
  })
  const saved = []
  const identities = []
  for (const earlierFace of [null, earlier]) {
    const provider = ck.TypefaceFontProvider.Make()
    if (earlierFace) provider.registerFont(earlierFace, 'Inter')
    fontManager.attachProvider(ck, provider)
    try {
      const shaped = shapeText(ck, provider, node)
      identities.push(shaped?.glyphs.map((glyph) => glyph.commands))
      const bytes = await exportFigFile(graph, ck)
      const parsed = parseFigBuffer(bytes.buffer as ArrayBuffer)
      saved.push({
        derived: parsed.nodeChanges.find((change) => change.type === 'TEXT')?.derivedTextData,
        blobs: parsed.blobs
      })
    } finally {
      fontManager.detachProvider(provider)
      provider.delete()
    }
  }
  expect(identities[1]).not.toEqual(identities[0])
  expect(saved[1]).toEqual(saved[0])
})
