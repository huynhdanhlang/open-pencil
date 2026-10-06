import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

import { parseFigFileViaWorker } from '#core/io/formats/fig/read'
import {
  canUseFigPopulationWorker,
  createFigPopulationWorker,
  registerOriginalArchiveRequest,
  releaseFigPopulationWorker,
  requestOriginalArchive
} from '#core/kiwi/fig/population/client'
import { recoverReaderPage } from '#core/kiwi/fig/session/document-state'

test('a live edit retires the imported worker while preserving unloaded content and editable Save', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'First' })
  source.createNode('TEXT', source.addPage('Second').id, { text: 'Unloaded content' })
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    expect(canUseFigPopulationWorker(graph)).toBe(true)
    const text = graph.getChildren(graph.getPages()[0].id)[0]
    graph.updateNode(text.id, { text: 'Live edit' })
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(recoverReaderPage(graph, graph.getPages()[1].id)).toBe(true)
    const saved = await exportFigFile(graph, undefined, undefined, undefined, false, {
      rendering: 'none'
    })
    const reopened = await parseFigFile(saved.slice().buffer)
    expect(
      [...reopened.getAllNodes()]
        .filter((n) => n.type === 'TEXT')
        .map((n) => n.text)
        .sort()
    ).toEqual(['Live edit', 'Unloaded content'])
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

test('reader failure retires both population and original-archive capabilities', async () => {
  const source = new SceneGraph()
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    const client = expectDefined(createFigPopulationWorker(graph))
    expect(await client.populate('missing-page')).toBeNull()
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(await requestOriginalArchive(graph)).toBeNull()
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

for (const cause of ['mutation', 'disposal'] as const) {
  test(`an archive request in flight resolves to fallback on ${cause}`, async () => {
    const graph = new SceneGraph()
    registerOriginalArchiveRequest(
      graph,
      () =>
        new Promise<Uint8Array>(() => {
          // Deliberately model an unresponsive worker transport.
        })
    )
    const pending = requestOriginalArchive(graph)
    if (cause === 'mutation') graph.updateNode(graph.rootId, { name: 'Live edit' })
    else releaseFigPopulationWorker(graph)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Archive request stuck on dead transport')), 500)
      })
      expect(await Promise.race([pending, timeout])).toBeNull()
    } finally {
      clearTimeout(timer)
      releaseFigPopulationWorker(graph)
    }
  })
}
