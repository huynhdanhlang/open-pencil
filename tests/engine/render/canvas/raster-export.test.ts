import { beforeAll, describe, expect, test } from 'bun:test'

import { renderNodesToImage, SceneGraph, SkiaRenderer } from '@open-pencil/core'
import { getWorldMatrix } from '@open-pencil/scene-graph'

import { initCanvasKit } from '#cli/headless'
import { ResourceCache } from '#core/cache/resource'
import { applyImageFill } from '#core/canvas/fills'
import { createGraphEventSubscription } from '#core/editor/graph-events'
import { prepareSelectionRenderGraph } from '#core/io/formats/raster/render'
import { extractExportGraph } from '#core/io/subgraph'

import { expectDefined } from '#tests/helpers/assert'

let ck: Awaited<ReturnType<typeof initCanvasKit>>

function rectangleCommandsBlob(x: number, y: number, width: number, height: number): Uint8Array {
  const blob = new Uint8Array(1 + 4 * 9 + 1)
  const view = new DataView(blob.buffer)
  const points = [
    { command: 1, x, y },
    { command: 2, x: x + width, y },
    { command: 2, x: x + width, y: y + height },
    { command: 2, x, y: y + height }
  ]
  let offset = 0
  for (const point of points) {
    blob[offset] = point.command
    view.setFloat32(offset + 1, point.x, true)
    view.setFloat32(offset + 5, point.y, true)
    offset += 9
  }
  blob[offset] = 0
  return blob
}

beforeAll(async () => {
  ck = await initCanvasKit()
})

