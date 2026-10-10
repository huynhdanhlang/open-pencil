import { expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io'
import { initCodec } from '@open-pencil/core/kiwi'
import { createFigDocumentSession } from '@open-pencil/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

import { serializeSceneGraph, deserializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import * as population from '#core/kiwi/fig/population/delta'
import { openReaderSession } from '#core/kiwi/fig/session/reader'
import {
  installFigMutationJournal,
  buildFigPopulationDelta,
  applyFigPopulationDelta
} from '#core/kiwi/fig/population/delta'

test('synchronous population transport needs only the receiver copy and preserves shared buffers', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const backing = new ArrayBuffer(8 * 1024 * 1024)
  new Uint8Array(backing).fill(7)
  const journal = installFigMutationJournal(graph)
  for (let i = 0; i < 2; i++) {
    const node = graph.createNode('TEXT', page.id, { textPicture: new Uint8Array(backing, 64+i*16, 8) })
    node.source.fig.rawNodeFields.borrowedRecord = new Uint8Array(backing, 128+i*16, 16)
  }
  const expected = buildFigPopulationDelta(graph, journal, [page.id])
  const channel = new MessageChannel()
  const received = new Promise<population.FigPopulationDelta>(resolve => {
    channel.port2.onmessage = event => resolve(event.data)
    channel.port2.start()
  })
  const clone = globalThis.structuredClone
  let copies = 0
  try {
    globalThis.structuredClone = ((...args: Parameters<typeof structuredClone>) => {
      copies++
      return clone(...args)
    }) as typeof structuredClone
    expect(population.withFigPopulationDelta(graph, journal, [page.id], delta => {
      channel.port1.postMessage(delta)
    })).toBeUndefined()
    globalThis.structuredClone = clone
    new Uint8Array(backing).fill(9)
    graph.createNode('TEXT', page.id, { text: 'After publication' })
    const delta = await received
    expect(delta).toEqual(expected)
    expect(copies).toBe(0)
    expect(delta.created).toHaveLength(2)
    const views = delta.created.flatMap(([,node]) => [node.textPicture!, node.source.fig.rawNodeFields.borrowedRecord as Uint8Array])
    expect(new Set(views.map(view => view.buffer)).size).toBe(1)
    expect(views[0].buffer).not.toBe(backing)
    expect(views.every(view => view[0]===7)).toBe(true)
    expect(delta.updated.find(([id])=>id===page.id)?.[1].childIds).toHaveLength(2)
  } finally {
    globalThis.structuredClone = clone
    journal.stop()
    channel.port1.close(); channel.port2.close()
  }
})

test('failed population publication restores the journal and leaves the reader usable', async () => {
  await initCodec()
  const graph = new SceneGraph()
  graph.createNode('TEXT', graph.addPage('Second').id, { text: 'Second' })
  graph.createNode('TEXT', graph.addPage('Third').id, { text: 'Third' })
  const reader = openReaderSession((await exportFigFile(graph)).slice().buffer, 'first-page')
  const second = reader.graph.getPages().find(page=>page.name==='Second')!
  expect(()=>reader.publishPopulation(second.id,()=>{throw new Error('Transport failed')})).toThrow('Transport failed')
  const clone = globalThis.structuredClone
  let copies = 0
  try {
    globalThis.structuredClone = ((...args: Parameters<typeof structuredClone>) => { copies++; return clone(...args) }) as typeof structuredClone
    reader.graph.updateNode(reader.graph.getChildren(second.id)[0].id, { name: 'After failure' })
    expect(copies).toBe(0)
  } finally { globalThis.structuredClone = clone }
  const third = reader.graph.getPages().find(page=>page.name==='Third')!
  expect(reader.populate(third.id).delta.created.some(([,node])=>node.text==='Third')).toBe(true)
})

test('population publication rejects recursive loads before they can mutate the borrowed response', async () => {
  await initCodec()
  const graph = new SceneGraph()
  graph.createNode('TEXT', graph.addPage('Second').id, { text: 'Second' })
  graph.createNode('TEXT', graph.addPage('Third').id, { text: 'Third' })
  const reader = openReaderSession((await exportFigFile(graph)).slice().buffer, 'first-page')
  const second = reader.graph.getPages().find(page=>page.name==='Second')!
  const third = reader.graph.getPages().find(page=>page.name==='Third')!
  const flags = reader.publishPopulation(second.id, ()=> {
    expect(()=>reader.populate(third.id)).toThrow('FIG page population already active')
    expect(reader.graph.getChildren(third.id)).toHaveLength(0)
  })
  expect(flags).toEqual({readerComplete:false,populationComplete:false})
  expect(reader.populate(third.id).populated).toBe(true)
})

test('population delta owns one shared backing across created nodes and changed fields', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const existing = graph.createNode('TEXT', page.id)
  const receiver = deserializeSceneGraph(serializeSceneGraph(graph))
  const backing = new ArrayBuffer(4 * 1024 * 1024)
  new Uint8Array(backing).fill(7)
  const journal = installFigMutationJournal(graph)
  const source = structuredClone(existing.source)
  source.fig.rawNodeFields.borrowedRecord = new Uint8Array(backing, 128, 16)
  graph.updateNode(existing.id, { textPicture: new Uint8Array(backing, 64, 8), source })
  for (let i = 0; i < 2; i++) {
    const node = graph.createNode('TEXT', page.id, {
      textPicture: new Uint8Array(backing, 256 + i * 16, 8)
    })
    node.source.fig.rawNodeFields.borrowedRecord = new Uint8Array(backing, 512 + i * 16, 16)
  }
  journal.stop()
  const delta = buildFigPopulationDelta(graph, journal, [page.id])
  const views = (payload: typeof delta) => [
    ...payload.created.flatMap(([, node]) => [
      node.textPicture!,
      node.source.fig.rawNodeFields.borrowedRecord as Uint8Array
    ]),
    ...payload.updated.flatMap(([, changes]) =>
      changes.textPicture
        ? [changes.textPicture, changes.source!.fig.rawNodeFields.borrowedRecord as Uint8Array]
        : []
    )
  ]
  const owned = new Set(views(delta).map((view) => view.buffer))
  expect([...owned].reduce((sum, buffer) => sum + buffer.byteLength, 0)).toBe(backing.byteLength)
  expect(owned.has(backing)).toBe(false)
  const transported = structuredClone(delta)
  expect(new Set(views(transported).map((view) => view.buffer)).size).toBe(1)
  new Uint8Array(backing).fill(9)
  expect(views(delta).every((view) => view[0] === 7)).toBe(true)
  applyFigPopulationDelta(receiver, transported)
  const received = delta.created.map(([id]) => receiver.getNode(id)!.textPicture!)
  received.push(receiver.getNode(existing.id)!.textPicture!)
  expect(new Set(received.map((view) => view.buffer)).size).toBe(1)
  received[0][0] = 11
  expect(views(delta).every((view) => view[0] === 7)).toBe(true)
})

