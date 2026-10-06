import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { exportFigFile, parseFigFile, populateFigPage } from '@open-pencil/core/io/formats/fig'
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

test('a fully opened single-page reader retires its mirror but keeps exact original Save', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'Only page' })
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(Buffer.from(await exportFigFile(graph)).equals(bytes)).toBe(true)
    const text = graph.getChildren(graph.getPages()[0].id)[0]
    graph.updateNode(text.id, { text: 'Edited after retirement' })
    expect(await requestOriginalArchive(graph)).toBeNull()
    const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    expect([...reopened.nodes.values()].some((n) => n.text === 'Edited after retirement')).toBe(
      true
    )
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

test('a multi-page mirror retires only when its manifest pages have loaded', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'First' })
  source.createNode('TEXT', source.addPage('Second').id, { text: 'Second' })
  source.createNode('TEXT', source.addPage('Third').id, { text: 'Third' })
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    const client = expectDefined(createFigPopulationWorker(graph))
    expect(await client.populate(graph.getPages()[1].id)).toBe(true)
    expect(canUseFigPopulationWorker(graph)).toBe(true)
    expect(await client.populate(graph.getPages()[2].id)).toBe(true)
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(Buffer.from(await exportFigFile(graph)).equals(bytes)).toBe(true)
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

test('completion retirement preserves unloaded internal content during an edited Save', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'Visible' })
  const internal = source.addPage('Internal resources')
  source.updateNode(internal.id, { internalOnly: true })
  source.createNode('RECTANGLE', internal.id, { name: 'Retained internal', width: 37 })
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    const unloaded = expectDefined(graph.getPages(true).find((p) => p.internalOnly))
    expect(graph.getChildren(unloaded.id)).toHaveLength(0)
    graph.updateNode(graph.getChildren(graph.getPages()[0].id)[0].id, { text: 'Edited visible' })
    const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const hidden = expectDefined(reopened.getPages(true).find((p) => p.internalOnly))
    expect(populateFigPage(reopened, hidden.id)).toBe(true)
    expect(reopened.getChildren(hidden.id).map((n) => [n.name, n.width])).toEqual([
      ['Retained internal', 37]
    ])
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

test('completion cancels an in-flight archive transport before replacing it with host bytes', async () => {
  const source = new SceneGraph()
  source.addPage('Second')
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    registerOriginalArchiveRequest(
      graph,
      () =>
        new Promise<Uint8Array>(() => {
          // Deliberately keep the old transport pending across its retirement.
        })
    )
    const pending = requestOriginalArchive(graph)
    const client = expectDefined(createFigPopulationWorker(graph))
    expect(await client.populate(graph.getPages()[1].id)).toBe(true)
    expect(await pending).toBeNull()
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(Buffer.from(expectDefined(await requestOriginalArchive(graph))).equals(bytes)).toBe(true)
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

for (const event of ['populate', 'terminated']) {
  test(`a real edit during ${event} telemetry cannot restore pre-edit archive access`, async () => {
    const source = new SceneGraph()
    source.createNode('TEXT', source.getPages()[0].id, { text: 'Original' })
    source.addPage('Second')
    const bytes = await exportFigFile(source)
    const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
    const listener = (message: Event) => {
      if ((message as CustomEvent).detail.event !== event) return
      graph.updateNode(graph.getChildren(graph.getPages()[0].id)[0].id, { text: 'Real live edit' })
    }
    globalThis.addEventListener('openpencil:fig-population-worker', listener)
    try {
      const client = expectDefined(createFigPopulationWorker(graph))
      expect(await client.populate(graph.getPages()[1].id)).toBe(true)
      expect(canUseFigPopulationWorker(graph)).toBe(false)
      expect(await requestOriginalArchive(graph)).toBeNull()
      const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
      expect([...reopened.nodes.values()].some((n) => n.text === 'Real live edit')).toBe(true)
    } finally {
      globalThis.removeEventListener('openpencil:fig-population-worker', listener)
      releaseFigPopulationWorker(graph)
    }
  }, 20000)
}

test('an edit by a cancelled archive waiter invalidates the new host provider', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'Original' })
  source.addPage('Second')
  const graph = await parseFigFileViaWorker((await exportFigFile(source)).slice().buffer, {
    populate: 'first-page'
  })
  try {
    registerOriginalArchiveRequest(
      graph,
      () =>
        new Promise<Uint8Array>(() => {
          // Hold this waiter until completion replaces its transport.
        })
    )
    const pending = requestOriginalArchive(graph).then(() => {
      graph.updateNode(graph.getChildren(graph.getPages()[0].id)[0].id, { text: 'Waiter edit' })
      return undefined
    })
    await expectDefined(createFigPopulationWorker(graph)).populate(graph.getPages()[1].id)
    await pending
    expect(await requestOriginalArchive(graph)).toBeNull()
    const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    expect([...reopened.nodes.values()].some((n) => n.text === 'Waiter edit')).toBe(true)
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

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
  source.addPage('Unloaded')
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
