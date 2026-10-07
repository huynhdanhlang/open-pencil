import type { SceneGraph } from '@open-pencil/scene-graph'
import { computeBounds } from '@open-pencil/scene-graph/geometry'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { canUseFigPopulationWorker } from '#core/kiwi/fig/population/client'

export type RuntimeHistory = () => { undo: number; redo: number; batches: number }
/** A bounded, redacted error sample from the app's existing shared diagnostics owner. */
export interface RuntimeDiagnosticsStatus {
  scope: 'shared-diagnostics'
  enabled: boolean
  storageBackend: 'uninitialized' | 'indexeddb' | 'memory'
  lastPersistenceErrorName: string | null
  recentRuntimeErrorCount: number
  wasmFailures: Array<{
    timestamp: number
    kind: 'aborted' | 'out-of-bounds'
    source: 'window' | 'rejection' | 'vue' | null
    stack: string | null
  }>
}
/** Numeric ownership counters only; never expose recovery payloads or source paths. */
export interface RuntimePersistenceStatus {
  contentRevision: number
  dirty: boolean
  memoryFallback: boolean
  recoveryMemory: { scope: 'shared-recovery-store'; snapshots: number; bytes: number } | null
  recovery: {
    builds: number
    writes: number
    building: boolean
    writingBytes: number
    lastBuiltBytes: number
    failures: number
    persistedVersion: number | null
    pendingRevision: boolean
  }
}

export function readDocumentRuntimeStatus(graph: SceneGraph) {
  let encodedImageBytes = 0
  for (const bytes of graph.images.values()) encodedImageBytes += bytes.byteLength
  return {
    nodeScope: 'materialized' as const,
    nodes: graph.nodes.size,
    images: graph.images.size,
    encodedImageBytes,
    populationWorkerRetained: canUseFigPopulationWorker(graph)
  }
}

export interface FigmaViewport {
  center: Vector
  zoom: number
  scrollAndZoomIntoView: (nodes: readonly { absoluteBoundingBox: Rect }[]) => void
}

export function readViewport(
  current: { x: number; y: number; zoom: number },
  viewSize: () => Vector,
  set: (viewport: { x: number; y: number; zoom: number }) => void
): FigmaViewport {
  return {
    center: { x: current.x, y: current.y },
    zoom: current.zoom,
    scrollAndZoomIntoView: (nodes) => {
      const b = computeBounds(nodes.map((n) => n.absoluteBoundingBox))
      if (b.width === 0 && b.height === 0 && nodes.length === 0) return
      const padding = 80
      const contentW = b.width + padding * 2
      const contentH = b.height + padding * 2
      const size = viewSize()
      const zoom = Math.min(size.x / contentW, size.y / contentH, 1)
      set({ x: b.x + b.width / 2, y: b.y + b.height / 2, zoom })
    }
  }
}
