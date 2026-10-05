import { beforeAll, expect, spyOn, test } from 'bun:test'

import type { FillType, PathBuilder } from 'canvaskit-wasm'

import { initCanvasKit } from '@open-pencil/core/io'
import type { VectorNetwork } from '@open-pencil/scene-graph'

import { geometryBlobToPath, vectorNetworkToPath } from '#core/vector'

let ck: Awaited<ReturnType<typeof initCanvasKit>>
beforeAll(async () => {
  ck = await initCanvasKit()
})

function triangleNetwork(): VectorNetwork {
  return {
    vertices: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 }
    ],
    segments: [
      [0, 1],
      [1, 2],
      [2, 0]
    ].map(([start, end]) => ({
      start,
      end,
      tangentStart: { x: 0, y: 0 },
      tangentEnd: { x: 0, y: 0 }
    })),
    regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2]] }]
  }
}

function rectangleBlob() {
  const commands = [
    [1, 0, 0],
    [2, 100, 0],
    [2, 100, 100],
    [2, 0, 100],
    [0],
    [1, 25, 25],
    [2, 75, 25],
    [2, 75, 75],
    [2, 25, 75],
    [0]
  ]
  const bytes = new Uint8Array(commands.reduce((n, c) => n + 1 + (c.length - 1) * 4, 0))
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (const [command, ...values] of commands) {
    bytes[offset++] = command
    for (const value of values) {
      view.setFloat32(offset, value, true)
      offset += 4
    }
  }
  return bytes
}

for (const source of ['glyph', 'vector-region'] as const) {
  test(`${source} releases the native copy returned by CanvasKit 0.41.1 setFillType`, () => {
    const copies: PathBuilder[] = []
    const original = ck.PathBuilder.prototype.setFillType
    const setter = spyOn(ck.PathBuilder.prototype, 'setFillType').mockImplementation(
      function (this: PathBuilder, fillType: FillType) {
        const result = Reflect.apply(original, this, [fillType]) as PathBuilder | undefined
        if (result && result !== this) copies.push(result)
        return result
      }
    )
    try {
      for (let i = 0; i < 200; i++) {
        const paths =
          source === 'glyph'
            ? [geometryBlobToPath(ck, rectangleBlob(), 'EVENODD')]
            : vectorNetworkToPath(ck, triangleNetwork())
        for (const path of paths) path.delete()
      }
      expect(copies).toHaveLength(200)
      expect(copies.filter((copy) => !copy.isDeleted())).toHaveLength(0)
    } finally {
      setter.mockRestore()
      for (const copy of copies) if (!copy.isDeleted()) copy.delete()
    }
  })
}

for (const windingRule of ['EVENODD', 'NONZERO'] as const) {
  test(`releasing the fill-type copy preserves ${windingRule} and recorded picture playback`, () => {
    const path = geometryBlobToPath(ck, rectangleBlob(), windingRule)
    const surface = ck.MakeSurface(120, 120)
    if (!surface) throw new Error('Expected surface')
    const paint = new ck.Paint()
    paint.setColor(ck.BLACK)
    const recorder = new ck.PictureRecorder()
    const canvas = recorder.beginRecording(ck.LTRBRect(0, 0, 100, 100))
    canvas.drawPath(path, paint)
    const picture = recorder.finishRecordingAsPicture()
    recorder.delete()
    try {
      expect(path.contains(10, 10)).toBe(true)
      expect(path.contains(50, 50)).toBe(windingRule === 'NONZERO')
      path.delete()
      paint.delete()
      const target = surface.getCanvas()
      for (let i = 0; i < 30; i++) {
        target.clear(ck.WHITE)
        target.save()
        target.scale(i % 2 ? 1 : 0.5, i % 2 ? 1 : 0.5)
        target.drawPicture(picture)
        target.restore()
        surface.flush()
      }
      const image = surface.makeImageSnapshot()
      try {
        const pixels = image.readPixels(50, 50, {
          width: 1,
          height: 1,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Unpremul,
          colorSpace: ck.ColorSpace.SRGB
        })
        expect(pixels?.[0]).toBe(windingRule === 'NONZERO' ? 0 : 255)
      } finally {
        image.delete()
      }
    } finally {
      if (!path.isDeleted()) path.delete()
      if (!paint.isDeleted()) paint.delete()
      picture.delete()
      surface.dispose()
    }
  })
}

for (const returns of ['void', 'self'] as const) {
  test(`a ${returns} fill-type binding does not delete the live builder`, () => {
    const original = ck.PathBuilder.prototype.setFillType
    const setter = spyOn(ck.PathBuilder.prototype, 'setFillType').mockImplementation(
      function (this: PathBuilder, fillType: FillType) {
        const copy = Reflect.apply(original, this, [fillType]) as PathBuilder | undefined
        if (copy && copy !== this) copy.delete()
        return returns === 'self' ? this : undefined
      }
    )
    try {
      const path = geometryBlobToPath(ck, rectangleBlob(), 'EVENODD')
      try {
        expect(path.contains(10, 10)).toBe(true)
      } finally {
        path.delete()
      }
    } finally {
      setter.mockRestore()
    }
  })
}

test('truncated geometry throws its original error and releases its builder', () => {
  const original = ck.PathBuilder.prototype.delete
  const deleted: PathBuilder[] = []
  const deletion = spyOn(ck.PathBuilder.prototype, 'delete').mockImplementation(
    function (this: PathBuilder) {
      deleted.push(this)
      return Reflect.apply(original, this, [])
    }
  )
  try {
    expect(() => geometryBlobToPath(ck, new Uint8Array([1, 0]), 'NONZERO')).toThrow(RangeError)
    expect(deleted).toHaveLength(1)
    expect(deleted[0].isDeleted()).toBe(true)
  } finally {
    deletion.mockRestore()
  }
})
