import { expect, test } from 'bun:test'

import { loadPageTransaction } from '#fig/document/load-transaction'
import type { AssemblyState } from '#fig/document/materialize'

import { SceneGraph } from '@open-pencil/scene-graph'

test('failed page mutation restores changed existing instance indexes and object identity', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const a = graph.createNode('COMPONENT', page.id)
  const b = graph.createNode('COMPONENT', page.id)
  const instance = graph.createInstance(a.id, page.id)
  if (!instance) throw new Error('Missing instance')
  const state: AssemblyState = {
    graph,
    sources: new Map([['instance', instance.id]]),
    components: new Map(),
    componentIds: new Map(),
    savedSizeNodes: new Set()
  }
  let events = 0
  graph.onNodeEvents({
    updated: () => {
      events++
    }
  })
  expect(() =>
    loadPageTransaction(
      state,
      {
        contentIds: new Set(['instance']),
        ancestorIds: new Set(),
        missingIds: new Set(),
        missingComponentIds: new Set(),
        missingSlotContentIds: new Set(),
        externalPreferredKeys: new Set()
      },
      () => {
        state.sources.set('partial', instance.id)
        state.componentIds.set('partial', b.id)
        state.savedSizeNodes.add(instance.id)
        graph.createNode('INSTANCE', page.id, { componentId: b.id })
        graph.updateNode(instance.id, { componentId: b.id, name: 'Partial' })
        throw new Error('Fail after update')
      }
    )
  ).toThrow('Fail after update')
  expect(graph.getNode(instance.id)).toBe(instance)
  expect(instance.componentId).toBe(a.id)
  expect(graph.instanceIndex.get(a.id)?.has(instance.id)).toBe(true)
  expect(graph.instanceIndex.get(b.id)?.has(instance.id) ?? false).toBe(false)
  expect(state.sources.has('partial')).toBe(false)
  expect(state.componentIds.has('partial')).toBe(false)
  expect(state.savedSizeNodes.has(instance.id)).toBe(false)
  expect(graph.getChildren(page.id)).toHaveLength(3)
  expect(events).toBe(0)
})

test('page rollback owns one shared FIG backing store and preserves subviews across candidates', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const backing = new ArrayBuffer(2 * 1024 * 1024)
  const shared = { marker: 'original' }
  const nodes = Array.from({ length: 8 }, (_, index) => {
    const node = graph.createNode('RECTANGLE', page.id)
    const bytes = new Uint8Array(backing, index * 32, 16)
    bytes.fill(index + 1)
    node.source.fig.rawNodeFields = {
      bytes,
      view: new DataView(backing, index * 32 + 4, 8),
      shared
    }
    return node
  })
  const state: AssemblyState = {
    graph,
    sources: new Map(nodes.map((node, index) => [String(index), node.id])),
    components: new Map(),
    componentIds: new Map(),
    savedSizeNodes: new Set()
  }
  state.sources.set('missing', 'missing-node')
  state.sources.set('page', page.id)
  const closure = {
    contentIds: new Set(state.sources.keys()),
    ancestorIds: new Set(['0', 'page']),
    missingIds: new Set<string>(),
    missingComponentIds: new Set<string>(),
    missingSlotContentIds: new Set<string>(),
    externalPreferredKeys: new Set<string>()
  }
  expect(() =>
    loadPageTransaction(state, closure, () => {
      new Uint8Array(backing).fill(99)
      shared.marker = 'mutated'
      for (const node of nodes) graph.updateNode(node.id, { name: 'Partial' })
      throw new Error('Rollback shared source')
    })
  ).toThrow('Rollback shared source')
  const restoredBuffers = new Set<ArrayBufferLike>()
  const restoredObjects = new Set<unknown>()
  for (const [index, node] of nodes.entries()) {
    expect(graph.getNode(node.id)).toBe(node)
    expect(node.name).toBe('Rectangle')
    const fields = node.source.fig.rawNodeFields
    const bytes = fields.bytes as Uint8Array
    const view = fields.view as DataView
    restoredBuffers.add(bytes.buffer)
    restoredObjects.add(fields.shared)
    expect(bytes.buffer).not.toBe(backing)
    expect(bytes.byteOffset).toBe(index * 32)
    expect(bytes.byteLength).toBe(16)
    expect([...bytes]).toEqual(Array.from({ length: 16 }, () => index + 1))
    expect(view.buffer).toBe(bytes.buffer)
    expect(view.byteOffset).toBe(index * 32 + 4)
    expect(view.byteLength).toBe(8)
    expect(fields.shared).toEqual({ marker: 'original' })
    expect(fields.shared).not.toBe(shared)
  }
  expect(restoredBuffers.size).toBe(1)
  expect(restoredObjects.size).toBe(1)
  expect(new Uint8Array(backing)[0]).toBe(99)
  const source = nodes[0].source
  loadPageTransaction(state, closure, () => graph.updateNode(nodes[0].id, { name: 'Complete' }))
  expect(nodes[0].source).toBe(source)
  expect(nodes[0].name).toBe('Complete')
})
