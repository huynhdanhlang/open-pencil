import { describe, test, expect } from 'bun:test'

import {
  CommittedGraphEventError,
  SceneGraph,
  UndoManager,
  type SceneNode
} from '@open-pencil/scene-graph'

import { getNodeOrThrow } from '../helpers/assert'

test('committed graph delivery failures retain Undo/Redo transitions and complete batch replay', () => {
  const graph = new SceneGraph()
  const undo = new UndoManager()
  const a = graph.createNode('RECTANGLE', graph.getPages()[0].id)
  const b = graph.createNode('RECTANGLE', graph.getPages()[0].id)
  const unbind = graph.onNodeEvents({
    updated: () => {
      throw new Error('renderer unavailable')
    }
  })
  const setX = (node: SceneNode, x: number) =>
    graph.withBufferedEvents(() => graph.updateNode(node.id, { x }))
  undo.beginBatch('two moves')
  undo.record({ label: 'a', inverse: () => setX(a, 0), forward: () => setX(a, 10) })
  undo.record({ label: 'b', inverse: () => setX(b, 0), forward: () => setX(b, 20) })
  undo.commitBatch()
  a.x = 10
  b.x = 20
  expect(() => undo.undo()).toThrow(CommittedGraphEventError)
  expect([a.x, b.x]).toEqual([0, 0])
  expect(undo.diagnostics).toEqual({ undo: 0, redo: 1, batches: 0 })
  expect(() => undo.redo()).toThrow(CommittedGraphEventError)
  expect([a.x, b.x]).toEqual([10, 20])
  expect(undo.diagnostics).toEqual({ undo: 1, redo: 0, batches: 0 })
  unbind()
  undo.undo()
  expect([a.x, b.x]).toEqual([0, 0])
})

test('preflight replay failure keeps its original history entry', () => {
  const undo = new UndoManager()
  undo.record({
    label: 'invalid',
    inverse: () => {
      throw new Error('invalid snapshot')
    },
    forward: () => {}
  })
  expect(() => undo.undo()).toThrow('invalid snapshot')
  expect(undo.diagnostics).toEqual({ undo: 1, redo: 0, batches: 0 })
})

test('a failed batch restores completed members before a safe retry', () => {
  const undo = new UndoManager()
  let first = 0
  let second = 0
  let unavailable = true
  undo.beginBatch('two actions')
  undo.record({
    label: 'first',
    inverse: () => {
      first--
    },
    forward: () => {
      first++
    }
  })
  undo.record({
    label: 'second',
    inverse: () => {
      second--
    },
    forward: () => {
      if (unavailable) throw new Error('target unavailable')
      second++
    }
  })
  undo.commitBatch()
  first = 1
  second = 1
  undo.undo()
  expect(() => undo.redo()).toThrow('target unavailable')
  expect([first, second]).toEqual([0, 0])
  expect(undo.diagnostics).toEqual({ undo: 0, redo: 1, batches: 0 })
  unavailable = false
  undo.redo()
  expect([first, second]).toEqual([1, 1])
  expect(undo.diagnostics).toEqual({ undo: 1, redo: 0, batches: 0 })
  undo.undo()
  expect([first, second]).toEqual([0, 0])
})

test('a failed older batch permits newer Redo without skipping changes on retry', () => {
  const undo = new UndoManager()
  let a = 1
  let b = 1
  let unavailable = true
  undo.beginBatch('older')
  undo.record({
    label: 'b',
    forward: () => {
      b = 1
    },
    inverse: () => {
      if (unavailable) throw new Error('target unavailable')
      b = 0
    }
  })
  undo.record({
    label: 'a',
    forward: () => {
      a = 1
    },
    inverse: () => {
      a = 0
    }
  })
  undo.commitBatch()
  undo.execute({
    label: 'newer',
    forward: () => {
      a = 2
    },
    inverse: () => {
      a = 1
    }
  })
  undo.undo()
  expect(() => undo.undo()).toThrow('target unavailable')
  expect([a, b]).toEqual([1, 1])
  undo.redo()
  undo.undo()
  unavailable = false
  undo.undo()
  expect([a, b]).toEqual([0, 0])
})

test('committed command errors record completed work without rolling the batch back', () => {
  const graph = new SceneGraph()
  const undo = new UndoManager()
  const node = graph.createNode('RECTANGLE', graph.getPages()[0].id)
  const unbind = graph.onNodeEvents({
    updated: () => {
      throw new Error('renderer unavailable')
    }
  })
  const setX = (x: number) => graph.withBufferedEvents(() => graph.updateNode(node.id, { x }))
  expect(() =>
    undo.runBatch('move', () =>
      undo.execute({ label: 'move', forward: () => setX(12), inverse: () => setX(0) })
    )
  ).toThrow(CommittedGraphEventError)
  expect(node.x).toBe(12)
  expect(undo.diagnostics).toEqual({ undo: 1, redo: 0, batches: 0 })
  unbind()
  undo.undo()
  expect(node.x).toBe(0)
})

// ---------------------------------------------------------------------------
// SceneGraph + UndoManager — integration (updateNodeWithUndo pattern)
// ---------------------------------------------------------------------------

