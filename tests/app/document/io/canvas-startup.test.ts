import { expect, spyOn, test } from 'bun:test'
import type { CanvasKit } from 'canvaskit-wasm'
import { effectScope, nextTick, shallowRef } from 'vue'

import * as kit from '@open-pencil/core/canvaskit'

import { useCanvasKitLoader } from '../../../../packages/vue/src/canvas/surface/kit-loader'

test('canvas startup does not wait for display frames and respects disposal', async () => {
  const originalFrame = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback)
    return frameId
  }
  globalThis.cancelAnimationFrame = (id) => frames.delete(id)
  const canvasKit = spyOn(kit, 'getCanvasKit').mockResolvedValue({} as CanvasKit)
  const scopes: ReturnType<typeof effectScope>[] = []
  try {
    for (const dispose of [false, true]) {
      const scope = effectScope()
      scopes.push(scope)
      const lifecycle = { destroyed: false }
      let surfaces = 0
      let ready = false
      scope.run(() =>
        useCanvasKitLoader({
          canvasRef: shallowRef({} as HTMLCanvasElement),
          lifecycle,
          setCanvasKit() {},
          createSurface: () => surfaces++,
          loadFonts: () => Promise.resolve(),
          renderNow() {},
          onReady: () => {
            ready = true
          }
        })
      )
      await nextTick()
      if (dispose) scope.stop()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(surfaces).toBe(dispose ? 0 : 1)
      expect(ready).toBe(!dispose)
      expect(lifecycle.destroyed).toBe(dispose)
      scope.stop()
    }
  } finally {
    for (const scope of scopes) scope.stop()
    for (const callback of frames.values()) callback(0)
    await Promise.resolve()
    canvasKit.mockRestore()
    globalThis.requestAnimationFrame = originalFrame
    globalThis.cancelAnimationFrame = originalCancel
  }
})
