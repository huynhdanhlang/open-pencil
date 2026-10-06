import { watchDebounced } from '@vueuse/core'
import { watch, type WatchHandle } from 'vue'

import type { EditorState } from '@open-pencil/core/editor'

import { getRecoveryStore } from '@/app/document/recovery/store'
import type { RecoveryStore } from '@/app/document/recovery/types'
import { createCanvasId } from '@/app/storage/id'

type RecoveryState = EditorState & { documentName: string }

interface DocumentRecoveryOptions {
  state: RecoveryState
  getRevision: () => number
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
}

export function createDocumentRecovery({
  state,
  getRevision,
  buildFigFile,
  isEnabled = () => true,
  store = getRecoveryStore(),
  recoveryId = createCanvasId()
}: DocumentRecoveryOptions): DocumentRecoveryController {
  let id = recoveryId
  let protectedVersion = getRevision()
  let persistedVersion: number | null = null
  let requestedVersion = protectedVersion
  let lifecycleGeneration = 0
  let writing: Promise<void> | null = null
  let cleanup: Promise<void> = Promise.resolve()
  let disposed = false

  async function runWrites(generation: number): Promise<void> {
    if (disposed || generation !== lifecycleGeneration || !isEnabled()) return
    if (requestedVersion === protectedVersion || requestedVersion === persistedVersion) return
    const version = requestedVersion
    const sceneVersion = state.sceneVersion
    const bytes = await buildFigFile()
    if (generation !== lifecycleGeneration || !isEnabled()) return
    await store.write({
      id,
      documentName: state.documentName,
      sceneVersion,
      figBytes: bytes
    })
    persistedVersion = version
    if (generation !== lifecycleGeneration) return
    protectedVersion = version
    if (requestedVersion !== version) await runWrites(generation)
  }

  async function persistNow(): Promise<void> {
    await cleanup
    if (disposed || !isEnabled()) return
    requestedVersion = getRevision()
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
    () => getRevision(),
    () => {
      void persistNow().catch((error) => console.warn('[Recovery] Snapshot failed:', error))
    },
    { debounce: 3000, maxWait: 10000 }
  )

  const stopEnabledWatch: WatchHandle = watch(
    isEnabled,
    (enabled) => {
      if (enabled) {
        protectedVersion = getRevision()
        requestedVersion = getRevision()
        return
      }
      lifecycleGeneration++
      const cleanupGeneration = lifecycleGeneration
      const snapshotId = id
      requestedVersion = getRevision()
      protectedVersion = getRevision()
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
    getRecoveryId: () => id,
    async adoptRecoverySnapshot(nextId) {
      const previousId = id
      await invalidateActiveWrite()
      id = nextId
      // Persisted version counters belong to the old editor lifetime. Rebase the
      // adopted draft so a successful Save in this editor can protect and clean it.
      protectedVersion = getRevision()
      persistedVersion = getRevision()
      requestedVersion = getRevision()
      disposed = false
      if (previousId !== nextId) await store.remove(previousId)
    },
    persistNow,
    async markProtectedVersion(version) {
      await invalidateActiveWrite()
      protectedVersion = version
      requestedVersion = getRevision()
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
      protectedVersion = getRevision()
      persistedVersion = null
      requestedVersion = getRevision()
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
