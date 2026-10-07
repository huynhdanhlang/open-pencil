import { expect, test } from 'bun:test'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { initCanvasKit } from '@open-pencil/core/io'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { recordRuntimeError } from '@/app/diagnostics'
import { createEditorStore } from '@/app/editor/session/create'

test('runtime diagnostics include scene surfaces even when overlays registered last', async () => {
  const ck = await initCanvasKit()
  const store = createEditorStore()
  const sceneSurface = ck.MakeSurface(1, 1)
  const overlaySurface = ck.MakeSurface(1, 1)
  if (!sceneSurface || !overlaySurface) throw new Error('Cannot create diagnostic surfaces')
  const scene = new SkiaRenderer(ck, sceneSurface)
  const overlay = new SkiaRenderer(ck, overlaySurface)
  overlay.tracksSceneSettlement = false
  store.setCanvasKit(ck, scene)
  store.setCanvasKit(ck, overlay)
  try {
    expect(store.renderer).toBe(overlay)
    const status = makeFigmaFromStore(store).getRuntimeStatus()
    expect(status.rendererScope).toBe('registered-surfaces')
    expect(status.renderers.map((surface) => surface.layer)).toEqual(['scene', 'overlays'])
    // A separate tiny module traps on a read beyond its one memory page. Never poison CanvasKit.
    const trapModule = new WebAssembly.Module(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 8, 1, 4, 116,
        114, 97, 112, 0, 0, 10, 12, 1, 10, 0, 65, 128, 128, 4, 40, 2, 0, 26, 11
      ])
    )
    const trap = new WebAssembly.Instance(trapModule).exports.trap
    if (typeof trap !== 'function') throw new Error('Missing bounded WASM trap')
    try {
      trap()
    } catch (error) {
      recordRuntimeError(error, 'window')
    }
    const diagnostic = makeFigmaFromStore(store).getRuntimeStatus().diagnostics
    expect(diagnostic?.scope).toBe('shared-diagnostics')
    expect(diagnostic?.wasmFailures[0]?.kind).toBe('out-of-bounds')
    expect(diagnostic?.wasmFailures[0]?.stack).toContain('runtime-status.test.ts')
  } finally {
    store.dispose()
    scene.destroy()
    overlay.destroy()
  }
})
