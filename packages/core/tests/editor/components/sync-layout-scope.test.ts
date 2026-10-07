import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createComponentSyncScheduler } from '#core/editor/component-sync'
import { createGraphEventSubscription } from '#core/editor/graph-events'

function createGraph() {
  const graph = new SceneGraph()
  const componentPage = graph.getPages()[0]
  const instancePage = graph.addPage('Instances')
  const unrelatedPage = graph.addPage('Unrelated')

  const component = graph.createNode('COMPONENT', componentPage.id, {
    name: 'Button',
    width: 200,
    height: 40,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 8,
    paddingLeft: 16
  })
  const label = graph.createNode('TEXT', component.id, { name: 'Label', text: 'Label', x: 0, y: 0 })
  const instance = expectDefined(
    graph.createInstance(component.id, instancePage.id, { x: 0, y: 0 }),
    'instance'
  )
  const unrelated = graph.createNode('FRAME', unrelatedPage.id, {
    name: 'Dashboard',
    width: 300,
    height: 200,
    layoutMode: 'VERTICAL',
    itemSpacing: 4
  })
  graph.createNode('TEXT', unrelated.id, { name: 'Title', text: 'Title', x: 0, y: 0 })

  return {
    graph,
    componentPage,
    instancePage,
    unrelatedPage,
    component,
    label,
    instance,
    unrelated
  }
}

