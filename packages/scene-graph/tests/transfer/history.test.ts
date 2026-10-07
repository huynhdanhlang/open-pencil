import { expect, test } from 'bun:test'

import {
  applyGraphTransfer,
  captureTransferredState,
  prepareGraphTransfer,
  SceneGraph
} from '@open-pencil/scene-graph'

import { expectDefined, getNodeOrThrow } from '../helpers/assert'

test('history captures post-placement geometry and separates reused image ownership', () => {
  const source = new SceneGraph(),
    target = new SceneGraph()
  const root = source.createNode('FRAME', source.getPages()[0].id)
  source.images.set('shared', new Uint8Array([1]))
  source.images.set('new', new Uint8Array([2]))
  target.images.set('shared', new Uint8Array([1]))
  const plan = prepareGraphTransfer({
    source,
    target,
    rootIds: [root.id],
    dependencyPageIds: [],
    parentId: target.getPages()[0].id
  })
  applyGraphTransfer(target, plan)
  target.updateNode(plan.rootIds[0], { x: 120, y: 60 })
  const snapshot = captureTransferredState(target, plan)
  expect(snapshot.nodes[0].props).toMatchObject({ x: 120, y: 60 })
  expect(plan.nodes[0].props.x).toBe(0)
  target.updateNode(plan.rootIds[0], { x: 200 })
  expect(snapshot.nodes[0].props.x).toBe(120)
  target.deleteNode(plan.rootIds[0])
  expect(() => captureTransferredState(target, plan)).toThrow('Missing transferred node')
})

test('transfer preflight, apply and history preserve one isolated shared FIG backing per forest', () => {
  const source = new SceneGraph(),
    target = new SceneGraph()
  const root = source.createNode('FRAME', source.getPages()[0].id)
  const backing = new ArrayBuffer(2 * 1024 * 1024)
  const originals = Array.from({ length: 8 }, (_, index) => {
    const node = source.createNode('RECTANGLE', root.id)
    const bytes = new Uint8Array(backing, index * 32, 16)
    bytes.fill(index + 1)
    node.source.fig.rawNodeFields = { bytes, view: new DataView(backing, index * 32 + 4, 8) }
    return node
  })
  const plan = prepareGraphTransfer({
    source,
    target,
    rootIds: [root.id],
    dependencyPageIds: [],
    parentId: target.getPages()[0].id
  })
  const sources = plan.nodes
    .slice(1)
    .map((entry) => expectDefined(entry.props.source, 'planned source'))
  const backings = (fields: typeof sources) =>
    new Set(fields.map((metadata) => (metadata.fig.rawNodeFields.bytes as Uint8Array).buffer))
  expect(backings(sources).size).toBe(1)
  expect(backings(sources).has(backing)).toBe(false)
  applyGraphTransfer(target, plan)
  const applied = plan.nodes.slice(1).map((entry) => getNodeOrThrow(target, entry.id).source)
  expect(backings(applied).size).toBe(1)
  expect([...backings(applied)][0]).not.toBe([...backings(sources)][0])
  const snapshot = captureTransferredState(target, plan)
  const saved = snapshot.nodes
    .slice(1)
    .map((entry) => expectDefined(entry.props.source, 'saved source'))
  expect(backings(saved).size).toBe(1)
  expect([...backings(saved)][0]).not.toBe([...backings(applied)][0])
  for (const [index, metadata] of saved.entries()) {
    const bytes = metadata.fig.rawNodeFields.bytes as Uint8Array
    const view = metadata.fig.rawNodeFields.view as DataView
    expect(bytes.byteOffset).toBe(index * 32)
    expect([...bytes]).toEqual(Array.from({ length: 16 }, () => index + 1))
    expect(view.buffer).toBe(bytes.buffer)
    expect(view.byteOffset).toBe(index * 32 + 4)
  }
  ;(applied[0].fig.rawNodeFields.bytes as Uint8Array).fill(99)
  expect((saved[0].fig.rawNodeFields.bytes as Uint8Array)[0]).toBe(1)
  expect((originals[0].source.fig.rawNodeFields.bytes as Uint8Array)[0]).toBe(1)
})
