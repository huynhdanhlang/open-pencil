import { afterEach, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { exportFigInWorker } from '#core/io/formats/fig/isolated-export'

const original = globalThis.Worker
afterEach(() => {
  globalThis.Worker = original
})

test('isolated Save prepares text outside the worker and releases the heap', async () => {
  let terminated = 0
  let prepared = false
  let requestPrepared = false
  class OwnedWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminate() {
      terminated++
    }
    postMessage(value: { prepare?: boolean; type?: string }) {
      if (value.type === 'prepared') {
        queueMicrotask(() =>
          this.onmessage?.({ data: { ok: true, bytes: new Uint8Array([1, 2]) } } as MessageEvent)
        )
      } else {
        requestPrepared = value.prepare === true
        queueMicrotask(() =>
          this.onmessage?.({ data: { type: 'prepare', nodes: [], fontKeys: [] } } as MessageEvent)
        )
      }
    }
  }
  globalThis.Worker = OwnedWorker as unknown as typeof Worker
  const bytes = await exportFigInWorker(new SceneGraph(), undefined, {
    thumbnailPNG: new Uint8Array([9]),
    prepare: async () => {
      prepared = true
      return { shapedText: new Map(), fontDigests: new Map() }
    }
  })
  expect([...bytes]).toEqual([1, 2])
  expect(requestPrepared).toBe(true)
  expect(prepared).toBe(true)
  expect(terminated).toBe(1)
})

test('native Save releases its codec heap before invoking the Rust packer', async () => {
  let terminated = 0
  let nativePacking = false
  class OwnedWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminate() {
      terminated++
    }
    postMessage(value: { nativePacking?: boolean }) {
      nativePacking = value.nativePacking === true
      queueMicrotask(() =>
        this.onmessage?.({
          data: { type: 'pack', payload: new Uint8Array([3, 4]) }
        } as MessageEvent)
      )
    }
  }
  globalThis.Worker = OwnedWorker as unknown as typeof Worker
  const bytes = await exportFigInWorker(new SceneGraph(), undefined, {
    thumbnailPNG: new Uint8Array([9]),
    prepare: async () => ({ shapedText: new Map(), fontDigests: new Map() }),
    packNative: async (payload) => {
      expect(terminated).toBe(1)
      expect([...payload]).toEqual([3, 4])
      return new Uint8Array([7, 8])
    }
  })
  expect(nativePacking).toBe(true)
  expect([...bytes]).toEqual([7, 8])
  expect(terminated).toBe(1)
})

test('host preparation failure rejects Save and releases the worker', async () => {
  let terminated = 0
  class OwnedWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    terminate() {
      terminated++
    }
    postMessage() {
      queueMicrotask(() =>
        this.onmessage?.({ data: { type: 'prepare', nodes: [], fontKeys: [] } } as MessageEvent)
      )
    }
  }
  globalThis.Worker = OwnedWorker as unknown as typeof Worker
  await expect(
    exportFigInWorker(new SceneGraph(), undefined, {
      thumbnailPNG: new Uint8Array([9]),
      prepare: async () => {
        throw new Error('Owned font preparation failed')
      }
    })
  ).rejects.toThrow('Owned font preparation failed')
  expect(terminated).toBe(1)
})
