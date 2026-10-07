import { expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'
import { checkpointComponent, restoreComponentCheckpoint } from '#fig/document/component/checkpoint'
import { materializeDocument } from '#fig/document/materialize'
import { occurrences } from '#fig/instance-overrides/occurrence/path'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

test('constructs nested definitions once under their actual component parent', () => {
  const changes: NodeChange[] = [
    { guid: guid(1), type: 'DOCUMENT' },
    { guid: guid(2), type: 'CANVAS', parentIndex: { guid: guid(1), position: '!' } },
    { guid: guid(3), type: 'SYMBOL', parentIndex: { guid: guid(2), position: 'a' } },
    { guid: guid(4), type: 'SYMBOL', parentIndex: { guid: guid(3), position: 'a' } },
    {
      guid: guid(5),
      type: 'TEXT',
      parentIndex: { guid: guid(4), position: 'a' },
      textData: { characters: 'Nested' }
    },
    {
      guid: guid(6),
      type: 'INSTANCE',
      parentIndex: { guid: guid(2), position: 'b' },
      symbolData: { symbolID: guid(4) }
    }
  ]
  const { graph, sources } = materializeDocument(changes)
  const outer = sources.get('1:3')
  const inner = sources.get('1:4')
  const instance = sources.get('1:6')
  if (!outer || !inner || !instance) throw new Error('Missing nodes')
  expect(graph.getNode(inner)?.parentId).toBe(outer)
  expect(graph.getNode(instance)?.componentId).toBe(inner)
  expect([...graph.getAllNodes()].filter((node) => node.type === 'COMPONENT')).toHaveLength(2)
})

for (const selected of [false, true]) {
  test(`nested definitions retain instance owners and overrides (${selected ? 'selected' : 'all'} pages)`, () => {
    const changes: NodeChange[] = [
      { guid: guid(1), type: 'DOCUMENT' },
      { guid: guid(2), type: 'CANVAS', parentIndex: { guid: guid(1), position: '!' } },
      {
        guid: guid(3),
        type: 'SYMBOL',
        name: 'Outer',
        parentIndex: { guid: guid(2), position: 'a' }
      },
      {
        guid: guid(4),
        type: 'SYMBOL',
        name: 'Inner',
        parentIndex: { guid: guid(3), position: 'a' }
      },
      {
        guid: guid(5),
        type: 'INSTANCE',
        name: 'Option',
        parentIndex: { guid: guid(4), position: 'a' },
        symbolData: {
          symbolID: guid(10),
          symbolOverrides: [{ guidPath: { guids: [guid(11)] }, textData: { characters: 'Chosen' } }]
        }
      },
      {
        guid: guid(6),
        type: 'INSTANCE',
        name: 'Placed outer',
        parentIndex: { guid: guid(2), position: 'b' },
        symbolData: { symbolID: guid(3) }
      },
      {
        guid: guid(10),
        type: 'SYMBOL',
        name: 'Item',
        parentIndex: { guid: guid(2), position: 'c' }
      },
      {
        guid: guid(11),
        type: 'TEXT',
        name: 'Title',
        parentIndex: { guid: guid(10), position: 'a' },
        textData: { characters: 'Default' }
      }
    ]
    const { graph, sources, components } = materializeDocument(changes, [], {
      pageIds: selected ? new Set(['1:2']) : undefined
    })
    const outer = components.get('1:3')
    const inner = components.get('1:4')
    if (!outer || !inner) throw new Error('Missing nested definitions')
    const innerOccurrence = outer.occurrence.children[0]
    for (const occurrence of occurrences(outer.occurrence))
      expect(outer.materialized.nodes.has(occurrence)).toBe(true)
    expect(outer.materialized.nodes.get(innerOccurrence)).toBe(inner.materialized.root)
    const nestedOption = outer.materialized.nodes.get(innerOccurrence.children[0])
    expect(nestedOption).toBe(inner.materialized.nodes.get(inner.occurrence.children[0]))
    if (!nestedOption) throw new Error('Missing nested option')
    expect(graph.getChildren(nestedOption.id)[0].text).toBe('Chosen')
    const placedId = sources.get('1:6')
    if (!placedId) throw new Error('Missing outer instance')
    const placedOption = graph.getChildren(graph.getChildren(placedId)[0].id)[0]
    expect(placedOption.type).toBe('INSTANCE')
    expect(placedOption.componentId).toBe(components.get('1:10')?.materialized.root.id)
    expect(graph.getChildren(placedOption.id)[0].text).toBe('Chosen')
    const count = graph.nodes.size
    const checkpoint = checkpointComponent(outer)
    const restored = restoreComponentCheckpoint(
      graph,
      structuredClone(outer.occurrence),
      checkpoint
    )
    expect([...restored.materialized.nodes.values()]).toEqual([
      ...outer.materialized.nodes.values()
    ])
    expect(graph.nodes.size).toBe(count)
    expect(graph.getChildren(inner.materialized.root.id).map((node) => node.id)).toEqual([
      nestedOption.id
    ])
  })
}
