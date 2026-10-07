import type {
  RecoverySnapshot,
  RecoverySnapshotInput,
  RecoverySnapshotMeta,
  RecoveryStore
} from '@/app/document/recovery/types'

export function createMemoryRecoveryStore(): RecoveryStore {
  const snapshots = new Map<string, RecoverySnapshot>()

  return {
    getMemoryUsage() {
      let bytes = 0
      for (const snapshot of snapshots.values()) bytes += snapshot.figBytes.byteLength
      return { snapshots: snapshots.size, bytes }
    },
    async list() {
      return [...snapshots.values()]
        .map(({ figBytes: _figBytes, ...metadata }) => structuredClone(metadata))
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    },
    async read(id: string) {
      const snapshot = snapshots.get(id)
      return snapshot ? structuredClone(snapshot) : null
    },
    async write(input: RecoverySnapshotInput) {
      const metadata: RecoverySnapshotMeta = {
        id: input.id,
        documentName: input.documentName || 'Untitled',
        updatedAt: new Date().toISOString(),
        sceneVersion: input.sceneVersion,
        byteLength: input.figBytes.byteLength,
        formatVersion: 1
      }
      snapshots.set(input.id, {
        ...metadata,
        figBytes: new Uint8Array(input.figBytes)
      })
      return structuredClone(metadata)
    },
    async remove(id: string) {
      snapshots.delete(id)
    },
    async clear() {
      snapshots.clear()
    }
  }
}
