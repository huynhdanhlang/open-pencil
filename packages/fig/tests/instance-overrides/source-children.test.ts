import { expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'
import { checkpointComponent, restoreComponentCheckpoint } from '#fig/document/component/checkpoint'
import { materializeComponentClosure } from '#fig/instance-overrides/component-closure'
import { interpretComponent, interpretInstance } from '#fig/instance-overrides/interpret'
import { materializeInstance } from '#fig/instance-overrides/materialize-instance'
import {
  mapInstanceSourceChildren,
  reconcileOccurrenceStructure
} from '#fig/instance-overrides/source-children'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

function setup() {
  const changes: NodeChange[] = [
    { guid: guid(1), type: 'SYMBOL', name: 'Source' },
    { guid: guid(2), type: 'FRAME', name: 'Nested', parentIndex: { guid: guid(1), position: 'a' } },
    { guid: guid(3), type: 'TEXT', name: 'Removed', parentIndex: { guid: guid(2), position: 'a' } },
    {
      guid: guid(4),
      type: 'RECTANGLE',
      name: 'Kept',
      parentIndex: { guid: guid(2), position: 'b' }
    },
    { guid: guid(5), type: 'INSTANCE', symbolData: { symbolID: guid(1) } }
  ]
  const occurrence = interpretComponent(changes, '1:1')
  const target = interpretInstance(changes, '1:5')
  const graph = new SceneGraph()
  const materialized = materializeInstance(graph, graph.getPages()[0].id, occurrence, new Map())
  const checkpoint = checkpointComponent({ occurrence, materialized })
  const removed = [...materialized.nodes.values()].find((node) => node.name === 'Removed')
  const kept = [...materialized.nodes.values()].find((node) => node.name === 'Kept')
  if (!removed || !kept) throw new Error('Missing source fixture children')
  return { graph, occurrence, target, materialized, checkpoint, removed, kept }
}

for (const last of [false, true]) {
  test(`resumed nested source deletion reconciles ${last ? 'all' : 'one'} children before correspondence`, () => {
    const { graph, occurrence, target, materialized, checkpoint, removed, kept } = setup()
    graph.deleteNode(removed.id)
    if (last) graph.deleteNode(kept.id)
    const components = new Map([
      ['1:1', restoreComponentCheckpoint(graph, occurrence, structuredClone(checkpoint))]
    ])
    for (let pass = 0; pass < 2; pass++) {
      reconcileOccurrenceStructure(target, graph, components)
      const correspondence = mapInstanceSourceChildren(target, components)
      expect(target.children[0].children.map((child) => child.sourceId)).toEqual(
        last ? [] : ['1:4']
      )
      const result = materializeInstance(
        graph,
        graph.getPages()[0].id,
        target,
        new Map([['1:1', materialized.root.id]]),
        { sourceChildren: correspondence }
      )
      expect([...result.nodes.values()].some((node) => node.name === 'Removed')).toBe(false)
      expect([...result.nodes.values()].some((node) => node.name === 'Kept')).toBe(!last)
    }
  })
}

test('nested reconciliation preserves source order and does not prune instance-owned slot content', () => {
  const { graph, occurrence, target, materialized, checkpoint, removed, kept } = setup()
  if (!kept.parentId) throw new Error('Missing source parent')
  graph.reorderChild(kept.id, kept.parentId, 0)
  const components = new Map([['1:1', restoreComponentCheckpoint(graph, occurrence, checkpoint)]])
  reconcileOccurrenceStructure(target, graph, components)
  expect(target.children[0].children.map((child) => child.sourceId)).toEqual(['1:4', '1:3'])
  target.children[0].slotContentId = 'own-content'
  target.children[0].children[0].sourceId = 'own-child'
  graph.deleteNode(removed.id)
  reconcileOccurrenceStructure(target, graph, components)
  expect(target.children[0].children.map((child) => child.sourceId)).toEqual(['own-child', '1:3'])
  expect(() => mapInstanceSourceChildren(target, components)).not.toThrow()
  expect(graph.getNode(materialized.root.id)).toBe(materialized.root)
})

test('unknown or ambiguous source identities fail rather than being silently removed', () => {
  const { graph, occurrence, target, materialized } = setup()
  const components = new Map([['1:1', { occurrence, materialized }]])
  target.children[0].children[0].sourceId = 'unknown'
  expect(() => reconcileOccurrenceStructure(target, graph, components)).toThrow(
    'Missing source child'
  )
  target.children[0].children[0].sourceId = '1:3'
  occurrence.children[0].children.push(occurrence.children[0].children[0])
  expect(() => reconcileOccurrenceStructure(target, graph, components)).toThrow(
    'Ambiguous source child'
  )
})

test('nested instance swaps reconcile against the selected replacement source', () => {
  const changes: NodeChange[] = [
    { guid: guid(1), type: 'SYMBOL' },
    {
      guid: guid(2),
      type: 'INSTANCE',
      parentIndex: { guid: guid(1), position: 'a' },
      symbolData: { symbolID: guid(9) }
    },
    { guid: guid(9), type: 'SYMBOL', name: 'Original' },
    {
      guid: guid(10),
      type: 'TEXT',
      name: 'Original text',
      parentIndex: { guid: guid(9), position: 'a' }
    },
    { guid: guid(19), type: 'SYMBOL', name: 'Replacement' },
    {
      guid: guid(20),
      type: 'TEXT',
      name: 'Replacement kept',
      parentIndex: { guid: guid(19), position: 'a' }
    },
    {
      guid: guid(21),
      type: 'TEXT',
      name: 'Replacement removed',
      parentIndex: { guid: guid(19), position: 'b' }
    },
    {
      guid: guid(5),
      type: 'INSTANCE',
      symbolData: {
        symbolID: guid(1),
        symbolOverrides: [{ guidPath: { guids: [guid(2)] }, overriddenSymbolID: guid(19) }]
      }
    }
  ]
  const target = interpretInstance(changes, '1:5')
  const graph = new SceneGraph()
  const components = new Map(
    materializeComponentClosure(graph, graph.getPages()[0].id, changes, target)
  )
  const replacement = components.get('1:19')
  if (!replacement) throw new Error('Missing replacement')
  const checkpoint = checkpointComponent(replacement)
  const removed = [...replacement.materialized.nodes.values()].find(
    (node) => node.name === 'Replacement removed'
  )
  if (!removed) throw new Error('Missing replacement child')
  graph.deleteNode(removed.id)
  components.set('1:19', restoreComponentCheckpoint(graph, replacement.occurrence, checkpoint))
  reconcileOccurrenceStructure(target, graph, components)
  expect(target.children[0].mainComponentId).toBe('1:19')
  expect(target.children[0].children.map((child) => child.sourceId)).toEqual(['1:20'])
  expect(() => mapInstanceSourceChildren(target, components)).not.toThrow()
  expect(
    [...(components.get('1:9')?.materialized.nodes.values() ?? [])].some(
      (node) => node.name === 'Original text'
    )
  ).toBe(true)
})
