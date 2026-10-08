import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createLayerTreeEvents } from '#vue/primitives/LayerTree/events'
import { buildLayerTreeModel } from '#vue/primitives/LayerTree/model'

test('displayed tree batches async graph edits, flushes selection and cancels stale frames', async () => {
  const originalRequest = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 0
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++nextId, callback)
    return nextId
  }
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id)
  }
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const editor = createEditor({ graph })
  let builds = 0
  let deferring = true
  let model = buildLayerTreeModel(graph, page)
  const events = createLayerTreeEvents(
    editor,
    () => {
      builds++
      model = buildLayerTreeModel(editor.graph, editor.state.currentPageId)
    },
    () => undefined,
    (ids) => {
      for (const id of ids) expect(model.byId.has(id)).toBe(true)
    },
    () => deferring
  )
  try {
    let last = ''
    for (let i = 0; i < 20; i++) {
      last = graph.createNode('RECTANGLE', page).id
      await Promise.resolve()
      const queued = [...frames.values()]
      frames.clear()
      for (const callback of queued) callback(0)
    }
    expect(builds).toBe(0)
    expect(frames.size).toBe(1)
    editor.select([last])
    expect(builds).toBe(1)
    expect(model.items).toHaveLength(20)
    expect(frames.size).toBe(0)
    graph.createNode('RECTANGLE', page)
    deferring = false
    const completed = [...frames.values()]
    frames.clear()
    for (const callback of completed) callback(0)
    expect(model.items).toHaveLength(21)
    expect(builds).toBe(2)
    const replacement = new SceneGraph()
    editor.replaceGraph(replacement)
    expect(model.items).toHaveLength(0)
    expect(frames.size).toBe(0)
    replacement.createNode('RECTANGLE', replacement.getPages()[0].id)
    const stale = [...frames.values()][0]
    events.dispose()
    const before = builds
    stale(0)
    expect(builds).toBe(before)
    expect(frames.size).toBe(0)
  } finally {
    events.dispose()
    editor.dispose()
    globalThis.requestAnimationFrame = originalRequest
    globalThis.cancelAnimationFrame = originalCancel
  }
})
