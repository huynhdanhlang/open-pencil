import { expect, spyOn, test } from 'bun:test'

import { createDocumentSourceState } from '@/app/document/io/source-state'
import { createDocumentWriter } from '@/app/document/io/write'
import { createDeferred } from '@/app/runtime/deferred'

import { asDouble } from '#tests/helpers/doubles'

test('a slow completed write refreshes its own-event suppression time before cleanup', async () => {
  let time = 1000
  const clock = spyOn(Date, 'now').mockImplementation(() => time)
  const pending = createDeferred<void>()
  const writable = asDouble<FileSystemWritableFileStream>({
    write: () => pending.promise,
    close: async () => undefined
  })
  const handle = asDouble<FileSystemFileHandle>({ createWritable: async () => writable })
  let lastWrite = 0
  let savedVersion = 0
  const source = createDocumentSourceState()
  const write = createDocumentWriter({
    state: { documentName: 'Owned' },
    getFilePath: () => null,
    getFileHandle: () => handle,
    getStorageBinding: () => null,
    beginWrite: source.beginWrite,
    setSavedVersion: (version) => {
      savedVersion = version
    },
    setLastWriteTime: (value) => {
      lastWrite = value
    },
    onWriteSuccess: () => {
      expect(lastWrite).toBe(4000)
      expect(source.isWriting()).toBe(false)
    }
  })
  try {
    const result = write(new Uint8Array([1, 2]), 7)
    await Promise.resolve()
    expect(lastWrite).toBe(1000)
    expect(source.isWriting()).toBe(true)
    time = 4000
    pending.resolve()
    expect(await result).toBe(true)
    expect(lastWrite).toBe(4000)
    expect(savedVersion).toBe(7)
  } finally {
    clock.mockRestore()
  }
})

test('overlapping writes retain the guard until the last writer releases it', () => {
  const source = createDocumentSourceState()
  const first = source.beginWrite()
  const second = source.beginWrite()
  first()
  first()
  expect(source.isWriting()).toBe(true)
  second()
  expect(source.isWriting()).toBe(false)
})

test('a rejected disk write releases the guard without marking it saved', async () => {
  const source = createDocumentSourceState()
  const handle = asDouble<FileSystemFileHandle>({
    createWritable: async () => {
      throw new Error('Owned write rejected')
    }
  })
  const write = createDocumentWriter({
    state: { documentName: 'Owned' },
    getFilePath: () => null,
    getFileHandle: () => handle,
    getStorageBinding: () => null,
    setSavedVersion: source.setSavedVersion,
    setLastWriteTime: source.setLastWriteTime,
    beginWrite: source.beginWrite
  })
  await expect(write(new Uint8Array([1]), 7)).rejects.toThrow('Owned write rejected')
  expect(source.isWriting()).toBe(false)
  expect(source.getSavedVersion()).toBe(0)
})
