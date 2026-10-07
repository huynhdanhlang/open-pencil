import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { initCanvasKit } from '@open-pencil/core/io/formats/raster'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import { SceneGraph } from '@open-pencil/scene-graph'

test('runtime diagnostics distinguish unavailable renderer from zero native resources without changing content', () => {
  const graph = new SceneGraph()
  graph.images.set('private-image', new Uint8Array([1, 2, 3]))
  graph.createNode('TEXT', graph.getPages()[0].id, { text: 'private content' })
  const tool = ALL_TOOLS.find((entry) => entry.name === 'get_runtime_status')
  expect(tool).toBeDefined()
  const result = expectDefined(tool).execute(new FigmaAPI(graph), {})
  expect(result).toMatchObject({
    document: { nodes: 3, images: 1, encodedImageBytes: 3 },
    renderer: null,
    history: null,
    persistence: null
  })
  expect(JSON.stringify(result)).not.toContain('private')
  expect(graph.nodes.size).toBe(3)
})

test('runtime persistence counters read the current owner without retaining or exposing FIG payloads', () => {
  const api = new FigmaAPI(new SceneGraph())
  let writingBytes = 81_000_000
  api.runtimePersistence = () => ({
    contentRevision: 2,
    dirty: true,
    memoryFallback: false,
    recoveryMemory: { scope: 'shared-recovery-store', snapshots: 0, bytes: 0 },
    recovery: {
      builds: 1,
      writes: 0,
      building: false,
      writingBytes,
      lastBuiltBytes: 81_000_000,
      failures: 0,
      persistedVersion: null,
      pendingRevision: true
    }
  })
  expect(api.getRuntimeStatus().persistence?.recovery.writingBytes).toBe(81_000_000)
  writingBytes = 0
  expect(api.getRuntimeStatus().persistence?.recovery.writingBytes).toBe(0)
  expect(Object.keys(api.getRuntimeStatus().persistence!.recovery)).not.toContain('figBytes')
})

test('runtime diagnostics report retained native paths and their release without clearing them', async () => {
  const ck = await initCanvasKit()
  const surface = expectDefined(ck.MakeSurface(8, 8))
  const renderer = new SkiaRenderer(ck, surface)
  const api = new FigmaAPI(new SceneGraph())
  api.setRenderer(renderer)
  const tool = expectDefined(ALL_TOOLS.find((entry) => entry.name === 'get_runtime_status'))
  const path = new ck.Path()
  renderer.vectorPathCache.set('owned', [path])
  try {
    const result = tool.execute(api, {}) as {
      renderer: { wasmHeapCapacityBytes: number; paths: number }
    }
    expect(result.renderer.wasmHeapCapacityBytes).toBeGreaterThan(0)
    expect(result.renderer.paths).toBe(1)
    expect(path.isDeleted()).toBe(false)
    renderer.invalidateVectorPath('owned')
    expect(tool.execute(api, {})).toMatchObject({ renderer: { paths: 0 } })
    expect(path.isDeleted()).toBe(true)
  } finally {
    renderer.destroy()
  }
})
