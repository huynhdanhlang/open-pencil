import { watchDebounced } from '@vueuse/core'
import { watch, type WatchHandle } from 'vue'

import type { RuntimePersistenceStatus } from '@open-pencil/core/figma-api'

import { getRecoveryStore } from '@/app/document/recovery/store'
import type { RecoveryStore } from '@/app/document/recovery/types'
import { createCanvasId } from '@/app/storage/id'

interface DocumentRecoveryOptions {
  state: { documentName: string }
  /** The document's content revision; rendering and layout do not advance it. */
  version: () => number
  buildFigFile: () => Promise<Uint8Array> | Uint8Array
  isEnabled?: () => boolean
  store?: RecoveryStore
  recoveryId?: string
}

export interface DocumentRecoveryController {
  getRecoveryId(): string
  adoptRecoverySnapshot(id: string): Promise<void>
  persistNow(): Promise<void>
  markProtectedVersion(version: number): Promise<void>
  discardRecovery(): Promise<void>
  disposeRecovery(): void
  getDiagnostics(): RuntimePersistenceStatus['recovery']
}

export function createDocumentRecovery({
  state,
  version: currentVersion,
  buildFigFile,
  isEnabled = () => true,
  store = getRecoveryStore(),
  recoveryId = createCanvasId()
}: DocumentRecoveryOptions): DocumentRecoveryController {
  let id = recoveryId
  let protectedVersion = currentVersion()
  let persistedVersion: number | null = null
  let requestedVersion = protectedVersion
  let lifecycleGeneration = 0
  let writing: Promise<void> | null = null
  let cleanup: Promise<void> = Promise.resolve()
  let disposed = false
  const metrics = {
    builds: 0,
    writes: 0,
    building: false,
    writingBytes: 0,
    lastBuiltBytes: 0,
    failures: 0
  }

  async function runWrites(generation: number): Promise<void> {
    if (disposed || generation !== lifecycleGeneration || !isEnabled()) return
    if (requestedVersion === protectedVersion || requestedVersion === persistedVersion) return
    const version = requestedVersion
    let bytes: Uint8Array
    metrics.building = true
    try {
      bytes = await buildFigFile()
      metrics.builds++
      metrics.lastBuiltBytes = bytes.byteLength
    } catch (error) {
      metrics.failures++
      throw error
    } finally {
      metrics.building = false
    }
    if (generation !== lifecycleGeneration || !isEnabled()) return
    metrics.writingBytes = bytes.byteLength
    try {
      await store.write({ id, documentName: state.documentName, figBytes: bytes })
      metrics.writes++
    } catch (error) {
      metrics.failures++
      throw error
    } finally {
      metrics.writingBytes = 0
    }
    persistedVersion = version
    if (generation !== lifecycleGeneration) return
    protectedVersion = version
    if (requestedVersion !== version) await runWrites(generation)
  }

  async function persistNow(): Promise<void> {
    await cleanup
    if (disposed || !isEnabled()) return
    requestedVersion = currentVersion()
    if (requestedVersion === protectedVersion || requestedVersion === persistedVersion) return
    if (!writing) {
      const generation = lifecycleGeneration
      writing = runWrites(generation).finally(() => {
        writing = null
      })
    }
    await writing
  }

  const stopVersionWatch: WatchHandle = watchDebounced(
    currentVersion,
    () => {
      void persistNow().catch((error) => console.warn('[Recovery] Snapshot failed:', error))
    },
    { debounce: 3000, maxWait: 10000 }
  )

  const stopEnabledWatch: WatchHandle = watch(
    isEnabled,
    (enabled) => {
      if (enabled) {
        protectedVersion = currentVersion()
        requestedVersion = currentVersion()
        return
      }
      lifecycleGeneration++
      const cleanupGeneration = lifecycleGeneration
      const snapshotId = id
      requestedVersion = currentVersion()
      protectedVersion = currentVersion()
      const activeWrite = writing
      cleanup = cleanup
        .then(async () => {
          await activeWrite
          await store.remove(snapshotId)
          if (cleanupGeneration === lifecycleGeneration) persistedVersion = null
          return undefined
        })
        .catch((error) => console.warn('[Recovery] Failed to disable recovery:', error))
    },
    { flush: 'sync' }
  )

  async function invalidateActiveWrite(): Promise<void> {
    lifecycleGeneration++
    await Promise.all([writing, cleanup])
  }

  return {
    getDiagnostics: () => ({
      ...metrics,
      persistedVersion,
      pendingRevision:
        requestedVersion !== protectedVersion && requestedVersion !== persistedVersion
    }),
    getRecoveryId: () => id,
    async adoptRecoverySnapshot(nextId) {
      const previousId = id
      await invalidateActiveWrite()
      id = nextId
      // The adopted snapshot holds the document as it is now.
      const version = currentVersion()
      protectedVersion = version
      persistedVersion = version
      requestedVersion = version
      disposed = false
      if (previousId !== nextId) await store.remove(previousId)
    },
    persistNow,
    async markProtectedVersion(version) {
      await invalidateActiveWrite()
      protectedVersion = version
      requestedVersion = currentVersion()
      if (persistedVersion == null || persistedVersion <= version) {
        await store.remove(id)
        persistedVersion = null
      }
      // A concurrent edit may have lost its pending export during Save cleanup.
      // Persist that newer draft even when its debounce already fired.
      await persistNow()
    },
    async discardRecovery() {
      await invalidateActiveWrite()
      protectedVersion = currentVersion()
      persistedVersion = null
      requestedVersion = currentVersion()
      await store.remove(id)
    },
    disposeRecovery() {
      disposed = true
      lifecycleGeneration++
      stopVersionWatch()
      stopEnabledWatch()
    }
  }
}
