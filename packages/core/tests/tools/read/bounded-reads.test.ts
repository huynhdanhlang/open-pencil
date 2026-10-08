import { expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { FigmaAPI } from '#core/figma-api'
import { getComponents } from '#core/tools/read/components'
import { queryNodes } from '#core/tools/read/query'

test('component limit stops before unrelated descendants while retaining preorder then final sorting', async () => {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const page = graph.getPages()[0]
  const first = graph.createNode('COMPONENT', page.id, { name: 'Beta' })
  const second = graph.createNode('COMPONENT', first.id, { name: 'Alpha' })
  const tail = graph.createNode('FRAME', page.id)
  for (let i = 0; i < 1000; i++) graph.createNode('RECTANGLE', tail.id)
  const reads = spyOn(graph, 'getNode')
  try {
    expect(await getComponents.execute(figma, { source: 'document', limit: 1 })).toMatchObject({
      count: 1,
      components: [{ id: first.id }]
    })
    expect(reads.mock.calls.some(([id]) => id === tail.id)).toBe(false)
    expect(await getComponents.execute(figma, { source: 'document', limit: 2 })).toMatchObject({
      components: [{ id: second.id }, { id: first.id }]
    })
    expect(
      await getComponents.execute(figma, { source: 'document', name: 'ALPHA', limit: 1 })
    ).toMatchObject({ components: [{ id: second.id }] })
  } finally {
    reads.mockRestore()
  }
})

test('default XPath tool targets exact current page ID when page names collide', async () => {
  const graph = new SceneGraph()
  const first = graph.getPages()[0]
  graph.updateNode(first.id, { name: 'Same name' })
  const figma = new FigmaAPI(graph)
  const other = figma.createPage()
  other.name = 'Same name'
  figma.currentPage = other
  graph.createNode('RECTANGLE', first.id, { name: 'Other page node' })
  const exact = graph.createNode('RECTANGLE', other.id, { name: 'Target page node' })
  expect(await queryNodes.execute(figma, { selector: '//RECTANGLE', limit: 10 })).toMatchObject({
    count: 1,
    nodes: [{ id: exact.id }]
  })
  expect(
    await queryNodes.execute(figma, { selector: '//RECTANGLE', page: 'Same name', limit: 10 })
  ).toMatchObject({ count: 2 })
})

test('document component discovery retains imported internal page masters', async () => {
  const graph = new SceneGraph()
  const page = graph.addPage('Imported masters')
  graph.updateNode(page.id, { internalOnly: true })
  const master = graph.createNode('COMPONENT', page.id, { name: 'Internal master' })
  const figma = new FigmaAPI(graph)
  expect(await getComponents.execute(figma, { source: 'document', limit: 1 })).toMatchObject({
    components: [{ id: master.id }]
  })
})
