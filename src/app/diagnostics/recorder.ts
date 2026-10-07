import type { RuntimeDiagnosticsStatus } from '@open-pencil/core/figma-api'

import { describeDiagnosticError } from './error'
import { createIDBDiagnosticsStore, type DiagnosticsStore } from './idb'
import { scrubDiagnosticText } from './scrub'
import {
  getDiagnosticsRetention,
  isDiagnosticsEnabled,
  type DiagnosticsRetention
} from './settings'
import type { DiagnosticEvent, DiagnosticEventInput } from './types'

const MAX_MEMORY_EVENTS = 1000
let store: DiagnosticsStore | null = null
let memoryEvents: DiagnosticEvent[] = []
let pendingWrites = Promise.resolve()
let lastPersistenceErrorName: string | null = null
const subscribers = new Set<() => void>()
// Anchored frame syntax excludes exception/message headers, even when they contain @.
const SAFARI_CODE_FRAME =
  /^(?:[\w$.[\]<>-]+|global code|module code)?@(?:\[wasm code\]|(?:https?|tauri|file|wasm):\/\/\S+|\/\S+)$/
const V8_CODE_FRAME =
  /^\s*at\s+(?:(?:async|new)\s+)?(?:[\w$.[\]<>-]+\s+\()?(?:wasm:\/\/\S+|(?:https?|tauri|file):\/\/\S+|\/\S+|\[wasm code\])\)?$/

const memoryStore: DiagnosticsStore = {
  async record(_event) {
    memoryEvents = memoryEvents.slice(-getDiagnosticsRetention())
  },
  async list() {
    return [...memoryEvents].reverse()
  },
  async prune(retention) {
    memoryEvents = memoryEvents.slice(-retention)
  },
  async clear() {
    memoryEvents = []
  }
}

function getStore(): DiagnosticsStore {
  if (store) return store
  if (typeof indexedDB === 'undefined') return (store = memoryStore)
  try {
    return (store = createIDBDiagnosticsStore())
  } catch (error) {
    lastPersistenceErrorName = scrubDiagnosticText(describeDiagnosticError(error).errorName).slice(
      0,
      80
    )
    return (store = memoryStore)
  }
}

function notify(): void {
  for (const subscriber of subscribers) subscriber()
}

function makeEvent(input: DiagnosticEventInput): DiagnosticEvent {
  return { ...input, id: crypto.randomUUID(), timestamp: input.timestamp ?? Date.now() }
}

function enqueue(operation: () => Promise<void>): void {
  pendingWrites = pendingWrites.then(operation).catch((error: unknown) => {
    console.warn('[Diagnostics] Failed to persist event; using memory fallback:', error)
    lastPersistenceErrorName = scrubDiagnosticText(describeDiagnosticError(error).errorName).slice(
      0,
      80
    )
    store = memoryStore
  })
}

export function recordDiagnostic(input: DiagnosticEventInput): void {
  if (!isDiagnosticsEnabled()) return
  const event = makeEvent(input)
  memoryEvents = [...memoryEvents, event].slice(
    -Math.min(getDiagnosticsRetention(), MAX_MEMORY_EVENTS)
  )
  enqueue(() => getStore().record(event))
  notify()
}

export const diagnostics = {
  /** Reads existing state only: no storage access, export, or renderer work. */
  getRuntimeStatus(): RuntimeDiagnosticsStatus {
    const enabled = isDiagnosticsEnabled()
    const runtimeErrors = enabled
      ? memoryEvents.filter((event) => event.name === 'runtime.error')
      : []
    const wasmFailures: RuntimeDiagnosticsStatus['wasmFailures'] = []
    for (const event of runtimeErrors.toReversed()) {
      if (event.attributes.errorName !== 'RuntimeError') continue
      const message = event.attributes.message
      if (typeof message !== 'string') continue
      const kind = /out.of.bounds|memory access out of bounds/i.test(message)
        ? 'out-of-bounds'
        : /Aborted\(/.test(message)
          ? 'aborted'
          : null
      if (!kind) continue
      const source = event.attributes.source
      const stack = event.attributes.stack
      wasmFailures.push({
        timestamp: event.timestamp,
        kind,
        source: source === 'window' || source === 'rejection' || source === 'vue' ? source : null,
        // Omit the message line; keep only scrubbed code frames, bounded by the error owner.
        stack:
          typeof stack === 'string'
            ? scrubDiagnosticText(stack)
                .split('\n')
                .filter((line) => SAFARI_CODE_FRAME.test(line) || V8_CODE_FRAME.test(line))
                .slice(0, 25)
                .join('\n')
                .slice(0, 4000) || null
            : null
      })
      if (wasmFailures.length === 5) break
    }
    return {
      scope: 'shared-diagnostics',
      enabled,
      storageBackend:
        store === null ? 'uninitialized' : store === memoryStore ? 'memory' : 'indexeddb',
      lastPersistenceErrorName: enabled ? lastPersistenceErrorName : null,
      recentRuntimeErrorCount: runtimeErrors.length,
      wasmFailures
    }
  },
  recent(): DiagnosticEvent[] {
    return [...memoryEvents].reverse()
  },
  subscribe(listener: () => void): () => void {
    subscribers.add(listener)
    return () => subscribers.delete(listener)
  },
  async list(): Promise<DiagnosticEvent[]> {
    await pendingWrites
    return store === memoryStore ? memoryStore.list() : getStore().list()
  },
  /** The stored events, after `environment`, the context a report needs to reproduce them. */
  async export(environment: Record<string, unknown> = {}): Promise<string> {
    return JSON.stringify({ environment, events: await this.list() }, null, 2)
  },
  async prune(retention: DiagnosticsRetention): Promise<void> {
    memoryEvents = memoryEvents.slice(-retention)
    enqueue(() => getStore().prune(retention))
    await pendingWrites
    notify()
  },
  async clear(): Promise<void> {
    memoryEvents = []
    enqueue(() => getStore().clear())
    await pendingWrites
    notify()
  }
}
