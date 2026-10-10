import { createFigDocumentSession, type FigSessionCheckpoint } from '@open-pencil/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { readerSessionOptions, type FigReaderDiagnostic } from '#core/kiwi/fig/session/options'

/**
 * Per-graph reader state: the archive bytes, the live session or its checkpoint, and the
 * records that session skipped. Page population, diagnostics and recovery all read it.
 */
interface ReaderState {
  /** The archive, until every page is in the graph and nothing is left to read from it. */
  bytes?: ArrayBuffer
  checkpoint?: FigSessionCheckpoint
  session?: ReturnType<typeof createFigDocumentSession>
  /** Host recovery may load hidden resources; worker-only recovery must not race its reader. */
  hostRecovery?: true
  /** Records skipped by sessions this recovery state has opened. */
  diagnostics: FigReaderDiagnostic[]
  /** Every page is loaded and the reader released; only the diagnostics remain. */
  complete?: true
}
const states = new WeakMap<SceneGraph, ReaderState>()

/** Immutable archive and current population boundary for an isolated export. */
export function readerExportState(graph: SceneGraph) {
  const state = states.get(graph)
  if (!state || state.complete) return undefined
  const checkpoint = state.session?.checkpoint() ?? state.checkpoint
  if (!checkpoint || !state.bytes) throw new Error('Missing reader checkpoint')
  return { bytes: state.bytes, checkpoint: checkpointForLiveGraph(graph, checkpoint) }
}

/** The imported checkpoint predates live component deletion; the live graph owns that edit. */
function checkpointForLiveGraph(
  graph: SceneGraph,
  checkpoint: FigSessionCheckpoint
): FigSessionCheckpoint {
  return {
    ...checkpoint,
    components: checkpoint.components.filter(([, entry]) => graph.getNode(entry.rootId))
  }
}

export function registerReaderRecovery(
  graph: SceneGraph,
  bytes: ArrayBuffer,
  checkpoint: FigSessionCheckpoint
): void {
  states.set(graph, { bytes, checkpoint, diagnostics: [] })
}

export function registerReaderSession(
  bytes: ArrayBuffer,
  session: ReturnType<typeof createFigDocumentSession>,
  diagnostics: FigReaderDiagnostic[] = []
): void {
  const state: ReaderState = { bytes, session, diagnostics, hostRecovery: true }
  states.set(session.graph, state)
  releaseLoadedReader(state)
}

/** Records skipped while opening, recovering, or exporting this graph's document. */
export function readerDiagnostics(graph: SceneGraph): readonly FigReaderDiagnostic[] {
  return states.get(graph)?.diagnostics ?? []
}

export function isReaderPagePending(graph: SceneGraph, pageId: string): boolean {
  const state = states.get(graph)
  if (!state || state.complete) return false
  const session = state.session
  if (session) {
    // Query the live reader's mapping; checkpoint() clones all component paths.
    return session.isGraphPagePending(pageId)
  }
  const checkpoint = state.checkpoint
  const sourceId = checkpoint?.sources.find(([, graphId]) => graphId === pageId)?.[0]
  if (!sourceId) return false
  return !checkpoint.loadedPageIds.includes(sourceId)
}

/** Where the reader stands: which records became which layers, and which pages it loaded. */
export function readerCheckpoint(graph: SceneGraph): FigSessionCheckpoint | undefined {
  const state = states.get(graph)
  return state?.session?.checkpoint() ?? state?.checkpoint
}

export function hasReaderSession(graph: SceneGraph): boolean {
  return states.has(graph)
}

export function populateFigPage(graph: SceneGraph, pageId: string): boolean {
  return isReaderPagePending(graph, pageId) ? recoverReaderPage(graph, pageId) : false
}

export function populateAllFigPages(graph: SceneGraph): boolean {
  let changed = false
  for (const page of graph.getPages()) {
    if (populateFigPage(graph, page.id)) changed = true
  }
  return changed
}

/**
 * Retire the decoded host reader once visible pages are materialized, matching the worker's
 * ownership boundary. Hidden resources resume from bytes/checkpoint; only archive completion
 * releases those bytes. Patched Save retains the final record-to-layer mappings.
 */
function releaseLoadedReader(state: ReaderState): void {
  const session = state.session
  if (!session?.pages.every((page) => page.internalOnly || session.loadedPageIds.has(page.id)))
    return
  const complete = session.pages.every((page) => session.loadedPageIds.has(page.id))
  state.checkpoint = session.checkpoint()
  state.session = undefined
  if (complete) {
    state.bytes = undefined
    state.complete = true
  }
}

