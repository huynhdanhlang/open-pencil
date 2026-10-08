import { expect, spyOn, test } from 'bun:test'

import {
  renderTreeRoots,
  finishRenderPlacement,
  resolveRenderPlacement
} from '@open-pencil/core/design-jsx'
import * as layout from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

test('rendering a root on a free canvas lays out its subtree without traversing unrelated roots twice', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const unrelated = graph.createNode('FRAME', page.id, {
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG'
  })
  graph.createNode('RECTANGLE', unrelated.id, { width: 75, height: 20 })
  const calls = spyOn(layout, 'computeAllLayouts')
  try {
    const placement = resolveRenderPlacement(graph, {}, page.id)
    const roots = await renderTreeRoots(
      graph,
      {
        type: 'frame',
        props: { name: 'Owned root', layout: 'HORIZONTAL', sizing: 'HUG' },
        children: [{ type: 'rectangle', props: { width: 40, height: 20 }, children: [] }]
      },
      placement
    )
    finishRenderPlacement(graph, roots, placement)
    expect(calls.mock.calls.map((call) => call[1])).not.toContain(page.id)
    expect(calls.mock.calls.map((call) => call[1])).not.toContain(unrelated.id)
    expect(graph.getNode(roots[0].id)?.childIds).toHaveLength(1)
  } finally {
    calls.mockRestore()
  }
})

test('replacement inside an imported resized instance preserves its sizing and overrides', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, {
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    width: 200,
    height: 60
  })
  graph.createNode('RECTANGLE', component.id, { width: 20, height: 20 })
  const instance = graph.createInstance(component.id, page.id)
  if (!instance) throw new Error('Missing owned instance')
  instance.source.format = 'fig'
  instance.source.editedFields = ['width', 'height']
  graph.updateNode(instance.id, { width: 400, height: 80 })
  instance.instanceOverrides.self.set('width', 400)
  instance.instanceOverrides.self.set('height', 80)
  const before = structuredClone(instance.instanceOverrides)
  const sourceBefore = structuredClone(component)
  const placement = resolveRenderPlacement(graph, { replace_id: instance.childIds[0] }, page.id)
  const roots = await renderTreeRoots(
    graph,
    { type: 'rectangle', props: { w: 'fill', h: 'fill' }, children: [] },
    placement
  )
  finishRenderPlacement(graph, roots, placement)
  expect([instance.width, instance.height]).toEqual([400, 80])
  expect(instance.instanceOverrides).toEqual(before)
  expect(graph.getNode(roots[0].id)?.width).toBe(400)
  expect(graph.getNode(roots[0].id)?.height).toBe(80)
  expect(component).toEqual(sourceBefore)
})
