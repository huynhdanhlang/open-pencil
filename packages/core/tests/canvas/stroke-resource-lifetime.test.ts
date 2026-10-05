import { beforeAll, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import type { Path, PathEffect } from 'canvaskit-wasm'

import { initCanvasKit } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

import { SkiaRenderer } from '#core/canvas/renderer'
import { renderShapeUncached } from '#core/canvas/scene'
import { drawDashedRRectWithSolidCorners, drawStyledRRectStroke } from '#core/canvas/strokes'

let ck: Awaited<ReturnType<typeof initCanvasKit>>
beforeAll(async () => {
  ck = await initCanvasKit()
})

const color = { r: 0, g: 0, b: 0, a: 1 }
const stroke = {
  type: 'SOLID' as const,
  color,
  weight: 2,
  opacity: 1,
  visible: true,
  align: 'CENTER' as const
}

test('uncached vector redraw releases every native stroke outline', () => {
  const graph = new SceneGraph()
  const node = graph.createNode('VECTOR', graph.getPages()[0].id, {
    width: 24,
    height: 24,
    fills: [],
    strokes: [stroke]
  })
  const surface = expectDefined(ck.MakeSurface(32, 32), 'surface')
  const renderer = new SkiaRenderer(ck, surface)
  const path = expectDefined(ck.Path.MakeFromSVGString('M2 2 L22 22'), 'vector path')
  const outlines: Path[] = []
  const makeStroked = path.makeStroked.bind(path)
  path.makeStroked = (options) => {
    const outline = makeStroked(options)
    if (outline) outlines.push(outline)
    return outline
  }
  renderer.getVectorPaths = () => [path]
  try {
    for (let i = 0; i < 200; i++) renderShapeUncached(renderer, surface.getCanvas(), node, graph)
    expect(outlines).toHaveLength(200)
    expect(outlines.filter((outline) => !outline.isDeleted())).toHaveLength(0)
  } finally {
    for (const outline of outlines) if (!outline.isDeleted()) outline.delete()
    path.delete()
    renderer.destroy()
  }
})

test('regular, styled and solid-corner dashed strokes release native effects after drawing', () => {
  const graph = new SceneGraph()
  const dashed = { ...stroke, dashPattern: [4, 2] }
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
    width: 24,
    height: 24,
    fills: [],
    strokes: [dashed]
  })
  const surface = expectDefined(ck.MakeSurface(32, 32), 'surface')
  const renderer = new SkiaRenderer(ck, surface)
  const effects: PathEffect[] = []
  const makeDash = ck.PathEffect.MakeDash.bind(ck.PathEffect)
  ck.PathEffect.MakeDash = (...args) => {
    const effect = makeDash(...args)
    effects.push(effect)
    return effect
  }
  try {
    const canvas = surface.getCanvas()
    const rect = renderer.makeRRect(node)
    for (let i = 0; i < 200; i++) {
      renderShapeUncached(renderer, canvas, node, graph)
      drawStyledRRectStroke(renderer, canvas, rect, node, dashed, color)
      drawDashedRRectWithSolidCorners(renderer, canvas, node, dashed, color, 4)
    }
    expect(effects).toHaveLength(600)
    expect(effects.filter((effect) => !effect.isDeleted())).toHaveLength(0)
  } finally {
    ck.PathEffect.MakeDash = makeDash
    for (const effect of effects) if (!effect.isDeleted()) effect.delete()
    renderer.destroy()
  }
})