describe('SceneGraph + UndoManager — updateNode undo integration', () => {
  function makeSetup() {
    const graph = new SceneGraph()
    const undo = new UndoManager()
    const pageId = graph.getPages()[0].id

    function updateWithUndo(
      id: string,
      changes: Partial<Parameters<SceneGraph['updateNode']>[1]>,
      label: string
    ) {
      const node = getNodeOrThrow(graph, id)
      const previous = Object.fromEntries(
        (Object.keys(changes) as Array<keyof SceneNode>).map((k) => [k, node[k]])
      )
      graph.updateNode(id, changes)
      undo.push({
        label,
        forward: () => graph.updateNode(id, changes),
        inverse: () => graph.updateNode(id, previous as Parameters<SceneGraph['updateNode']>[1])
      })
    }

    return { graph, undo, pageId, updateWithUndo }
  }

  test('update then undo restores previous value', () => {
    const { graph, undo, pageId, updateWithUndo } = makeSetup()
    const id = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 100, height: 100 }).id

    updateWithUndo(id, { x: 200 }, 'move')
    expect(getNodeOrThrow(graph, id).x).toBe(200)

    undo.undo()
    expect(getNodeOrThrow(graph, id).x).toBe(0)
  })

  test('update → undo → redo restores updated value', () => {
    const { graph, undo, pageId, updateWithUndo } = makeSetup()
    const id = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 100, height: 100 }).id

    updateWithUndo(id, { width: 250 }, 'resize')
    undo.undo()
    expect(getNodeOrThrow(graph, id).width).toBe(100)
    undo.redo()
    expect(getNodeOrThrow(graph, id).width).toBe(250)
  })

  test('multiple updates undo in LIFO order', () => {
    const { graph, undo, pageId, updateWithUndo } = makeSetup()
    const id = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 100, height: 100 }).id

    updateWithUndo(id, { x: 10 }, 'step1')
    updateWithUndo(id, { x: 20 }, 'step2')
    updateWithUndo(id, { x: 30 }, 'step3')

    undo.undo()
    expect(getNodeOrThrow(graph, id).x).toBe(20)
    undo.undo()
    expect(getNodeOrThrow(graph, id).x).toBe(10)
    undo.undo()
    expect(getNodeOrThrow(graph, id).x).toBe(0)
  })

  test('new action after undo clears redo stack', () => {
    const { graph, undo, pageId, updateWithUndo } = makeSetup()
    const id = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 100, height: 100 }).id

    updateWithUndo(id, { x: 100 }, 'a')
    updateWithUndo(id, { x: 200 }, 'b')
    undo.undo()
    expect(undo.canRedo).toBe(true)

    // new action should kill redo
    updateWithUndo(id, { x: 300 }, 'c')
    expect(undo.canRedo).toBe(false)
    expect(getNodeOrThrow(graph, id).x).toBe(300)
  })

  test('undo does not affect other nodes', () => {
    const { graph, undo, pageId, updateWithUndo } = makeSetup()
    const a = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 50, height: 50 }).id
    const b = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 50, height: 50 }).id

    updateWithUndo(a, { x: 100 }, 'move a')
    updateWithUndo(b, { x: 200 }, 'move b')

    undo.undo() // undoes move b
    expect(getNodeOrThrow(graph, b).x).toBe(0)
    expect(getNodeOrThrow(graph, a).x).toBe(100) // a unaffected

    undo.undo() // undoes move a
    expect(getNodeOrThrow(graph, a).x).toBe(0)
  })

  test('multi-field update: all fields restored on undo', () => {
    const { graph, undo, pageId, updateWithUndo } = makeSetup()
    const id = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 100, height: 100 }).id

    updateWithUndo(id, { x: 50, y: 75, width: 200, height: 300 }, 'big move')
    const after = getNodeOrThrow(graph, id)
    expect(after.x).toBe(50)
    expect(after.y).toBe(75)
    expect(after.width).toBe(200)
    expect(after.height).toBe(300)

    undo.undo()
    const restored = getNodeOrThrow(graph, id)
    expect(restored.x).toBe(0)
    expect(restored.y).toBe(0)
    expect(restored.width).toBe(100)
    expect(restored.height).toBe(100)
  })

  test('batch: multiple updates undo as one', () => {
    const { graph, undo, pageId } = makeSetup()
    const id = graph.createNode('RECTANGLE', pageId, { x: 0, y: 0, width: 100, height: 100 }).id

    undo.beginBatch('batch move')
    undo.apply({
      label: 'x',
      forward: () => graph.updateNode(id, { x: 10 }),
      inverse: () => graph.updateNode(id, { x: 0 })
    })
    undo.apply({
      label: 'y',
      forward: () => graph.updateNode(id, { y: 20 }),
      inverse: () => graph.updateNode(id, { y: 0 })
    })
    undo.commitBatch()

    expect(getNodeOrThrow(graph, id).x).toBe(10)
    expect(getNodeOrThrow(graph, id).y).toBe(20)
    expect(undo.undoLabel).toBe('batch move')

    undo.undo()
    expect(getNodeOrThrow(graph, id).x).toBe(0)
    expect(getNodeOrThrow(graph, id).y).toBe(0)
  })
})