/**
 * Load the pages the editor never shows, such as Figma's internal canvas, into the document's own
 * graph, so a save no longer opens a second session to read them into its copy. Their layers
 * never draw and loading them is not an edit. A retired host reader resumes its own checkpoint;
 * worker-only recovery must not start a competing host reader.
 */
export function populateFigInternalPages(graph: SceneGraph): boolean {
  const state = states.get(graph)
  if (!state || state.complete || (!state.session && !state.hostRecovery)) return false
  let changed = false
  graph.applyImportedStateDuring(() => {
    const session = resumeHostReader(graph, state)
    for (const page of session.pages) {
      if (!page.internalOnly || session.loadedPageIds.has(page.id)) continue
      const livePageId = session.graphPageId(page.id)
      if (!livePageId || !graph.getNode(livePageId)) continue
      session.loadPage(page.id)
      changed = true
    }
  })
  releaseLoadedReader(state)
  return changed
}

/**
 * Whether a save still has pages to read from the archive, which it reads into a copy of the
 * document: a population worker still fills the graph, or a page is not loaded yet.
 */
export function hasPendingReaderPages(graph: SceneGraph): boolean {
  const state = states.get(graph)
  if (!state || state.complete) return false
  const session = state.session
  return !session || !session.pages.every((page) => session.loadedPageIds.has(page.id))
}

export function populateReaderExport(source: SceneGraph, target: SceneGraph): boolean {
  const state = states.get(source)
  if (!state || state.complete) return false
  const live = state.session
  // Every page is already in the graph the target was copied from.
  if (live?.pages.every((page) => live.loadedPageIds.has(page.id))) return false
  const checkpoint = live?.checkpoint() ?? state.checkpoint
  if (!checkpoint || !state.bytes) throw new Error('Missing reader checkpoint')
  const retainedPageIds = new Set(source.getPages(true).map((page) => page.id))
  const session = createFigDocumentSession(state.bytes, readerSessionOptions(state.diagnostics), {
    graph: target,
    checkpoint: checkpointForLiveGraph(source, checkpoint)
  })
  // Export must include internal content too, not just the dependency closure needed
  // for visible pages. Loading happens on the isolated target, never the live graph.
  for (const page of session.pages) {
    const graphId = session.graphPageId(page.id)
    if (!graphId) throw new Error(`Missing reader page mapping ${page.id}`)
    // A removed page must not be populated from the pre-edit archive during Save.
    if (retainedPageIds.has(graphId)) session.loadPage(page.id)
  }
  return true
}

export function updateReaderRecovery(
  graph: SceneGraph,
  checkpoint: FigSessionCheckpoint,
  readerComplete = false
): void {
  const state = states.get(graph)
  if (!state || state.session) return
  state.checkpoint = checkpoint
  // The worker verified every archive source page, including hidden resources.
  // Keep its final mappings for patched Save, but no decoded reader is needed.
  if (readerComplete) {
    state.bytes = undefined
    state.complete = true
  }
}

export function releaseReaderRecovery(graph: SceneGraph): void {
  states.delete(graph)
}

function resumeHostReader(graph: SceneGraph, state: ReaderState) {
  if (!state.session) {
    if (!state.checkpoint || !state.bytes) throw new Error('Missing reader checkpoint')
    state.session = createFigDocumentSession(state.bytes, readerSessionOptions(state.diagnostics), {
      graph,
      checkpoint: checkpointForLiveGraph(graph, state.checkpoint)
    })
  }
  state.hostRecovery = true
  return state.session
}

export function recoverReaderPage(graph: SceneGraph, pageId: string): boolean {
  const state = states.get(graph)
  if (!state) throw new Error('No reader recovery state')
  if (state.complete) return false
  let populated = false
  // Reader transactions deliver buffered events before returning. Keep both
  // resume and load inside the import boundary, matching worker delta delivery.
  graph.applyImportedStateDuring(() => {
    const session = resumeHostReader(graph, state)
    const page = session.pages.find((page) => session.graphPageId(page.id) === pageId)
    if (!page) throw new Error(`Unknown graph page ${pageId}`)
    populated = !session.loadedPageIds.has(page.id)
    session.loadPage(page.id)
  })
  releaseLoadedReader(state)
  return populated
}
