import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { captureHelperSnapshot } from '@/app/ai/agents/context'

test('snapshot captures selected nodes without mutation and rejects other pages', async () => {
  const graph = new SceneGraph()
  const page = graph.addPage('Review')
  const other = graph.addPage('Other')
  const card = graph.createNode('FRAME', page.id, { name: 'Review card', width: 320, height: 200 })
  const outsider = graph.createNode('FRAME', other.id)
  const before = structuredClone([...graph.getAllNodes()])
  const snapshot = await captureHelperSnapshot(
    graph,
    { document_id: 'tab-test', page_id: page.id },
    [card.id],
    { provider: 'acp:codex', requested_model: 'configured' }
  )
  expect(snapshot.context).toContain('Review card')
  expect(snapshot.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect([...graph.getAllNodes()]).toEqual(before)
  let error = ''
  try {
    await captureHelperSnapshot(
      graph,
      { document_id: 'tab-test', page_id: page.id },
      [outsider.id],
      { provider: 'acp:codex', requested_model: null }
    )
  } catch (cause) {
    error = String(cause)
  }
  expect(error).toContain('invalid_target')
})

test('snapshot rejects oversized subtrees before serializing them', async () => {
  const graph = new SceneGraph()
  const page = graph.addPage('Review')
  const frame = graph.createNode('FRAME', page.id)
  for (let i = 0; i < 200; i++) graph.createNode('RECTANGLE', frame.id)
  let error = ''
  try {
    await captureHelperSnapshot(graph, { document_id: 'tab-test', page_id: page.id }, [frame.id], {
      provider: 'acp:codex',
      requested_model: null
    })
  } catch (cause) {
    error = String(cause)
  }
  expect(error).toContain('context_too_large')
})