describe('raster export', () => {
  test('eviction errors preserve ownership of the newly cached image', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, { width: 1, height: 1 })
    const surface = expectDefined(ck.MakeSurface(1, 1), 'surface')
    surface.getCanvas().clear(ck.Color(255, 0, 0, 1))
    const snapshot = surface.makeImageSnapshot()
    const bytes = expectDefined(snapshot.encodeToBytes(), 'png')
    snapshot.delete()
    graph.images.set('first', bytes)
    graph.images.set('second', bytes)
    const renderer = new SkiaRenderer(ck, surface)
    let fail = true
    renderer.imageCache = new ResourceCache({
      maxEntries: 1,
      dispose: (image) => {
        if (!image.isDeleted()) image.delete()
        if (fail) throw new Error('Eviction failed')
      }
    })
    const fill = {
      type: 'IMAGE' as const,
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true
    }
    try {
      applyImageFill(renderer, { ...fill, imageHash: 'first' }, node, graph)
      expect(() => applyImageFill(renderer, { ...fill, imageHash: 'second' }, node, graph)).toThrow(
        'ResourceCache cleanup failed'
      )
      expect(renderer.imageCache.get('second')?.isDeleted()).toBe(false)
      expect(applyImageFill(renderer, { ...fill, imageHash: 'second' }, node, graph)).toBe(true)
    } finally {
      fail = false
      renderer.destroy()
    }
  })

  test('uncacheable decoded images remain drawable and release their handles', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id, { width: 1, height: 1 })
    const surface = expectDefined(ck.MakeSurface(1, 1), 'surface')
    surface.getCanvas().clear(ck.Color(255, 0, 0, 1))
    const source = surface.makeImageSnapshot()
    graph.images.set('large', expectDefined(source.encodeToBytes(), 'png'))
    source.delete()
    const renderer = new SkiaRenderer(ck, surface)
    const rejected: NonNullable<ReturnType<typeof ck.MakeImageFromEncoded>>[] = []
    renderer.imageCache = new ResourceCache({
      maxWeight: 0,
      weight: (image) => {
        rejected.push(image)
        return 1
      },
      dispose: (image) => image.delete()
    })
    try {
      expect(
        applyImageFill(
          renderer,
          {
            type: 'IMAGE',
            imageHash: 'large',
            color: { r: 0, g: 0, b: 0, a: 1 },
            opacity: 1,
            visible: true
          },
          node,
          graph
        )
      ).toBe(true)
      expect(rejected.every((image) => image.isDeleted())).toBe(true)
      surface.getCanvas().drawRect(ck.XYWHRect(0, 0, 1, 1), renderer.fillPaint)
      const pixels = surface.getCanvas().readPixels(0, 0, {
        alphaType: ck.AlphaType.Unpremul,
        colorType: ck.ColorType.RGBA_8888,
        colorSpace: ck.ColorSpace.SRGB,
        width: 1,
        height: 1
      })
      expect(Array.from(expectDefined(pixels, 'pixels'))).toEqual([255, 0, 0, 255])
    } finally {
      for (const image of rejected) if (!image.isDeleted()) image.delete()
      renderer.destroy()
    }
  })

  test('decoded image cache evicts unused native images across many image fills', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, { width: 1, height: 1 })
    const surface = expectDefined(ck.MakeSurface(1, 1), 'surface')
    surface.getCanvas().clear(ck.Color(255, 0, 0, 1))
    const snapshot = surface.makeImageSnapshot()
    const bytes = expectDefined(snapshot.encodeToBytes(), 'encoded image')
    snapshot.delete()
    const renderer = new SkiaRenderer(ck, surface)
    let first: ReturnType<typeof ck.MakeImageFromEncoded> = null
    try {
      for (let index = 0; index < 257; index++) {
        const hash = `image-${index}`
        graph.images.set(hash, bytes)
        expect(
          applyImageFill(
            renderer,
            {
              type: 'IMAGE',
              imageHash: hash,
              color: { r: 0, g: 0, b: 0, a: 1 },
              opacity: 1,
              visible: true
            },
            node,
            graph
          )
        ).toBe(true)
        if (index === 0) first = renderer.imageCache.get(hash) ?? null
      }
      expect(renderer.imageCache.size).toBe(256)
      expect(first?.isDeleted()).toBe(true)
      // The paint owns its shader independently of the evicted image handles.
      surface.getCanvas().drawRect(ck.XYWHRect(0, 0, 1, 1), renderer.fillPaint)
      surface.flush()
      const pixels = surface.getCanvas().readPixels(0, 0, {
        alphaType: ck.AlphaType.Unpremul,
        colorType: ck.ColorType.RGBA_8888,
        colorSpace: ck.ColorSpace.SRGB,
        width: 1,
        height: 1
      })
      expect(Array.from(expectDefined(pixels, 'pixels'))).toEqual([255, 0, 0, 255])
    } finally {
      renderer.destroy()
    }
  })

  test('failed encoding releases all raster buffers and native snapshots', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, { width: 10, height: 10 })
    const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1), 'surface'))
    const malloc = ck.Malloc
    const free = ck.Free
    const makeSurface = ck.MakeRasterDirectSurface
    const allocations = new Set<ReturnType<typeof ck.Malloc>>()
    const snapshots: ReturnType<typeof renderer.surface.makeImageSnapshot>[] = []
    ck.Malloc = ((...args: Parameters<typeof malloc>) => {
      const allocation = malloc(...args)
      allocations.add(allocation)
      return allocation
    }) as typeof malloc
    ck.Free = (allocation) => {
      free(allocation)
      allocations.delete(allocation)
    }
    ck.MakeRasterDirectSurface = (...args) => {
      const surface = makeSurface(...args)
      if (surface) {
        const snapshot = surface.makeImageSnapshot.bind(surface)
        surface.makeImageSnapshot = (...snapshotArgs) => {
          const image = snapshot(...snapshotArgs)
          snapshots.push(image)
          image.encodeToBytes = () => {
            throw new Error('Encoding failed')
          }
          return image
        }
      }
      return surface
    }
    try {
      expect(() =>
        renderNodesToImage(ck, renderer, graph, page.id, [node.id], {
          scale: 1,
          format: 'PNG'
        })
      ).toThrow('Encoding failed')
      expect(allocations.size).toBe(0)
      expect(snapshots.every((image) => image.isDeleted())).toBe(true)
    } finally {
      for (const image of snapshots) if (!image.isDeleted()) image.delete()
      for (const allocation of allocations) free(allocation)
      ck.Malloc = malloc
      ck.Free = free
      ck.MakeRasterDirectSurface = makeSurface
      renderer.destroy()
    }
  })

  test('rejects unsafe raster dimensions before allocating WASM memory', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, { width: 4096, height: 4097 })
    const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1), 'surface'))
    const malloc = ck.Malloc
    let allocated = false
    ck.Malloc = (() => {
      allocated = true
      throw new Error('Unexpected allocation')
    }) as typeof malloc
    try {
      for (const scale of [1, Infinity, NaN]) {
        expect(() =>
          renderNodesToImage(ck, renderer, graph, page.id, [node.id], {
            scale,
            format: 'PNG'
          })
        ).toThrow('Raster export exceeds the safe allocation limit')
      }
      expect(allocated).toBe(false)
    } finally {
      ck.Malloc = malloc
      renderer.destroy()
    }
  })

  test('deleting a subtree releases its real cached native geometry', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const parent = graph.createNode('FRAME', page.id)
    const child = graph.createNode('VECTOR', parent.id)
    const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1), 'surface'))
    const subscription = createGraphEventSubscription({
      getGraph: () => graph,
      getRenderers: () => [renderer],
      scheduleComponentSync: () => undefined,
      requestRender: () => undefined,
      emitEditorEvent: () => undefined
    })
    subscription.subscribeToGraph()
    const paths = Array.from({ length: 5 }, () => new ck.Path())
    renderer.vectorPathCache.set(child.id, [paths[0]])
    renderer.vectorStrokePathCache.set(child.id, [paths[1]])
    renderer.vectorStrokeOutlineCache.set(`${child.id}|stroke`, [paths[2]])
    renderer.fillGeometryCache.set(child.id, [paths[3]])
    renderer.strokeGeometryCache.set(child.id, [paths[4]])
    try {
      graph.deleteNode(parent.id)
      expect(paths.every((path) => path.isDeleted())).toBe(true)
      expect(
        renderer.vectorPathCache.size +
          renderer.vectorStrokePathCache.size +
          renderer.vectorStrokeOutlineCache.size +
          renderer.fillGeometryCache.size +
          renderer.strokeGeometryCache.size
      ).toBe(0)
    } finally {
      subscription.unsubscribeFromGraph()
      renderer.destroy()
    }
  })

  test('preserves transformed top-level nodes when preparing a page export', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const connector = graph.createNode('FRAME', page.id, {
      x: 120,
      y: 80,
      width: 40,
      height: 20,
      rotation: 90,
      flipX: true,
      fills: []
    })
    const before = getWorldMatrix(connector, graph)

    const extracted = extractExportGraph(graph, { scope: 'selection', nodeIds: page.childIds })
    const exportPageId = expectDefined(extracted.pageId, 'export page')
    prepareSelectionRenderGraph(graph, extracted.graph, exportPageId, page.childIds)

    const exportedConnector = expectDefined(extracted.graph.getNode(connector.id), 'connector')
    expect(getWorldMatrix(exportedConnector, extracted.graph)).toEqual(before)
  })

  test('preserves the world transform when flattening a nested export selection', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const parent = graph.createNode('FRAME', page.id, {
      x: 200,
      y: 100,
      width: 100,
      height: 80,
      rotation: -90,
      flipX: true,
      fills: []
    })
    const connector = graph.createNode('FRAME', parent.id, {
      x: 15,
      y: 25,
      width: 40,
      height: 20,
      rotation: 90,
      flipX: true,
      fills: []
    })
    const before = getWorldMatrix(connector, graph)
    const extracted = extractExportGraph(graph, {
      scope: 'selection',
      nodeIds: [connector.id]
    })
    const exportPageId = expectDefined(extracted.pageId, 'export page')
    prepareSelectionRenderGraph(graph, extracted.graph, exportPageId, [connector.id])

    const exportedConnector = expectDefined(extracted.graph.getNode(connector.id), 'connector')
    const after = getWorldMatrix(exportedConnector, extracted.graph)
    for (let index = 0; index < before.length; index++) {
      expect(after[index]).toBeCloseTo(before[index], 8)
    }
  })

  test('selection export excludes ancestor backgrounds', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const section = graph.createNode('SECTION', page.id, {
      x: 20,
      y: 30,
      width: 100,
      height: 100,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.4, g: 0.4, b: 0.4, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const component = graph.createNode('COMPONENT', section.id, {
      x: 10,
      y: 10,
      width: 10,
      height: 10,
      fills: []
    })
    graph.createNode('RECTANGLE', component.id, {
      x: 3,
      y: 3,
      width: 4,
      height: 4,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })

    const surface = expectDefined(ck.MakeSurface(1, 1), 'surface')
    const renderer = new SkiaRenderer(ck, surface)

    try {
      const png = expectDefined(
        renderNodesToImage(ck, renderer, graph, page.id, [component.id], {
          scale: 1,
          format: 'PNG'
        }),
        'png'
      )
      const image = expectDefined(ck.MakeImageFromEncoded(png), 'image')
      const pixels = expectDefined(
        image.readPixels(0, 0, {
          alphaType: ck.AlphaType.Unpremul,
          colorType: ck.ColorType.RGBA_8888,
          colorSpace: ck.ColorSpace.SRGB,
          width: image.width(),
          height: image.height()
        }),
        'pixels'
      )

      expect(pixels[3]).toBe(0)
      const centerAlpha = pixels[(5 * image.width() + 5) * 4 + 3]
      expect(centerAlpha).toBeGreaterThan(0)

      image.delete()
    } finally {
      surface.delete()
    }
  })

  test('keeps one-pixel transparent fringes when trimming exports', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const vector = graph.createNode('VECTOR', page.id, {
      width: 10,
      height: 10,
      fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: rectangleCommandsBlob(1, 1, 8, 8) }],
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })

    const surface = expectDefined(ck.MakeSurface(1, 1), 'surface')
    const renderer = new SkiaRenderer(ck, surface)

    try {
      const png = expectDefined(
        renderNodesToImage(ck, renderer, graph, page.id, [vector.id], {
          scale: 1,
          format: 'PNG',
          trimTransparent: true
        }),
        'png'
      )
      const image = expectDefined(ck.MakeImageFromEncoded(png), 'image')

      expect(image.width()).toBe(10)
      expect(image.height()).toBe(10)

      image.delete()
    } finally {
      surface.delete()
    }
  })

  test('page exports can trim transparent text padding', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, {
      x: 0,
      y: 0,
      width: 120,
      height: 40,
      text: 'Primitives',
      fontSize: 30,
      lineHeight: 40,
      fills: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })

    const surface = expectDefined(ck.MakeSurface(1, 1), 'surface')
    const renderer = new SkiaRenderer(ck, surface)
    await renderer.loadFonts()

    try {
      const untrimmed = expectDefined(
        renderNodesToImage(ck, renderer, graph, page.id, [text.id], {
          scale: 1,
          format: 'PNG'
        }),
        'untrimmed png'
      )
      const trimmed = expectDefined(
        renderNodesToImage(ck, renderer, graph, page.id, [text.id], {
          scale: 1,
          format: 'PNG',
          trimTransparent: true
        }),
        'trimmed png'
      )

      const untrimmedImage = expectDefined(ck.MakeImageFromEncoded(untrimmed), 'untrimmed image')
      const trimmedImage = expectDefined(ck.MakeImageFromEncoded(trimmed), 'trimmed image')

      expect(untrimmedImage.height()).toBe(40)
      expect(trimmedImage.height()).toBeLessThan(untrimmedImage.height())
      expect(trimmedImage.width()).toBeLessThan(untrimmedImage.width())

      untrimmedImage.delete()
      trimmedImage.delete()
    } finally {
      surface.delete()
    }
  })
})
