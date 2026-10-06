import type { SceneGraph } from '@open-pencil/scene-graph'
import { randomHex } from '@open-pencil/scene-graph/random'

import { updateReaderRecovery, releaseReaderRecovery } from '#core/kiwi/fig/session/document-state'
import type { FigSessionResponse } from '#core/kiwi/fig/session/protocol'

import { applyFigPopulationDelta } from './delta'

/** The two responses this client acts on, taken from the session protocol itself. */
type WorkerResult = Extract<FigSessionResponse, { type: 'population-result' | 'population-error' }>

const MAX_FIG_POPULATION_WORKER_NODES = 200_000
const FIG_POPULATION_WORKER_TIMEOUT_MS = 30_000
const populationWorkers = new WeakMap<SceneGraph, FigPopulationWorker>()
interface OriginalArchiveRequest {
  request: () => Promise<Uint8Array>
  valid: boolean
  unbind: () => void
  invalidated: Promise<null>
  invalidate: () => void
}
const originalArchiveRequests = new WeakMap<SceneGraph, OriginalArchiveRequest>()

interface PopulationCompletion {
  pageIds: readonly string[]
  loadedPageIds: readonly string[]
  originalArchive: () => Promise<Uint8Array>
}

function pagesComplete(pageIds: readonly string[], loadedPageIds: readonly string[]): boolean {
  const loaded = new Set(loadedPageIds)
  return pageIds.every((id) => loaded.has(id))
}

export interface FigPopulationWorkerTelemetry {
  event: 'registered' | 'populate' | 'fallback' | 'stale' | 'terminated'
  reason?: 'oversized' | 'graph-mutation' | 'worker-error' | 'fully-populated'
  durationMs?: number
  applyMs?: number
  created?: number
  updated?: number
  deleted?: number
}

function emitTelemetry(detail: FigPopulationWorkerTelemetry): void {
  if (typeof globalThis.dispatchEvent !== 'function') return
  globalThis.dispatchEvent(new CustomEvent('openpencil:fig-population-worker', { detail }))
}

export function registerFigPopulationWorker(
  graph: SceneGraph,
  worker: Worker,
  port?: MessagePort,
  completion?: PopulationCompletion
): void {
  if (completion && pagesComplete(completion.pageIds, completion.loadedPageIds)) {
    registerOriginalArchiveRequest(graph, completion.originalArchive)
    port?.postMessage({ type: 'dispose' })
    port?.close()
    worker.terminate()
    emitTelemetry({ event: 'terminated', reason: 'fully-populated' })
    return
  }
  if (graph.nodes.size > MAX_FIG_POPULATION_WORKER_NODES) {
    emitTelemetry({ event: 'fallback', reason: 'oversized' })
    if (!port) {
      worker.terminate()
      return
    }
    populationWorkers.set(graph, createDisposalOnlyWorker(worker, port))
    return
  }
  const client = createPopulationWorkerClient(
    graph,
    worker,
    port,
    completion && {
      pageIds: completion.pageIds,
      originalArchive: completion.originalArchive
    }
  )
  populationWorkers.set(graph, client)
  emitTelemetry({ event: 'registered' })
}

export function canUseFigPopulationWorker(graph: SceneGraph): boolean {
  return populationWorkers.has(graph)
}

export function registerOriginalArchiveRequest(
  graph: SceneGraph,
  request: () => Promise<Uint8Array>,
  cancel?: () => void
): void {
  const previous = originalArchiveRequests.get(graph)
  let resolveInvalidated: (value: null) => void = () => undefined
  const invalidated = new Promise<null>((resolve) => {
    resolveInvalidated = resolve
  })
  const entry: OriginalArchiveRequest = {
    request,
    valid: true,
    unbind: () => undefined,
    invalidated,
    invalidate() {
      if (!entry.valid) return
      entry.valid = false
      resolveInvalidated(null)
      cancel?.()
    }
  }
  const invalidate = () => {
    if (!graph.isApplyingLayout && !graph.isApplyingImportedState) entry.invalidate()
  }
  entry.unbind = graph.onNodeEvents({
    created: invalidate,
    updated: invalidate,
    deleted: invalidate,
    reparented: invalidate,
    reordered: invalidate
  })
  originalArchiveRequests.set(graph, entry)
  // Bind the successor before cancellation callbacks can cause a real live edit.
  previous?.unbind()
  previous?.invalidate()
}

function invalidateOriginalArchiveRequest(graph: SceneGraph): void {
  originalArchiveRequests.get(graph)?.invalidate()
}

export async function requestOriginalArchive(graph: SceneGraph): Promise<Uint8Array | null> {
  const entry = originalArchiveRequests.get(graph)
  if (!entry?.valid) return null
  const archive = await Promise.race([entry.request(), entry.invalidated])
  return originalArchiveRequests.get(graph)?.valid === true &&
    originalArchiveRequests.get(graph) === entry
    ? archive
    : null
}

export function releaseFigPopulationWorker(graph: SceneGraph): void {
  invalidateOriginalArchiveRequest(graph)
  releaseReaderRecovery(graph)
  populationWorkers.get(graph)?.terminate()
  populationWorkers.delete(graph)
  originalArchiveRequests.get(graph)?.unbind()
  originalArchiveRequests.delete(graph)
}

export interface FigPopulationWorker {
  populate: (pageId: string, signal?: AbortSignal) => Promise<boolean | null>
  terminate: () => void
}

