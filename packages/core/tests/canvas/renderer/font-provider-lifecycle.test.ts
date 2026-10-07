import { expect, spyOn, test } from 'bun:test'

import { SkiaRenderer } from '#core/canvas/renderer'
import { initCanvasKit } from '#core/io'
import { fontManager } from '#core/text/fonts'

// Real CanvasKit providers and surfaces; isolate host font fetching from resource ownership.
test('reloading fonts detaches the replaced provider before renderer destruction', async () => {
  const ck = await initCanvasKit()
  const surface = ck.MakeSurface(1, 1)
  if (!surface) throw new Error('Cannot create isolated font lifecycle surface')
  const renderer = new SkiaRenderer(ck, surface)
  const load = spyOn(fontManager, 'loadFont').mockResolvedValue(null)
  let original: ReturnType<typeof renderer.getFontProvider> = null
  try {
    await renderer.loadFonts()
    original = renderer.getFontProvider()
    expect(original).not.toBeNull()
    await renderer.loadFonts()
    expect(original?.isDeleted()).toBe(true)
    expect(fontManager.providerFor(ck)).toBe(renderer.getFontProvider())
    renderer.destroy()
    expect(fontManager.providerFor(ck)).toBeNull()
  } finally {
    renderer.destroy()
    if (original) fontManager.detachProvider(original)
    load.mockRestore()
  }
})

test('destroying a renderer without a provider preserves another surface provider', async () => {
  const ck = await initCanvasKit()
  const firstSurface = ck.MakeSurface(1, 1)
  const secondSurface = ck.MakeSurface(1, 1)
  if (!firstSurface || !secondSurface) throw new Error('Cannot create isolated font surfaces')
  const loaded = new SkiaRenderer(ck, firstSurface)
  const unloaded = new SkiaRenderer(ck, secondSurface)
  const load = spyOn(fontManager, 'loadFont').mockResolvedValue(null)
  try {
    await loaded.loadFonts()
    const provider = loaded.getFontProvider()
    expect(provider).not.toBeNull()
    unloaded.destroy()
    expect(provider?.isDeleted()).toBe(false)
    expect(fontManager.providerFor(ck)).toBe(provider)
  } finally {
    unloaded.destroy()
    loaded.destroy()
    load.mockRestore()
  }
})
