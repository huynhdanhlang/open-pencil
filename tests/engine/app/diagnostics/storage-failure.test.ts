import 'fake-indexeddb/auto'
import { expect, spyOn, test } from 'bun:test'

import { diagnostics, recordRuntimeError } from '@/app/diagnostics'

// Run this file in its own process: the production recorder and database promises are singletons.
test('a failed durable write keeps a WASM stack readable through runtime diagnostics', async () => {
  const blockedPut = spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('private storage context', 'QuotaExceededError')
  })
  try {
    const error = new WebAssembly.RuntimeError('Aborted(). Build with -sASSERTIONS for more info.')
    error.stack = 'wasm-function[18]@[wasm code]'
    recordRuntimeError(error, 'rejection')
    await diagnostics.list()
    expect(diagnostics.getRuntimeStatus()).toMatchObject({
      storageBackend: 'memory',
      lastPersistenceErrorName: 'QuotaExceededError',
      wasmFailures: [
        { kind: 'aborted', source: 'rejection', stack: 'wasm-function[18]@[wasm code]' }
      ]
    })
    expect(JSON.stringify(diagnostics.getRuntimeStatus())).not.toContain('private storage context')
  } finally {
    blockedPut.mockRestore()
  }
})
