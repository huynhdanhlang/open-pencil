import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { FigmaAPI } from '#core/figma-api'
import { getNode } from '#core/tools/read/nodes'

test('optional node layout context is bounded, read-only and omitted by default', () => {
  const graph = new SceneGraph()
  const api = new FigmaAPI(graph)
  const parent = graph.createNode('FRAME', api.currentPageId, { layoutMode: 'VERTICAL' })
  const child = graph.createNode('TEXT', parent.id, {
    layoutAlignSelf: 'STRETCH',
    derivedLayout: { width: 228, height: 24 }
  })
  const before = structuredClone(child)
  const ordinary = getNode.execute(api, { id: child.id, depth: 0 })
  expect(ordinary).not.toHaveProperty('layoutContext')
  const result = getNode.execute(api, { id: child.id, depth: 0, layout_context: true })
  expect(result).toMatchObject({
    layoutContext: {
      mode: 'NONE',
      parentMode: 'VERTICAL',
      alignSelf: 'STRETCH',
      derivedLayout: { width: 228, height: 24 }
    }
  })
  expect(child).toEqual(before)
})
