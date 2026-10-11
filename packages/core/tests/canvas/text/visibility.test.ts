import { beforeAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { encodePathCommandsBlob } from '@open-pencil/fig/node-change'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { SkiaRenderer } from '#core/canvas/renderer'
import { renderText } from '#core/canvas/scene'
import { withFigExportRuntime } from '#core/canvas/text/shape'
import { getCanvasKit } from '#core/canvaskit'
import {
  emojiPresentationSegments,
  fontFallbackScriptForCharacter,
  textNeededFallbackScripts
} from '#core/text/coverage'
import { fontManager } from '#core/text/fonts'

beforeAll(async () => {
  fontManager.markLoaded(
    'Inter',
    'Regular',
    expectDefined(await fontManager.fetchBundledFont('/Inter-Regular.ttf'), 'Inter')
  )
})

async function raster(
  props: Partial<SceneNode>,
  route: 'live' | 'saved' | 'derived' = 'live',
  clipAncestor = false
) {
  const ck = await getCanvasKit()
  const surface = expectDefined(ck.MakeSurface(420, 160), 'surface')
  const renderer = new SkiaRenderer(ck, surface)
  renderer.fontProvider = ck.TypefaceFontProvider.Make()
  fontManager.attachProvider(ck, renderer.fontProvider)
  renderer.fontsLoaded = true
  const graph = new SceneGraph()
  const node = graph.createNode('TEXT', graph.getPages()[0].id, {
    fontFamily: 'Inter',
    fontSize: 24,
    width: 240,
    height: 32,
    textAutoResize: 'NONE',
    ...props
  })
  try {
    if (route !== 'live') {
      const shaped = expectDefined(
        await withFigExportRuntime(graph, ck, async (runtime) => runtime.shapeText(node)),
        'saved glyphs'
      )
      node.derivedTextGlyphs = shaped.glyphs.map((glyph) => ({
        x: glyph.x,
        y: glyph.y,
        fontSize: glyph.fontSize,
        firstCharacter: glyph.firstCharacter,
        commandsBlob: encodePathCommandsBlob(
          expectDefined(glyph.commands, 'outline'),
          glyph.fontSize
        )
      }))
      if (route === 'derived') renderer.fontsLoaded = false
    }
    renderer.fillPaint.setColor(ck.BLACK)
    const canvas = surface.getCanvas()
    canvas.clear(ck.WHITE)
    if (clipAncestor) canvas.clipRect(ck.LTRBRect(80, 20, 320, 52), ck.ClipOp.Intersect, false)
    canvas.translate(80, 20)
    renderText(renderer, canvas, node)
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      const pixels = expectDefined(
        image.readPixels(0, 0, {
          width: 420,
          height: 160,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        }),
        'pixels'
      )
      return (left: number, top: number, right: number, bottom: number) => {
        let ink = 0
        for (let y = top; y < bottom; y++) {
          for (let x = left; x < right; x++) {
            if (pixels[(y * 420 + x) * 4] < 200) ink++
          }
        }
        return ink
      }
    } finally {
      image.delete()
    }
  } finally {
    renderer.destroy()
  }
}

test('retains readable text when one glyph has no fallback candidate', async () => {
  const ink = await raster({ text: 'Tiếng Việt \u0378 vẫn còn' })
  expect(ink(80, 20, 320, 52)).toBeGreaterThan(100)
})

for (const route of ['live', 'saved', 'derived'] as const) {
  for (const textDirection of ['LTR', 'RTL'] as const) {
    test(`${route} ${textDirection} keeps hanging markers but clips body overflow vertically`, async () => {
      const ink = await raster(
        {
          text: 'First\nSecond\nThird',
          hangingList: true,
          textDirection,
          textAlignHorizontal: 'LEFT',
          textParagraphs: Array.from({ length: 3 }, () => ({
            listType: 'ORDERED' as const,
            indentation: 1
          }))
        },
        route
      )
      expect(textDirection === 'RTL' ? ink(320, 20, 400, 52) : ink(20, 20, 80, 52)).toBeGreaterThan(
        20
      )
      expect(ink(80, 20, 320, 52)).toBeGreaterThan(100)
      expect(ink(0, 52, 420, 160)).toBe(0)
    })
  }
}

for (const listType of ['ORDERED', 'UNORDERED'] as const) {
  for (const textAutoResize of ['NONE', 'TRUNCATE'] as const) {
    test(`${textAutoResize} preserves ${listType} markers with a larger first-character style`, async () => {
      const ink = await raster({
        text: 'First\nSecond\nThird',
        height: 60,
        hangingList: true,
        textAutoResize,
        styleRuns: [{ start: 0, length: 1, style: { fontSize: 40 } }],
        textParagraphs: Array.from({ length: 3 }, () => ({ listType, indentation: 1 }))
      })
      expect(ink(20, 20, 80, 80)).toBeGreaterThan(20)
      expect(ink(0, 80, 420, 160)).toBe(0)
    })
  }
}

test('hanging markers continue to respect an ancestor clip', async () => {
  const ink = await raster(
    {
      text: 'First',
      hangingList: true,
      textParagraphs: [{ listType: 'ORDERED', indentation: 1 }]
    },
    'live',
    true
  )
  expect(ink(20, 20, 80, 52)).toBe(0)
  expect(ink(80, 20, 320, 52)).toBeGreaterThan(100)
})

test('classifies pictographs, flags and keycap marks for explicit emoji fallback', () => {
  for (const character of ['🎬', '👩', '🏽', '🇻', '\u20e3']) {
    expect(fontFallbackScriptForCharacter(character)).toBe('emoji')
  }
  expect(fontFallbackScriptForCharacter('1')).toBeNull()
})

test('requests emoji presentation for a covered symbol only with its variation selector', () => {
  const graph = new SceneGraph()
  const node = graph.createNode('TEXT', graph.getPages()[0].id, {
    text: '© ™',
    fontFamily: 'Inter'
  })
  expect(textNeededFallbackScripts(node)).not.toContain('emoji')
  graph.updateNode(node.id, { text: '©️ ™️' })
  expect(textNeededFallbackScripts(node)).toContain('emoji')
  expect(emojiPresentationSegments('😀︎ · 🎬️').map(({ segment }) => segment)).toEqual(['🎬️'])
})