describe('component sync layout scope', () => {
  test('new controls without instances do not lay out unrelated page content', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const unrelated = graph.createNode('FRAME', page.id, {
      width: 200,
      height: 200,
      layoutMode: 'VERTICAL'
    })
    const unrelatedChild = graph.createNode('RECTANGLE', unrelated.id, { y: 123, height: 10 })
    const control = graph.createNode('COMPONENT', page.id, { layoutMode: 'VERTICAL' })
    const label = graph.createNode('TEXT', control.id, { text: 'Control' })
    const scopes: (string | undefined)[] = []
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined,
      (innerGraph, scopeId) => {
        scopes.push(scopeId)
        computeAllLayouts(innerGraph, scopeId)
      }
    )
    scheduleComponentSync(label.id)
    await Promise.resolve()
    expect(scopes).toEqual([control.id])
    expect(unrelatedChild.y).toBe(123)
    expect(graph.getInstances(control.id)).toHaveLength(0)
  })

  test('recomputes the source and cross-page instance without unrelated page trees', async () => {
    const { graph, component, instance, componentPage, instancePage, unrelatedPage, label } =
      createGraph()
    const scopes: (string | undefined)[] = []
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined,
      (innerGraph, scopeId) => {
        scopes.push(scopeId)
        computeAllLayouts(innerGraph, scopeId)
      }
    )

    graph.updateNode(label.id, { text: 'Renamed label' })
    scheduleComponentSync(label.id)

    await Promise.resolve()
    expect([...scopes].sort()).toEqual([component.id, instance.id].sort())
    expect(scopes).not.toContain(componentPage.id)
    expect(scopes).not.toContain(instancePage.id)
    expect(scopes).not.toContain(unrelatedPage.id)
    expect(scopes).not.toContain(undefined)
  })

  test('an edit outside any component does no layout work', async () => {
    const { graph, unrelated } = createGraph()
    const scopes: (string | undefined)[] = []
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined,
      (innerGraph, scopeId) => {
        scopes.push(scopeId)
        computeAllLayouts(innerGraph, scopeId)
      }
    )

    graph.updateNode(unrelated.id, { width: 400 })
    scheduleComponentSync(unrelated.id)

    await Promise.resolve()
    expect(scopes).toEqual([])
  })

  test('resizes ancestor containers and their siblings while compacting shared scopes', async () => {
    const graph = new SceneGraph()
    const sourcePage = graph.getPages()[0]
    const instancePage = graph.addPage('Instances')
    const container = (pageId: string) =>
      graph.createNode('FRAME', pageId, {
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG',
        itemSpacing: 8
      })
    const sourceHost = container(sourcePage.id)
    const instanceHost = container(instancePage.id)
    const component = graph.createNode('COMPONENT', sourceHost.id, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    const label = graph.createNode('TEXT', component.id, {
      width: 100,
      height: 20,
      text: 'Label',
      textAutoResize: 'NONE'
    })
    const first = expectDefined(graph.createInstance(component.id, instanceHost.id))
    const second = expectDefined(graph.createInstance(component.id, instanceHost.id))
    const sibling = graph.createNode('RECTANGLE', instanceHost.id, { width: 30, height: 20 })
    computeAllLayouts(graph)
    const scopes: (string | undefined)[] = []
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined,
      (innerGraph, scopeId) => {
        scopes.push(scopeId)
        computeAllLayouts(innerGraph, scopeId)
      }
    )
    graph.updateNode(component.id, { paddingLeft: 12 })
    scheduleComponentSync(label.id)
    await Promise.resolve()
    expect([...scopes].sort()).toEqual([sourceHost.id, instanceHost.id].sort())
    expect(component.width).toBe(112)
    expect(sourceHost.width).toBe(112)
    expect(first.width).toBe(112)
    expect(second.x).toBe(120)
    expect(sibling.x).toBe(240)
    expect(instanceHost.width).toBe(270)
  })

  test('a cross-page instance still receives the component layout', async () => {
    const { graph, instance, component } = createGraph()
    const { scheduleComponentSync } = createComponentSyncScheduler(
      () => graph,
      () => undefined,
      computeAllLayouts
    )

    // Widen the component's padding, which moves its label; the instance must follow.
    const label = graph.getChildren(component.id)[0]
    if (!label) throw new Error('Expected a component child')
    graph.updateNode(label.id, { text: 'A much longer label' })
    scheduleComponentSync(label.id)

    await Promise.resolve()
    const instanceLabel = graph.getChildren(instance.id)[0]
    const componentLabel = graph.getChildren(component.id)[0]
    expect(instanceLabel).toBeDefined()
    expect(instanceLabel?.x).toBe(componentLabel?.x)
    expect(instanceLabel?.width).toBe(componentLabel?.width)
  })

  for (const moveComponent of [true, false]) {
    test(`a cross-page move of a ${moveComponent ? 'component' : 'source child'} lays out both parent containers`, async () => {
      const graph = new SceneGraph()
      const sourcePage = graph.getPages()[0]
      const targetPage = graph.addPage('Target')
      const oldParent = graph.createNode(moveComponent ? 'FRAME' : 'COMPONENT', sourcePage.id, {
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG',
        itemSpacing: 8
      })
      const nextParent = graph.createNode('FRAME', targetPage.id, {
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG',
        itemSpacing: 8
      })
      const moved = graph.createNode(moveComponent ? 'COMPONENT' : 'RECTANGLE', oldParent.id, {
        width: 100,
        height: 20
      })
      const remaining = graph.createNode('RECTANGLE', oldParent.id, { width: 30, height: 20 })
      graph.createNode('RECTANGLE', nextParent.id, { width: 20, height: 20 })
      computeAllLayouts(graph)
      const { scheduleComponentSync } = createComponentSyncScheduler(
        () => graph,
        () => undefined
      )
      const subscription = createGraphEventSubscription({
        getGraph: () => graph,
        getRenderers: () => [],
        scheduleComponentSync,
        requestRender: () => undefined,
        emitEditorEvent: () => undefined
      })
      subscription.subscribeToGraph()
      try {
        graph.reparentNode(moved.id, nextParent.id)
        await Promise.resolve()
        expect(oldParent.width).toBe(30)
        expect(remaining.x).toBe(0)
        expect(nextParent.width).toBe(128)
        expect(moved.x).toBe(28)
      } finally {
        subscription.unsubscribeFromGraph()
      }
    })
  }
})
