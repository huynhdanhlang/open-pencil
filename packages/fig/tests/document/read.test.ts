import { expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'
import { planComponentConstruction } from '#fig/document/components'
import { createFigDocumentSession, materializeDocument } from '#fig/document/materialize'
import { createDocumentReader } from '#fig/document/read'
import { indexRecords } from '#fig/instance-overrides/source-index'
import { deflateSync } from 'fflate'

import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { encodeMessage, getSchemaBytes, initCodec } from '@open-pencil/kiwi/fig/codec'
import { buildFigKiwi } from '@open-pencil/kiwi/fig/container'

test('reads pages independently through one index with cross-page component expansion', () => {
  const changes: NodeChange[] = [
    { guid: guid(1), type: 'DOCUMENT' },
    {
      guid: guid(2),
      type: 'CANVAS',
      name: 'Components',
      parentIndex: { guid: guid(1), position: 'b' }
    },
    {
      guid: guid(3),
      type: 'CANVAS',
      name: 'Design',
      parentIndex: { guid: guid(1), position: 'a' }
    },
    { guid: guid(4), type: 'SYMBOL', parentIndex: { guid: guid(2), position: 'a' } },
    {
      guid: guid(5),
      type: 'TEXT',
      parentIndex: { guid: guid(4), position: 'a' },
      textData: { characters: 'Label' }
    },
    {
      guid: guid(6),
      type: 'INSTANCE',
      parentIndex: { guid: guid(3), position: 'a' },
      symbolData: { symbolID: guid(4) }
    }
  ]
  const reader = createDocumentReader(changes)
  expect(reader.pages.map((page) => page.name)).toEqual(['Design', 'Components'])
  const page = reader.readPage('1:3')
  expect(page.children[0].mainComponentId).toBe('1:4')
  expect(page.children[0].children[0].properties.textData?.characters).toBe('Label')
  page.children[0].children[0].properties.opacity = 0.2
  expect(reader.readPage('1:3').children[0].children[0].properties.opacity).toBeUndefined()
  expect(reader.readPage('1:2').children[0].sourceId).toBe('1:4')
  const roots = [page, reader.readPage('1:2')]
  const reused = planComponentConstruction(
    roots,
    () => {
      throw new Error('Unexpected component re-expansion')
    },
    indexRecords(changes),
    reader.dependencyClosure.contentIds
  )
  expect(reused[0].occurrence).toBe(roots[1].children[0])
  const plan = reader.planComponents([page, reader.readPage('1:2')])
  expect(
    plan.map(({ sourceId, parentSourceId, pageSourceId }) => ({
      sourceId,
      parentSourceId,
      pageSourceId
    }))
  ).toEqual([{ sourceId: '1:4', parentSourceId: '1:2', pageSourceId: '1:2' }])
  expect(reader.planComponents([page]).map((component) => component.sourceId)).toEqual(['1:4'])
  const { graph, sources } = materializeDocument(changes)
  expect(graph.getPages().map((node) => node.name)).toEqual(['Design', 'Components'])
  const componentId = sources.get('1:4')
  const instanceId = sources.get('1:6')
  if (!componentId || !instanceId) throw new Error('Missing assembled nodes')
  expect(graph.getNode(instanceId)?.componentId).toBe(componentId)
  expect(graph.getNode(componentId)?.parentId).toBe(sources.get('1:2'))
  expect([...graph.getAllNodes()].filter((node) => node.type === 'COMPONENT')).toHaveLength(1)
  expect(graph.getChildren(instanceId)[0].text).toBe('Label')
  const exportedSources = reader.sourceRecords
  const exportedText = exportedSources.find((node) => node.guid?.localID === 5)
  if (!exportedText?.textData) throw new Error('Missing copied text')
  exportedText.textData.characters = 'Mutated snapshot'
  expect(reader.readPage('1:3').children[0].children[0].properties.textData?.characters).toBe(
    'Label'
  )
  expect(() => reader.readPage('1:4')).toThrow('Unknown page')
})

function ownershipShellChanges(): NodeChange[] {
  return [
    { guid: guid(1), type: 'CANVAS', name: 'Flow' },
    { guid: guid(2), type: 'CANVAS', name: 'Bank' },
    { guid: guid(3), type: 'SYMBOL', parentIndex: { guid: guid(2), position: '!' } },
    {
      guid: guid(4),
      type: 'TEXT',
      parentIndex: { guid: guid(3), position: '!' },
      textData: { characters: 'Label' }
    },
    { guid: guid(5), type: 'SYMBOL', parentIndex: { guid: guid(3), position: '"' } },
    {
      guid: guid(6),
      type: 'TEXT',
      parentIndex: { guid: guid(5), position: '!' },
      textData: { characters: 'Input' }
    },
    {
      guid: guid(9),
      type: 'TEXT',
      parentIndex: { guid: guid(5), position: '"' },
      textData: { characters: 'Counter' }
    },
    {
      guid: guid(7),
      type: 'TEXT',
      parentIndex: { guid: guid(3), position: '#' },
      textData: { characters: 'Helper' }
    },
    {
      guid: guid(8),
      type: 'INSTANCE',
      parentIndex: { guid: guid(1), position: '!' },
      symbolData: { symbolID: guid(5) }
    }
  ]
}

test('does not cache ownership-only component ancestors as complete definitions', () => {
  const changes = ownershipShellChanges()
  const reader = createDocumentReader(changes, new Set(['1:1']))
  const plan = reader.planComponents(reader.pages.map((page) => reader.readPage(page.id)))
  expect(plan.map((component) => component.sourceId)).toEqual(['1:5'])
  expect(plan[0].parentSourceId).toBe('1:3')
  const complete = reader.selectPages(new Set(['1:2']))
  const bankPlan = complete.planComponents([complete.readPage('1:2')])
  expect(
    bankPlan
      .find((component) => component.sourceId === '1:3')
      ?.occurrence.children.map((child) => child.sourceId)
  ).toEqual(['1:4', '1:5', '1:7'])
})

for (const firstPage of ['1:1', '1:2']) {
  for (const resume of [false, true]) {
    test(`retains nested master identity and sibling order after ${firstPage} first${resume ? ' and resume' : ''}`, async () => {
      await initCodec()
      const archive = buildFigKiwi(
        deflateSync(getSchemaBytes()),
        encodeMessage({ type: 'NODE_CHANGES', nodeChanges: ownershipShellChanges() })
      )
      const bytes = archive.slice().buffer
      let session = createFigDocumentSession(bytes)
      session.loadPage(firstPage)
      const before = new Map(session.checkpoint().sources)
      const root = before.get('1:5')
      const counter = before.get('1:9')
      if (!root || !counter) throw new Error('Missing nested master')
      session.graph.updateNode(root, { name: 'Edited nested master' })
      session.graph.reorderChild(counter, root, 0)
      if (resume)
        session = createFigDocumentSession(
          bytes,
          {},
          {
            graph: session.graph,
            checkpoint: session.checkpoint()
          }
        )
      session.loadPage(firstPage === '1:1' ? '1:2' : '1:1')
      const sources = new Map(session.checkpoint().sources)
      const sourceNodeId = (id: string): string => {
        const nodeId = sources.get(id)
        if (!nodeId) throw new Error(`Missing source ${id}`)
        return nodeId
      }
      const outer = sources.get('1:3')
      const instance = sources.get('1:8')
      if (!outer || !instance) throw new Error('Missing owners')
      expect(sources.get('1:5')).toBe(root)
      expect(session.graph.getNode(root)?.name).toBe('Edited nested master')
      expect(session.graph.getNode(root)?.parentId).toBe(outer)
      expect(session.graph.getNode(instance)?.componentId).toBe(root)
      expect(session.graph.getChildren(outer).map((node) => node.id)).toEqual(
        ['1:4', '1:5', '1:7'].map(sourceNodeId)
      )
      expect(session.graph.getChildren(root).map((node) => node.id)).toEqual(
        ['1:9', '1:6'].map(sourceNodeId)
      )
      session.graph.reorderChild(root, outer, 0)
      const edited = session.checkpoint()
      const restored = createFigDocumentSession(
        bytes,
        {},
        { graph: session.graph, checkpoint: edited }
      )
      expect(restored.graph.getChildren(outer).map((node) => node.id)).toEqual(
        ['1:5', '1:4', '1:7'].map(sourceNodeId)
      )
    })
  }
}
