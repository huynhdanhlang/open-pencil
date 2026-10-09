import { describe, expect, test } from 'bun:test'

import { renderTree } from '@open-pencil/core/design-jsx'
import type { TreeNode } from '@open-pencil/design-jsx'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('renderTree onNode', () => {
  test.each([
    { w: 864, h: 486 },
    { w: 432, h: 243 },
    { width: 864, height: 486 }
  ])(
    'inline SVG keeps a non-square coordinate box on every vector path (%j)',
    async (dimensions) => {
      const graph = new SceneGraph()
      const rendered = await renderTree(graph, {
        type: 'svg',
        props: { viewBox: '0 0 864 486', ...dimensions },
        children: [
          {
            type: 'path',
            props: { d: 'M0 0 L864 486', fill: 'none', stroke: '#00cc88' },
            children: []
          }
        ]
      })
      const frame = graph.getNode(rendered.id)!
      const vector = graph.getChildren(frame.id)[0]
      const expected = [dimensions.w ?? dimensions.width, dimensions.h ?? dimensions.height]
      expect([frame.width, frame.height]).toEqual(expected)
      expect([vector.width, vector.height]).toEqual(expected)
      expect(vector.vectorNetwork?.vertices.map(({ x, y }) => [x, y])).toEqual([[0, 0], expected])
    }
  )
  test('reports every element with the layer rendered from it', async () => {
    const graph = new SceneGraph()
    const text: TreeNode = {
      type: 'text',
      props: { name: 'Title' },
      children: ['Hi'],
      source: { line: 2 }
    }
    const root: TreeNode = {
      type: 'frame',
      props: { name: 'Card' },
      children: [text],
      source: { line: 1 }
    }
    const seen: Array<[number | undefined, string]> = []

    const result = await renderTree(graph, root, {
      onNode: (tree, node) => seen.push([tree.source?.line, node.name])
    })

    expect(seen).toEqual([
      [2, 'Title'],
      [1, 'Card']
    ])
    expect(graph.getNode(result.id)?.name).toBe('Card')
  })
})