test('new-reader page loads transfer through the worker delta contract', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'Transferred', name: 'Label' })
  const library = source.addPage('Library')
  const component = source.createNode('COMPONENT', library.id, { name: 'Shared' })
  source.createNode('TEXT', component.id, { text: 'Default' })
  source.createInstance(component.id, source.getPages()[0].id)
  source.createInstance(component.id, library.id)
  const bytes = await exportFigFile(source)
  const session = createFigDocumentSession(bytes.buffer as ArrayBuffer)
  const receiver = deserializeSceneGraph(serializeSceneGraph(session.graph))
  const pageId = session.graphPageId(session.pages[0].id)
  if (!pageId) throw new Error('Missing graph page')
  const journal = installFigMutationJournal(session.graph)
  try {
    session.loadPage(session.pages[0].id)
    const delta = buildFigPopulationDelta(session.graph, journal, [pageId])
    applyFigPopulationDelta(receiver, structuredClone(delta))
    expect(
      receiver
        .getChildren(pageId)
        .filter((node) => node.type === 'TEXT')
        .map((node) => node.text)
    ).toEqual(['Transferred'])
    const receivedComponent = [...receiver.getAllNodes()].find((node) => node.type === 'COMPONENT')
    if (!receivedComponent) throw new Error('Missing component dependency')
    const instance = receiver.getChildren(pageId).find((node) => node.type === 'INSTANCE')
    expect(instance?.componentId).toBe(receivedComponent.id)
    expect(receiver.instanceIndex.get(receivedComponent.id)?.has(instance?.id ?? '')).toBe(true)
    expect(receiver.getChildren(pageId).map((node) => node.id)).toEqual(
      session.graph.getChildren(pageId).map((node) => node.id)
    )
  } finally {
    journal.stop()
  }
  const existingComponent = [...receiver.getAllNodes()].find((node) => node.type === 'COMPONENT')
  if (!existingComponent) throw new Error('Missing shared component')
  receiver.updateNode(existingComponent.id, { name: 'Receiver edit' })
  const localInstance = receiver.createInstance(existingComponent.id, pageId)
  if (!localInstance) throw new Error('Missing locally created instance')
  const recoveryGraph = deserializeSceneGraph(serializeSceneGraph(receiver))
  const recoveredComponent = recoveryGraph.getNode(existingComponent.id)
  const resumed = createFigDocumentSession(
    bytes.buffer as ArrayBuffer,
    {},
    {
      graph: recoveryGraph,
      checkpoint: structuredClone(session.checkpoint())
    }
  )
  resumed.loadPage(resumed.pages[1].id)
  expect(recoveredComponent?.name).toBe('Receiver edit')
  expect(recoveryGraph.getNode(existingComponent.id)).toBe(recoveredComponent)
  expect([...recoveryGraph.getAllNodes()].filter((node) => node.type === 'COMPONENT')).toHaveLength(
    1
  )
  expect(recoveryGraph.instanceIndex.get(existingComponent.id)?.has(localInstance.id)).toBe(true)
  const secondJournal = installFigMutationJournal(session.graph)
  try {
    session.loadPage(session.pages[1].id)
    applyFigPopulationDelta(
      receiver,
      structuredClone(
        buildFigPopulationDelta(
          session.graph,
          secondJournal,
          session.graph.getPages().map((page) => page.id)
        )
      )
    )
    expect(receiver.getNode(existingComponent.id)).toBe(existingComponent)
    expect(existingComponent.name).toBe('Receiver edit')
    expect([...receiver.getAllNodes()].filter((node) => node.type === 'COMPONENT')).toHaveLength(1)
    expect(receiver.instanceIndex.get(existingComponent.id)?.size).toBe(3)
    expect(receiver.instanceIndex.get(existingComponent.id)?.has(localInstance.id)).toBe(true)
  } finally {
    secondJournal.stop()
  }
})
