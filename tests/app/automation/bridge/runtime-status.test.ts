import { expect, test } from 'bun:test'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { initCanvasKit } from '@open-pencil/core/io'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
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
  } finally {
    store.dispose()
    scene.destroy()
    overlay.destroy()
  }
})
