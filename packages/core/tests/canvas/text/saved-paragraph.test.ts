import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { expectDefined } from '#core-tests/helpers/assert'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { SkiaRenderer } from '#core/canvas/renderer'
import { renderText } from '#core/canvas/scene'
import { drawDerivedText } from '#core/canvas/text/derived'
import { getCanvasKit } from '#core/canvaskit'
import { exportFigFile, parseFigFile } from '#core/io/formats/fig'
import { fontManager } from '#core/text/fonts'

describe('saved paragraph raster continuity', () => {
  beforeAll(async () => {
    const inter = expectDefined(await fontManager.fetchBundledFont('/Inter-Regular.ttf'))
    fontManager.markLoaded('Inter', 'Regular', inter)
  })

  test.each([13, 17, 24])(
    'keeps live pixels after Save/import at size %p',
    async (fontSize) => {
      const ck = await getCanvasKit()
      const graph = new SceneGraph()
      const node = graph.createNode('TEXT', graph.getPages()[0].id, {
        name: 'Message',
        text: 'A sentence with arrows a->b and enough words to wrap onto two lines.',
        fontFamily: 'Inter',
        fontSize,
        lineHeight: fontSize + 8,
        width: 280,
        height: 100,
        textAlignVertical: 'CENTER',
        fills: [
          {
            type: 'SOLID',
            color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
            visible: true,
            opacity: 1
          }
        ]
      })
      const surface = expectDefined(ck.MakeSurface(320, 140))
      const renderer = new SkiaRenderer(ck, surface)
      await renderer.loadFonts()
      const capture = (text: SceneNode, derivedOnly = false) => {
        const canvas = surface.getCanvas()
        canvas.clear(ck.Color4f(0.8, 0.65, 0.3, 1))
        canvas.save()
        canvas.translate(10.25, 10.5)
        renderer.fillPaint.setColor(ck.Color4f(0.1, 0.1, 0.1, 1))
        renderer.fillPaint.setBlendMode(
          text.fills[0]?.blendMode === 'MULTIPLY' ? ck.BlendMode.Multiply : ck.BlendMode.SrcOver
        )
        if (derivedOnly) drawDerivedText(renderer, canvas, text)
        else renderText(renderer, canvas, text)
        canvas.restore()
        surface.flush()
        const image = surface.makeImageSnapshot()
        try {
          return createHash('sha256')
            .update(expectDefined(image.encodeToBytes(ck.ImageFormat.PNG, 100)))
            .digest('hex')
        } finally {
          image.delete()
        }
      }
      try {
        const live = capture(node)
        const saved = await exportFigFile(graph, ck)
        const reopened = await parseFigFile(saved.buffer as ArrayBuffer, {
          populate: 'all'
        })
        const imported = expectDefined(
          [...reopened.getAllNodes()].find((n) => n.name === 'Message')
        )
        expect(imported.derivedTextGlyphs?.length).toBeGreaterThan(0)
        expect(capture(imported)).toEqual(live)
        expect(capture(imported)).toEqual(live)
        const blended = {
          ...imported,
          fills: imported.fills.map((fill) => ({
            ...fill,
            blendMode: 'MULTIPLY' as const
          }))
        }
        expect(capture(blended)).toEqual(capture(blended, true))
        const originalProvider = renderer.fontProvider
        const polluted = ck.TypefaceFontProvider.Make()
        const wrongFace = expectDefined(
          await fontManager.fetchBundledFont('/NotoNaskhArabic-Regular.ttf')
        )
        polluted.registerFont(wrongFace, 'Inter')
        renderer.fontProvider = polluted
        try {
          expect(capture(imported)).toEqual(live)
        } finally {
          renderer.fontProvider = originalProvider
          polluted.delete()
        }

        // Changing the saved array must expire the proof, even while paragraph inputs match.
        imported.derivedTextGlyphs = imported.derivedTextGlyphs!.map((glyph, i) =>
          i === 0 ? { ...glyph, x: glyph.x + 3 } : glyph
        )
        expect(capture(imported)).toEqual(capture(imported, true))
        expect(capture(imported)).not.toEqual(live)
        // The glyph positions retain a centered layout; changing vertical alignment cannot
        // reuse the old proof against a newly top-aligned paragraph.
        const centered = imported.derivedTextGlyphs
        imported.derivedTextGlyphs = centered.map((glyph, i) =>
          i === 0 ? { ...glyph, x: glyph.x - 3 } : glyph
        )
        expect(capture(imported)).toEqual(live)
        imported.textAlignVertical = 'TOP'
        expect(capture(imported)).toEqual(capture(imported, true))
        imported.fontFamily = 'Missing saved-paragraph fixture font'
        expect(capture(imported)).toEqual(capture(imported, true))
      } finally {
        renderer.destroy()
      }
    },
    15000
  )
})
