import { beforeAll, expect, mock, test } from 'bun:test'

import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { initCanvasKit } from '@open-pencil/core/io'

let ck: CanvasKit
beforeAll(async () => {
  ck = await initCanvasKit()
})

function makeRenderer() {
  const surface = ck.MakeSurface(1, 1)
  if (!surface) throw new Error('Cannot create diagnostic surface')
  return new SkiaRenderer(ck, surface)
}

test('software surfaces report unavailable GPU cache bytes explicitly', () => {
  const renderer = makeRenderer()
  try {
    expect(renderer.getResourceUsage()).toMatchObject({
      gpuResourceCacheBytes: null,
      gpuResourceCacheLimitBytes: null
    })
  } finally {
    renderer.destroy()
  }
})

test('heap diagnostics identify the owning module across surfaces', async () => {
  const scene = makeRenderer()
  const overlay = makeRenderer()
  const otherKit = await CanvasKitInit({
    locateFile: (file) =>
      decodeURIComponent(new URL(file, import.meta.resolve('canvaskit-wasm')).pathname)
  })
  const otherSurface = otherKit.MakeSurface(1, 1)
  if (!otherSurface) throw new Error('Cannot create independent diagnostic surface')
  const independent = new SkiaRenderer(otherKit, otherSurface)
  try {
    const sceneUsage = scene.getResourceUsage()
    const overlayUsage = overlay.getResourceUsage()
    expect(sceneUsage.wasmModuleId).toBeGreaterThan(0)
    expect(overlayUsage.wasmModuleId).toBe(sceneUsage.wasmModuleId)
    expect(overlayUsage.wasmHeapCapacityBytes).toBe(sceneUsage.wasmHeapCapacityBytes)
    expect(independent.getResourceUsage().wasmModuleId).not.toBe(sceneUsage.wasmModuleId)
  } finally {
    scene.destroy()
    overlay.destroy()
    independent.destroy()
  }
})

test('diagnostics read the borrowed Gr context without changing its lifetime', () => {
  const renderer = makeRenderer()
  const context = {
    getResourceCacheUsageBytes: mock(() => 8_388_608),
    getResourceCacheLimitBytes: mock(() => 268_435_456),
    delete: mock(() => undefined)
  }
  renderer.resourceCacheContext = context
  try {
    expect(renderer.getResourceUsage()).toMatchObject({
      gpuResourceCacheBytes: 8_388_608,
      gpuResourceCacheLimitBytes: 268_435_456
    })
    expect(context.getResourceCacheUsageBytes).toHaveBeenCalledTimes(1)
    renderer.destroy()
    expect(renderer.resourceCacheContext).toBeNull()
    expect(context.delete).not.toHaveBeenCalled()
  } finally {
    renderer.destroy()
  }
})
