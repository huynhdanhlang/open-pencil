import { createFigDocumentSession } from '@open-pencil/fig'
import type { FigPageManifestEntry } from '@open-pencil/kiwi/fig'

import {
  buildFigPopulationDelta,
  installFigMutationJournal,
  withFigPopulationDelta,
  type FigMutationJournal,
  type FigPopulationDelta
} from '#core/kiwi/fig/population/delta'
import { readerSessionOptions, type FigReaderDiagnostic } from '#core/kiwi/fig/session/options'

/** Worker and main-thread transport for the .fig reader session for the FIG reader session. */
export function openReaderSession(
  bytes: ArrayBuffer,
  populate: 'all' | 'first-page' | 'none' = 'all'
) {
  const diagnostics: FigReaderDiagnostic[] = []
  const session = createFigDocumentSession(bytes, readerSessionOptions(diagnostics))
  const pages: FigPageManifestEntry[] = session.pages.map((page) => ({
    sourceId: page.id,
    name: page.name,
    position: page.position,
    internalOnly: page.internalOnly
  }))
  const sourceByGraph = new Map<string, string>()
  for (const page of session.pages) {
    const id = session.graphPageId(page.id)
    if (id) sourceByGraph.set(id, page.id)
  }
  const loadedGraphIds = () =>
    [...session.loadedPageIds].flatMap((id) => {
      const graphId = session.graphPageId(id)
      return graphId ? [graphId] : []
    })
  if (populate === 'all') {
    for (const page of pages) if (!page.internalOnly) session.loadPage(page.sourceId)
  } else if (populate === 'first-page') {
    const page = pages.find((page) => !page.internalOnly)
    if (page) session.loadPage(page.sourceId)
  }
  const isComplete = () => session.pages.every((page) => session.loadedPageIds.has(page.id))
  const isPopulationComplete = () =>
    session.pages.every((page) => page.internalOnly || session.loadedPageIds.has(page.id))
  const metadata = (populated: boolean) => ({
    checkpoint: session.checkpoint(),
    populated,
    readerComplete: isComplete(),
    populationComplete: isPopulationComplete()
  })
  let populating = false
  function withPagePopulation<T>(
    pageId: string,
    action: (result: ReturnType<typeof metadata>, journal: FigMutationJournal) => T
  ): T {
    if (populating) throw new Error('FIG page population already active')
    const sourceId = sourceByGraph.get(pageId)
    if (!sourceId) throw new Error(`Unknown graph page ${pageId}`)
    const populated = !session.loadedPageIds.has(sourceId)
    populating = true
    let journal: FigMutationJournal | undefined
    try {
      journal = installFigMutationJournal(session.graph)
      session.loadPage(sourceId)
      return action(metadata(populated), journal)
    } finally {
      journal?.stop()
      populating = false
    }
  }
  return {
    session,
    /** Records skipped so far, including those of pages loaded later. */
    diagnostics,
    checkpoint: () => session.checkpoint(),
    graph: session.graph,
    pages,
    isComplete,
    isPopulationComplete,
    populate(pageId: string) {
      return withPagePopulation(pageId, (result, journal) => ({
        ...result,
        delta: buildFigPopulationDelta(session.graph, journal, loadedGraphIds())
      }))
    },
    /** Only the worker's synchronous MessagePort publisher may borrow this response. */
    publishPopulation(
      pageId: string,
      publish: (result: ReturnType<typeof metadata> & { delta: FigPopulationDelta }) => void
    ) {
      return withPagePopulation(pageId, (result, journal) => {
        withFigPopulationDelta(session.graph, journal, loadedGraphIds(), (delta) => {
          publish({ ...result, delta })
        })
        return {
          readerComplete: result.readerComplete,
          populationComplete: result.populationComplete
        }
      })
    }
  }
}
