import { expect, test } from 'bun:test'

import { createMemoryRecoveryStore } from '@/app/document/recovery/memory'
import { createResilientRecoveryStore } from '@/app/document/recovery/store'

test('a failed write does not preload durable archives into the memory fallback', async () => {
  const durable = createMemoryRecoveryStore()
  await durable.write({
    id: 'old-one',
    documentName: 'Draft',
    sceneVersion: 1,
    figBytes: new Uint8Array(1024)
  })
  await durable.write({
    id: 'old-two',
    documentName: 'Draft',
    sceneVersion: 2,
    figBytes: new Uint8Array(2048)
  })
  let reads = 0
  const store = createResilientRecoveryStore({
    ...durable,
    read: async (id) => {
      reads++
      return durable.read(id)
    },
    write: async () => {
      throw new Error('owned quota failure')
    }
  })
  await store.write({
    id: 'current',
    documentName: 'Draft',
    sceneVersion: 3,
    figBytes: new Uint8Array(4096)
  })
  expect(reads).toBe(0)
  expect(store.getMemoryUsage?.()).toEqual({ snapshots: 1, bytes: 4096 })
  expect((await store.list()).map((row) => row.id).sort()).toEqual([
    'current',
    'old-one',
    'old-two'
  ])
  expect(reads).toBe(0)
  expect((await store.read('old-two'))?.figBytes.byteLength).toBe(2048)
  expect(reads).toBe(1)
  expect((await store.read('current'))?.figBytes.byteLength).toBe(4096)
  expect(reads).toBe(1)
  await store.remove('old-one')
  expect((await store.list()).map((row) => row.id).sort()).toEqual(['current', 'old-two'])
  expect((await durable.list()).map((row) => row.id)).toEqual(['old-two'])
})

test('fallback overlay preserves the latest draft and reports unavailable durable reads', async () => {
  const durable = createMemoryRecoveryStore()
  await durable.write({
    id: 'same',
    documentName: 'Old',
    sceneVersion: 1,
    figBytes: new Uint8Array([1])
  })
  const store = createResilientRecoveryStore({
    ...durable,
    read: async () => {
      throw new Error('owned unavailable read')
    },
    write: async () => {
      throw new Error('owned quota failure')
    }
  })
  await store.write({
    id: 'same',
    documentName: 'New',
    sceneVersion: 2,
    figBytes: new Uint8Array([2])
  })
  expect(await store.list()).toHaveLength(1)
  expect((await store.read('same'))?.figBytes).toEqual(new Uint8Array([2]))
  await expect(store.read('other')).rejects.toThrow('owned unavailable read')
  expect((await durable.read('same'))?.figBytes).toEqual(new Uint8Array([1]))
})

test('failed durable deletion preserves both the durable entry and its newer memory draft', async () => {
  const durable = createMemoryRecoveryStore()
  await durable.write({
    id: 'same',
    documentName: 'Old',
    sceneVersion: 1,
    figBytes: new Uint8Array([1])
  })
  let unavailable = true
  const store = createResilientRecoveryStore({
    ...durable,
    write: async () => {
      throw new Error('owned quota failure')
    },
    remove: async (id) => {
      if (unavailable) throw new Error('owned unavailable delete')
      return durable.remove(id)
    }
  })
  await store.write({
    id: 'same',
    documentName: 'New',
    sceneVersion: 2,
    figBytes: new Uint8Array([2])
  })
  await expect(store.remove('same')).rejects.toThrow('owned unavailable delete')
  expect((await store.read('same'))?.figBytes).toEqual(new Uint8Array([2]))
  expect((await durable.read('same'))?.figBytes).toEqual(new Uint8Array([1]))
  unavailable = false
  await store.remove('same')
  expect(await store.read('same')).toBeNull()
  expect(await store.list()).toEqual([])
})

test('unavailable durable metadata is reported instead of an authoritative empty bank', async () => {
  const memory = createMemoryRecoveryStore()
  const store = createResilientRecoveryStore({
    ...memory,
    list: async () => {
      throw new Error('owned unavailable index')
    },
    write: async () => {
      throw new Error('owned quota failure')
    }
  })
  await store.write({
    id: 'current',
    documentName: 'New',
    sceneVersion: 2,
    figBytes: new Uint8Array([2])
  })
  await expect(store.list()).rejects.toThrow('owned unavailable index')
  expect((await store.read('current'))?.figBytes).toEqual(new Uint8Array([2]))
})
