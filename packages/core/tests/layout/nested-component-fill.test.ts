import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { exportFigFile, parseFigFile } from '#core/io/formats/fig'
import { computeLayout } from '#core/layout'

test.each([
  ['COMPONENT', 'FIXED'],
  ['COMPONENT', 'HUG'],
  ['FRAME', 'FIXED'],
  ['COMPONENT', 'FIXED', 'HUG']
] as const)(
  'nested %s with %s height follows live and saved enclosing instance sizes',
  async (type, primaryAxisSizing, counterAxisSizing = 'FILL') => {
    const graph = new SceneGraph()
    const source = graph.createNode('COMPONENT', graph.getPages()[0].id, {
      name: 'Focus',
      width: 752,
      height: 160,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const control = graph.createNode(type, source.id, {
      name: 'Textarea.Root',
      width: 752,
      height: 124,
      layoutMode: 'VERTICAL',
      primaryAxisSizing,
      counterAxisSizing,
      layoutAlignSelf: 'STRETCH',
      paddingLeft: 8,
      paddingRight: 8,
      fills: [
        { type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 }, opacity: 1, visible: true }
      ],
      derivedLayout: { width: 752, height: 124 }
    })
    for (const name of ['Input', 'Counter']) {
      graph.createNode('TEXT', control.id, {
        name,
        width: 736,
        height: 24,
        text: 'Request',
        textAutoResize: 'NONE',
        layoutAlignSelf: 'STRETCH',
        counterAxisSizing: 'FILL'
      })
    }
    const instance = graph.createInstance(source.id, graph.getPages()[0].id)
    if (!instance) throw new Error('Missing enclosing instance')
    const liveControl = graph.getChildren(instance.id)[0]
    for (const width of [358, 320, 358, 1000]) {
      graph.updateNode(instance.id, { width })
      computeLayout(graph, instance.id)
      expect(liveControl.width).toBe(width)
      expect(liveControl.height).toBe(124)
      expect(graph.getChildren(liveControl.id).map((node) => node.width)).toEqual([
        width - 16,
        width - 16
      ])
    }
    expect(liveControl.derivedLayout?.width).toBe(752)
    const bytes = await exportFigFile(graph, undefined, undefined, undefined, false, {
      rendering: 'none'
    })
    const restored = await parseFigFile(bytes.slice().buffer as ArrayBuffer, { populate: 'all' })
    const savedInstance = [...restored.nodes.values()].find((node) => node.type === 'INSTANCE')
    if (!savedInstance) throw new Error('Missing saved enclosing instance')
    const savedControl = restored.getChildren(savedInstance.id)[0]
    expect(savedControl.type).toBe(type)
    // Figma stores cross Fill as STRETCH; import restores FIXED axis sizing.
    expect(savedControl.counterAxisSizing).toBe(counterAxisSizing === 'HUG' ? 'HUG' : 'FIXED')
    expect(savedControl.layoutAlignSelf).toBe('STRETCH')
    const cachedWidth = savedControl.derivedLayout?.width
    for (const width of [1000, 358, 320, 358]) {
      restored.updateNode(savedInstance.id, { width })
      computeLayout(restored, savedInstance.id)
      expect(savedControl.width).toBe(width)
      expect(restored.getChildren(savedControl.id).map((node) => node.width)).toEqual([
        width - 16,
        width - 16
      ])
    }
    expect(savedControl.derivedLayout?.width).toBe(cachedWidth)
    const savedSource = [...restored.nodes.values()].find(
      (node) => node.name === 'Focus' && node.type === 'COMPONENT'
    )
    if (!savedSource) throw new Error('Missing saved source')
    const sourceControl = restored.getChildren(savedSource.id)[0]
    for (const width of [1000, 320]) {
      restored.updateNode(savedSource.id, { width })
      computeLayout(restored, savedSource.id)
      expect(sourceControl.width).toBe(width)
      expect(restored.getChildren(sourceControl.id).map((node) => node.width)).toEqual([
        width - 16,
        width - 16
      ])
    }
  }
)

test.each(['HORIZONTAL', 'VERTICAL'] as const)(
  'generated component stretch uses computed %s cross dimension but keeps fixed derived size',
  (layoutMode) => {
    const graph = new SceneGraph()
    const row = layoutMode === 'HORIZONTAL'
    const frame = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode,
      width: 320,
      height: 320,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const child = graph.createNode('COMPONENT', frame.id, {
      width: 752,
      height: 124,
      layoutAlignSelf: 'STRETCH',
      derivedLayout: { width: 752, height: 124 }
    })
    computeLayout(graph, frame.id)
    expect(row ? child.height : child.width).toBe(320)
    expect(row ? child.width : child.height).toBe(row ? 752 : 124)
    graph.updateNode(child.id, { layoutAlignSelf: 'CENTER' })
    computeLayout(graph, frame.id)
    expect(child.width).toBe(752)
    expect(child.height).toBe(124)
  }
)

test.each(['HORIZONTAL', 'VERTICAL'] as const)(
  'generated %s primary Fill overrides its intrinsic cache without changing the fixed cross axis',
  (layoutMode) => {
    const graph = new SceneGraph()
    const row = layoutMode === 'HORIZONTAL'
    const parent = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode,
      width: 320,
      height: 320,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const child = graph.createNode('COMPONENT', parent.id, {
      layoutMode,
      width: row ? 752 : 124,
      height: row ? 124 : 752,
      primaryAxisSizing: 'FILL',
      counterAxisSizing: 'FIXED',
      layoutGrow: 1,
      derivedLayout: row ? { width: 752 } : { height: 752 }
    })
    computeLayout(graph, parent.id)
    expect(row ? child.width : child.height).toBe(320)
    expect(row ? child.height : child.width).toBe(124)
    graph.updateNode(child.id, { layoutPositioning: 'ABSOLUTE', width: 80, height: 60 })
    computeLayout(graph, parent.id)
    expect([child.width, child.height]).toEqual([80, 60])
  }
)

test('inherited stretch resizes a generated nested Hug component without discarding its intrinsic height', () => {
  const graph = new SceneGraph()
  const parent = graph.createNode('FRAME', graph.getPages()[0].id, {
    width: 320,
    height: 160,
    layoutMode: 'VERTICAL',
    counterAxisAlign: 'STRETCH',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED'
  })
  const child = graph.createNode('COMPONENT', parent.id, {
    width: 752,
    height: 124,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    derivedLayout: { width: 752, height: 124 }
  })
  graph.createNode('RECTANGLE', child.id, { width: 100, height: 24 })
  computeLayout(graph, parent.id)
  expect([child.width, child.height]).toEqual([320, 124])
})

test('an unconstrained Hug parent keeps its stretched native child intrinsic width until constrained', () => {
  const graph = new SceneGraph()
  const parent = graph.createNode('FRAME', graph.getPages()[0].id, {
    width: 752,
    height: 160,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG'
  })
  const control = graph.createNode('COMPONENT', parent.id, {
    width: 752,
    height: 124,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    layoutAlignSelf: 'STRETCH',
    paddingLeft: 8,
    paddingRight: 8,
    derivedLayout: { width: 752, height: 124 }
  })
  const input = graph.createNode('TEXT', control.id, {
    width: 736,
    height: 80,
    text: 'Owned request',
    textAutoResize: 'NONE',
    layoutAlignSelf: 'STRETCH'
  })
  computeLayout(graph, parent.id)
  expect([parent.width, control.width, input.width]).toEqual([752, 752, 736])
  graph.updateNode(parent.id, { width: 358, counterAxisSizing: 'FIXED' })
  computeLayout(graph, parent.id)
  expect([parent.width, control.width, input.width]).toEqual([358, 358, 342])
})
