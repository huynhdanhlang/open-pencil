import { describe, expect, spyOn, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import * as layout from '#core/layout'
import { createLayoutRunner } from '#core/layout/mutations'

function pageId(graph: SceneGraph): string {
  return graph.getPages()[0].id
}

describe('mutation layout reconciliation', () => {
  test('adding and deleting a root on a free page never reflows unrelated roots', async () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const unrelated = graph.createNode('FRAME', page, { layoutMode: 'HORIZONTAL' })
    graph.createNode('RECTANGLE', unrelated.id, { width: 30, height: 20 })
    const calls = spyOn(layout, 'computeAllLayouts')
    const runner = createLayoutRunner(() => graph)
    try {
      const root = await runner.runMutationWithLayout(() => {
        const node = graph.createNode('FRAME', page, {
          layoutMode: 'HORIZONTAL',
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'HUG'
        })
        graph.createNode('RECTANGLE', node.id, { width: 40, height: 20 })
        return node
      }, page)
      expect(root.width).toBe(40)
      expect(calls.mock.calls.map((call) => call[1])).not.toContain(page)
      expect(calls.mock.calls.map((call) => call[1])).not.toContain(unrelated.id)
      calls.mockClear()
      await runner.runMutationWithLayout(() => graph.deleteNode(root.id), page)
      expect(calls).not.toHaveBeenCalled()
      expect(graph.getNode(unrelated.id)).toBe(unrelated)
    } finally {
      calls.mockRestore()
    }
  })
  test('reflows the previous parent after deletion', async () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const parent = graph.createNode('FRAME', page, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    const first = graph.createNode('RECTANGLE', parent.id, { width: 40, height: 20 })
    graph.createNode('RECTANGLE', parent.id, { width: 60, height: 20 })
    const { runLayoutForNode, runMutationWithLayout } = createLayoutRunner(() => graph)
    runLayoutForNode(parent.id)
    expect(parent.width).toBe(100)

    await runMutationWithLayout(() => graph.deleteNode(first.id), page)

    expect(parent.width).toBe(60)
  })

  test('reflows old and new parents after reparenting', async () => {
    const graph = new SceneGraph()
    const page = pageId(graph)
    const left = graph.createNode('FRAME', page, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    const right = graph.createNode('FRAME', page, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    const child = graph.createNode('RECTANGLE', left.id, { width: 40, height: 20 })
    const { runLayoutForNode, runMutationWithLayout } = createLayoutRunner(() => graph)
    runLayoutForNode(left.id)

    await runMutationWithLayout(() => graph.reparentNode(child.id, right.id), page)

    expect(left.width).toBe(0)
    expect(right.width).toBe(40)
  })
})
