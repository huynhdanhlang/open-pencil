import { expect, test } from 'bun:test'

import { initCanvasKit } from '@open-pencil/core/io'

test('pinned CanvasKit public Gr cache getters return native numeric readings', async () => {
  const ck = await initCanvasKit()
  const ctor: unknown = Reflect.get(ck, 'GrDirectContext')
  if (typeof ctor !== 'function') throw new Error('Missing pinned GrDirectContext binding')
  const prototype = Reflect.get(ctor, 'prototype')
  for (const [name, nativeName, bytes] of [
    ['getResourceCacheUsageBytes', '_getResourceCacheUsageBytes', 8_388_608],
    ['getResourceCacheLimitBytes', '_getResourceCacheLimitBytes', 268_435_456]
  ] as const) {
    const getter: unknown = Reflect.get(prototype, name)
    if (typeof getter !== 'function') throw new Error(`Missing pinned getter ${name}`)
    let reads = 0
    // Context handle zero avoids WebGL; the real wrapper must return the native reading.
    const context = new Proxy({}, { get: (_, key) => key === nativeName
      ? () => { reads++; return bytes } : 0 })
    expect(Reflect.apply(getter, context, [])).toBe(bytes)
    expect(reads).toBe(1)
  }
})
