import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { exportFigFile, parseFigFile, populateFigPage } from '@open-pencil/core/io/formats/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

import { parseFigFileViaWorker } from '#core/io/formats/fig/read'
import {
  canUseFigPopulationWorker,
  createFigPopulationWorker,
  registerFigPopulationWorker,
  registerOriginalArchiveRequest,
  releaseFigPopulationWorker,
  requestOriginalArchive
} from '#core/kiwi/fig/population/client'
import {
  recoverReaderPage,
  hasPendingReaderPages,
  readerExportState
} from '#core/kiwi/fig/session/document-state'

test('an edited graph retires its obsolete reader immediately without stopping the archive worker', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const node = graph.createNode('RECTANGLE', page.id)
  const other = graph.addPage('Unloaded')
  const messages: Array<{ type: string }> = []
  let stopped = 0
  const worker = {
    terminate: () => {
      stopped++
    },
    postMessage: () => undefined,
    onerror: null,
    onmessage: null
  }
  const port = {
    postMessage: (message: { type: string }) => {
      messages.push(message)
    },
    start: () => undefined,
    close: () => {
      throw new Error('Archive port must stay open')
    },
    onmessage: null
  }
  registerFigPopulationWorker(graph, worker as Worker, port as MessagePort, () => {
    stopped++
  })
  const client = expectDefined(createFigPopulationWorker(graph))
  graph.withLayoutMutations(() => graph.updateNode(node.id, { x: 10 }))
  expect(messages).toHaveLength(0)
  const pending = client.populate(other.id)
  expect(messages.map((m) => m.type)).toEqual(['populate'])
  graph.updateNode(node.id, { name: 'Actual edit' })
  expect(messages.map((m) => m.type)).toEqual(['populate', 'retire'])
  expect(await pending).toBeNull()
  expect(canUseFigPopulationWorker(graph)).toBe(false)
  expect(stopped).toBe(0)
  graph.updateNode(node.id, { name: 'Second edit' })
  expect(messages.map((m) => m.type)).toEqual(['populate', 'retire'])
})

test('a fully opened single-page reader retires its mirror but keeps exact original Save', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'Only page' })
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(hasPendingReaderPages(graph)).toBe(false)
    expect(readerExportState(graph)).toBeUndefined()
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
    expect(hasPendingReaderPages(graph)).toBe(false)
    expect(readerExportState(graph)).toBeUndefined()
    expect(Buffer.from(await exportFigFile(graph)).equals(bytes)).toBe(true)
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

test('visible completion retires the mirror but preserves pending internal-page recovery', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'Visible' })
  const internal = source.addPage('Internal resources')
  source.updateNode(internal.id, { internalOnly: true })
  source.createNode('RECTANGLE', internal.id, { name: 'Retained internal', width: 37 })
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(hasPendingReaderPages(graph)).toBe(true)
    const unloaded = expectDefined(graph.getPages(true).find((p) => p.internalOnly))
    expect(graph.getChildren(unloaded.id)).toHaveLength(0)
    expect(recoverReaderPage(graph, unloaded.id)).toBe(true)
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(hasPendingReaderPages(graph)).toBe(false)
    expect(readerExportState(graph)).toBeUndefined()
    graph.updateNode(graph.getChildren(graph.getPages()[0].id)[0].id, { text: 'Edited visible' })
    const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const hidden = expectDefined(reopened.getPages(true).find((p) => p.internalOnly))
    populateFigPage(reopened, hidden.id)
    expect(reopened.getChildren(hidden.id).map((n) => [n.name, n.width])).toEqual([
      ['Retained internal', 37]
    ])
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

test('hidden-page recovery after mirror retirement filters a deleted component checkpoint', async () => {
  const source = new SceneGraph()
  const component = source.createNode('COMPONENT', source.getPages()[0].id, { name: 'Deleted master' })
  source.createNode('TEXT', component.id, { text: 'Removed component content' })
  const internal = source.addPage('Hidden resources')
  source.updateNode(internal.id, { internalOnly: true })
  source.createNode('RECTANGLE', internal.id, { name: 'Retained hidden content', width: 37 })
  const graph = await parseFigFileViaWorker((await exportFigFile(source)).slice().buffer, {
    populate: 'first-page'
  })
  try {
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(hasPendingReaderPages(graph)).toBe(true)
    const loaded = expectDefined([...graph.nodes.values()].find(node => node.name === 'Deleted master'))
    graph.deleteNode(loaded.id)
    const hidden = expectDefined(graph.getPages(true).find(page => page.internalOnly))
    expect(recoverReaderPage(graph, hidden.id)).toBe(true)
    expect(hasPendingReaderPages(graph)).toBe(false)
    const bytes = await exportFigFile(graph, undefined, undefined, undefined, false, { rendering: 'none' })
    const reopened = await parseFigFile(bytes.slice().buffer)
    const reopenedHidden = expectDefined(reopened.getPages(true).find(page => page.internalOnly))
    populateFigPage(reopened, reopenedHidden.id)
    expect([...reopened.nodes.values()].some(node => node.name === 'Deleted master')).toBe(false)
    expect(reopened.getChildren(reopenedHidden.id).map(node => [node.name, node.width])).toEqual([
      ['Retained hidden content', 37]
    ])
  } finally {
    releaseFigPopulationWorker(graph)
  }
}, 20000)

test('completion keeps an in-flight archive request and the shared archive transport valid', async () => {
  const source = new SceneGraph()
  source.addPage('Second')
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    let finish: () => void = () => undefined
    let held = true
    registerOriginalArchiveRequest(
      graph,
      () =>
        held
          ? new Promise<Uint8Array>((resolve) => {
              finish = () => { held = false; resolve(bytes) }
            })
          : Promise.resolve(bytes)
    )
    const pending = requestOriginalArchive(graph)
    const client = expectDefined(createFigPopulationWorker(graph))
    expect(await client.populate(graph.getPages()[1].id)).toBe(true)
    finish()
    expect(Buffer.from(expectDefined(await pending)).equals(bytes)).toBe(true)
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

test('an edit by an archive waiter after completion invalidates original archive access', async () => {
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'Original' })
  source.addPage('Second')
  const graph = await parseFigFileViaWorker((await exportFigFile(source)).slice().buffer, {
    populate: 'first-page'
  })
  try {
    let finish: () => void = () => undefined
    registerOriginalArchiveRequest(
      graph,
      () =>
        new Promise<Uint8Array>((resolve) => {
          finish = () => resolve(new Uint8Array())
        })
    )
    const pending = requestOriginalArchive(graph).then(() => {
      graph.updateNode(graph.getChildren(graph.getPages()[0].id)[0].id, { text: 'Waiter edit' })
      return undefined
    })
    await expectDefined(createFigPopulationWorker(graph)).populate(graph.getPages()[1].id)
    finish()
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

test('a failed page lookup retires population while preserving the immutable original archive', async () => {
  const source = new SceneGraph()
  source.addPage('Unloaded')
  const bytes = await exportFigFile(source)
  const graph = await parseFigFileViaWorker(bytes.slice().buffer, { populate: 'first-page' })
  try {
    const client = expectDefined(createFigPopulationWorker(graph))
    expect(await client.populate('missing-page')).toBeNull()
    expect(canUseFigPopulationWorker(graph)).toBe(false)
    expect(hasPendingReaderPages(graph)).toBe(true)
    expect(Buffer.from(expectDefined(await requestOriginalArchive(graph))).equals(bytes)).toBe(true)
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