function createDisposalOnlyWorker(worker: Worker, port: MessagePort): FigPopulationWorker {
  let disposed = false
  return {
    populate: () => Promise.resolve(null),
    terminate() {
      if (disposed) return
      disposed = true
      emitTelemetry({ event: 'terminated' })
      port.postMessage({ type: 'dispose' })
      port.close()
      worker.terminate()
    }
  }
}

export function createFigPopulationWorker(graph: SceneGraph): FigPopulationWorker | null {
  if (!canUseFigPopulationWorker(graph)) return null
  return populationWorkers.get(graph) ?? null
}

export function createPopulationWorkerClient(
  graph: SceneGraph,
  worker: Pick<Worker, 'postMessage' | 'terminate' | 'onerror' | 'onmessage'>,
  port?: Pick<MessagePort, 'postMessage' | 'start' | 'close' | 'onmessage'>,
  completion?: { pageIds: readonly string[]; originalArchive: () => Promise<Uint8Array> }
): FigPopulationWorker {
  const pending = new Map<
    string,
    {
      resolve: (value: boolean | null) => void
      abort?: () => void
      revision: number
      startedAt: number
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  let revision = 0
  let stale = false
  let disposed = false
  let applyingDelta = false
  const invalidate = () => {
    // Layout recomputation (import-time or after a switch) is derived from the
    // same scene graph the worker deltas were built from; it must not count as
    // user divergence. Only real user edits invalidate the worker.
    if (applyingDelta || stale || graph.isApplyingLayout) return
    revision++
    stale = true
    emitTelemetry({ event: 'stale', reason: 'graph-mutation' })
    // The recovery checkpoint/bytes stay with the live graph. Its stale worker mirror cannot
    // contribute another delta or original archive, so release it during same-page editing.
    fail(false)
  }
  let unbind: (() => void) | undefined
  const releaseSubscription = () => {
    unbind?.()
    unbind = undefined
  }
  const fail = (emit = true, originalArchive?: () => Promise<Uint8Array>) => {
    if (disposed) return
    disposed = true
    stale = true
    if (emit) emitTelemetry({ event: 'fallback', reason: 'worker-error' })
    releaseSubscription()
    if (originalArchive) registerOriginalArchiveRequest(graph, originalArchive)
    else invalidateOriginalArchiveRequest(graph)
    port?.close()
    worker.terminate()
    populationWorkers.delete(graph)
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.abort?.()
      request.resolve(null)
    }
    pending.clear()
    emitTelemetry({ event: 'terminated', reason: originalArchive ? 'fully-populated' : undefined })
  }
  unbind = graph.onNodeEvents({
    created: invalidate,
    updated: invalidate,
    deleted: invalidate,
    reparented: invalidate,
    reordered: invalidate
  })
  const receive = (result: WorkerResult) => {
    if (result.type === 'population-error') return fail()
    const request = pending.get(result.requestId)
    if (!request) return
    clearTimeout(request.timeout)
    request.abort?.()
    pending.delete(result.requestId)
    if (stale || revision !== request.revision || result.baseRevision !== request.revision) {
      emitTelemetry({ event: 'stale', reason: 'graph-mutation' })
      return request.resolve(null)
    }
    applyingDelta = true
    const applyStartedAt = performance.now()
    try {
      applyFigPopulationDelta(graph, result.delta)
      if (result.checkpoint) updateReaderRecovery(graph, result.checkpoint)
    } catch {
      applyingDelta = false
      fail()
      return request.resolve(null)
    } finally {
      applyingDelta = false
    }
    if (
      !stale &&
      !disposed &&
      completion &&
      result.checkpoint &&
      pagesComplete(completion.pageIds, result.checkpoint.loadedPageIds)
    ) {
      fail(false, completion.originalArchive)
    }
    emitTelemetry({
      event: 'populate',
      durationMs: performance.now() - request.startedAt,
      applyMs: performance.now() - applyStartedAt,
      created: result.delta.created.length,
      updated: result.delta.updated.length,
      deleted: result.delta.deleted.length
    })
    request.resolve(result.populated)
  }
  if (port) {
    port.onmessage = (event: MessageEvent<WorkerResult>) => receive(event.data)
    port.start()
  } else {
    worker.onmessage = (event: MessageEvent<WorkerResult>) => receive(event.data)
  }
  worker.onerror = () => fail()
  return {
    populate(pageId, signal) {
      signal?.throwIfAborted()
      if (stale) return Promise.resolve(null)
      const requestId = randomHex()
      const baseRevision = revision
      return new Promise((resolve, reject) => {
        const abort = () => {
          const request = pending.get(requestId)
          if (!request) return
          clearTimeout(request.timeout)
          pending.delete(requestId)
          fail(false)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        signal?.addEventListener('abort', abort, { once: true })
        const timeout = setTimeout(() => fail(), FIG_POPULATION_WORKER_TIMEOUT_MS)
        pending.set(requestId, {
          resolve,
          abort: () => signal?.removeEventListener('abort', abort),
          revision: baseRevision,
          startedAt: performance.now(),
          timeout
        })
        if (port) port.postMessage({ type: 'populate', requestId, baseRevision, pageId })
        else worker.postMessage({ type: 'populate', requestId, baseRevision, pageId }, [])
      })
    },
    terminate() {
      if (disposed) return
      port?.postMessage({ type: 'dispose' })
      fail(false)
    }
  }
}
