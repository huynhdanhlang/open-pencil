import { expect, test } from 'bun:test'

import { getCanvasKit } from '#core/canvaskit'

test('failed CanvasKit startup is reported and can be retried', async () => {
  const failure = new Error('WASM location unavailable')
  await expect(
    getCanvasKit({
      locateFile: () => {
        throw failure
      }
    })
  ).rejects.toBe(failure)
})

test('concurrent canvas startup shares one real CanvasKit module and WASM heap', async () => {
  const [scene, overlay, preview] = await Promise.all([
    getCanvasKit(),
    getCanvasKit(),
    getCanvasKit()
  ])

  expect(overlay).toBe(scene)
  expect(preview).toBe(scene)
  expect(overlay.HEAPU8.buffer).toBe(scene.HEAPU8.buffer)
  expect(await getCanvasKit()).toBe(scene)

  const surface = scene.MakeSurface(32, 32)
  expect(surface).not.toBeNull()
  try {
    surface!.getCanvas().clear(scene.RED)
    surface!.flush()
    const image = surface!.makeImageSnapshot()
    try {
      expect(image.encodeToBytes()).not.toBeNull()
    } finally {
      image.delete()
    }
  } finally {
    surface?.delete()
  }
})
