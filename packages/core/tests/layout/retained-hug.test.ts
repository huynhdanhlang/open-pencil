import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { computeLayout } from '#core/layout'

test.each(['HORIZONTAL', 'VERTICAL'] as const)(
  'centers children inside retained %s Hug dimensions',
  (layoutMode) => {
    const graph = new SceneGraph()
    const row = layoutMode === 'HORIZONTAL'
    const frame = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode,
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER',
      counterAxisAlign: 'CENTER',
      width: row ? 548 : 48,
      height: row ? 48 : 548,
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 12,
      paddingBottom: 12,
      derivedLayout: row ? { width: 548 } : { height: 548 }
    })
    const child = graph.createNode('FRAME', frame.id, {
      width: row ? 224 : 24,
      height: row ? 24 : 224
    })
    computeLayout(graph, frame.id)
    expect(row ? frame.width : frame.height).toBe(548)
    expect(row ? child.x : child.y).toBe(162)
    // Removing retention must restore ordinary content-sized Hug behavior.
    graph.updateNode(frame.id, { derivedLayout: null })
    computeLayout(graph, frame.id)
    expect(row ? frame.width : frame.height).toBe(248)
    expect(row ? child.x : child.y).toBe(12)
  }
)
