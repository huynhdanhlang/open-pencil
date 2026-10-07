export interface RecoverySnapshotMeta {
  id: string
  documentName: string
  updatedAt: string
  sceneVersion: number
  byteLength: number
  formatVersion: 1
}

export interface RecoverySnapshot extends RecoverySnapshotMeta {
  figBytes: Uint8Array
}

export interface RecoverySnapshotInput {
  id: string
  documentName: string
  sceneVersion: number
  figBytes: Uint8Array
}

export interface RecoveryStore {
  /** Archives owned by the memory backend, excluding IDB/transient codec copies. */
  getMemoryUsage?(): { snapshots: number; bytes: number } | null
  list(): Promise<RecoverySnapshotMeta[]>
  read(id: string): Promise<RecoverySnapshot | null>
  write(input: RecoverySnapshotInput): Promise<RecoverySnapshotMeta>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}
