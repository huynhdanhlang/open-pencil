import { expect, spyOn, test } from 'bun:test'

import { inertPopulationWorker } from '#core-tests/helpers/fig/population-worker'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io'
import { initCodec } from '@open-pencil/core/kiwi'
import { SceneGraph } from '@open-pencil/scene-graph'
import { createFigDocumentSession } from '@open-pencil/fig'

import { serializeSceneGraph, deserializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import {
  createPopulationWorkerClient,
  registerFigPopulationWorker,
  releaseFigPopulationWorker
} from '#core/kiwi/fig/population/client'
import { applyFigPopulationDelta } from '#core/kiwi/fig/population/delta'
import {
  registerReaderRecovery,
  registerReaderSession,
  isReaderPagePending,
  updateReaderRecovery,
  recoverReaderPage
} from '#core/kiwi/fig/session/document-state'
import type { FigSessionPopulateRequest, FigSessionResponse } from '#core/kiwi/fig/session/protocol'
import { openReaderSession } from '#core/kiwi/fig/session/reader'

test('pending page checks do not copy live reader checkpoints', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.getPages()[0].id, { name: 'First' })
  source.addPage('Empty pending page')
  source.createNode('RECTANGLE', source.addPage('Third').id, { name: 'Third' })
  const bytes = await exportFigFile(source)
  const buffer = bytes.slice().buffer as ArrayBuffer
  const session = createFigDocumentSession(buffer)
  registerReaderSession(buffer, session)
  const graph = session.graph
  const pages = session.pages.map((page) => ({
    source: page.id,
    graph: session.graphPageId(page.id)!
  }))
  const capture = session.checkpoint
  const checkpoint = spyOn(session, 'checkpoint')
  try {
    for (const page of pages) expect(isReaderPagePending(graph, page.graph)).toBe(true)
    expect(isReaderPagePending(graph, 'missing')).toBe(false)
    expect(isReaderPagePending(graph, graph.addPage('New').id)).toBe(false)
    session.loadPage(pages[0].source)
    expect(isReaderPagePending(graph, pages[0].graph)).toBe(false)
    expect(isReaderPagePending(graph, pages[1].graph)).toBe(true)
    session.loadPage(pages[1].source)
    expect(isReaderPagePending(graph, pages[1].graph)).toBe(false)
    // The archive mapping survives deletion; retain the existing pending predicate.
    graph.deleteNode(pages[2].graph)
    expect(isReaderPagePending(graph, pages[2].graph)).toBe(true)
    expect(checkpoint).not.toHaveBeenCalled()
    const saved = capture()
    const resumed = createFigDocumentSession(buffer, {}, {
      graph,
      checkpoint: { ...saved, sources: [['non-page-alias', pages[2].graph], ...saved.sources] }
    })
    registerReaderSession(buffer, resumed)
    // The old predicate picks the first source alias, even when it is not a page.
    expect(isReaderPagePending(graph, pages[2].graph)).toBe(false)
  } finally {
    checkpoint.mockRestore()
    releaseFigPopulationWorker(graph)
  }
})

test('rejected worker response cannot mark an unloaded page loaded in recovery', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.getPages()[0].id, { name: 'First' })
  source.createNode('RECTANGLE', source.addPage('Second').id, { name: 'Second node' })
  const bytes = await exportFigFile(source)
  const backend = openReaderSession(bytes.buffer as ArrayBuffer, 'first-page')
  const graph = deserializeSceneGraph(serializeSceneGraph(backend.graph))
  registerReaderRecovery(graph, bytes.buffer as ArrayBuffer, structuredClone(backend.checkpoint()))
  let request: FigSessionPopulateRequest | undefined
  const port = {
    onmessage: null as ((event: MessageEvent<FigSessionResponse>) => void) | null,
    start: () => undefined,
    close: () => undefined,
    postMessage: (message: FigSessionPopulateRequest) => {
      request = message
    }
  }
  const worker = {
    terminate: () => undefined,
    postMessage: () => undefined,
    onerror: null,
    onmessage: null
  }
  const client = createPopulationWorkerClient(graph, worker, port)
  const pageId = graph.getPages()[1].id
  try {
    const pending = client.populate(pageId)
    if (!request) throw new Error('Missing request')
    const result = backend.populate(pageId)
    graph.updateNode(graph.rootId, { name: 'Edited locally' })
    port.onmessage?.({
      data: {
        type: 'population-result',
        requestId: request.requestId,
        baseRevision: request.baseRevision,
        ...structuredClone(result)
      }
    } as MessageEvent<FigSessionResponse>)
    expect(await pending).toBeNull()
    expect(graph.getChildren(pageId)).toHaveLength(0)
    expect(recoverReaderPage(graph, pageId)).toBe(true)
    expect(graph.getChildren(pageId)[0].name).toBe('Second node')
    expect(graph.getNode(graph.rootId)?.name).toBe('Edited locally')
  } finally {
    client.terminate()
    releaseFigPopulationWorker(graph)
  }
})

test('page preparation recovers an invalidated replacement worker without replacing edited graph', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('RECTANGLE', source.getPages()[0].id, { name: 'First' })
  source.createNode('RECTANGLE', source.addPage('Second').id, { name: 'Second node' })
  source.createNode('RECTANGLE', source.addPage('Third').id, { name: 'Third node' })
  const bytes = await exportFigFile(source)
  const backend = openReaderSession(bytes.buffer as ArrayBuffer, 'first-page')
  const graph = deserializeSceneGraph(serializeSceneGraph(backend.graph))
  registerReaderRecovery(graph, bytes.buffer as ArrayBuffer, structuredClone(backend.checkpoint()))
  const secondResult = backend.populate(graph.getPages()[1].id)
  applyFigPopulationDelta(graph, structuredClone(secondResult.delta))
  if (!secondResult.checkpoint) throw new Error('Missing checkpoint')
  updateReaderRecovery(graph, structuredClone(secondResult.checkpoint))
  const secondNode = graph.getChildren(graph.getPages()[1].id)[0]
  registerFigPopulationWorker(graph, inertPopulationWorker())
  const editor = createEditor({ graph })
  const first = graph.getChildren(graph.getPages()[0].id)[0]
  graph.updateNode(first.id, { name: 'Edited' })
  try {
    await editor.preparePage(graph.getPages()[2].id)
    expect(graph.getChildren(graph.getPages()[1].id)).toEqual([secondNode])
    expect(graph.getChildren(graph.getPages()[2].id)[0].name).toBe('Third node')
    expect(editor.graph).toBe(graph)
    expect(graph.getNode(first.id)).toBe(first)
    expect(first.name).toBe('Edited')
    expect(graph.getChildren(graph.getPages()[1].id)[0].name).toBe('Second node')
  } finally {
    releaseFigPopulationWorker(graph)
  }
  expect(() => recoverReaderPage(graph, graph.getPages()[2].id)).toThrow('No reader recovery state')
})
