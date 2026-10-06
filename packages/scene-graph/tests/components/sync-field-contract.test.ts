import { expect, test } from 'bun:test'

import { SceneGraph, setInstanceOverride } from '@open-pencil/scene-graph'

import { expectDefined } from '../helpers/assert'

test('updates existing child placement and text sizing without moving the instance root', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, { x: 10, y: 20 })
  const label = graph.createNode('TEXT', component.id, {
    text: 'Xem nhân vật',
    x: 44,
    y: 11,
    width: 88,
    textAutoResize: 'HEIGHT'
  })
  const instance = expectDefined(graph.createInstance(component.id, page.id, { x: 500, y: 600 }))
  const clone = graph.getChildren(instance.id)[0]
  graph.updateNode(label.id, { x: 49.5, y: 13, width: 101, textAutoResize: 'WIDTH_AND_HEIGHT' })
  graph.syncInstances(component.id)
  expect([clone.x, clone.y, clone.width, clone.textAutoResize]).toEqual([
    49.5,
    13,
    101,
    'WIDTH_AND_HEIGHT'
  ])
  expect([instance.x, instance.y]).toEqual([500, 600])
  graph.updateNode(clone.id, { x: 77, textAutoResize: 'NONE' })
  setInstanceOverride(instance.instanceOverrides, instance.id, clone.id, 'x', true)
  setInstanceOverride(instance.instanceOverrides, instance.id, clone.id, 'textAutoResize', true)
  graph.updateNode(label.id, { x: 52, y: 15 })
  graph.syncInstances(component.id)
  expect([clone.x, clone.y, clone.textAutoResize]).toEqual([77, 15, 'NONE'])
})

for (const protectedField of ['width', 'text'] as const) {
  test(`component synchronization preserves ${protectedField} without freezing other fields`, () => {
    const graph = new SceneGraph()
    const component = graph.createNode('COMPONENT', graph.getPages()[0].id)
    const source = graph.createNode('TEXT', component.id, {
      text: 'Source',
      visible: false,
      width: 80
    })
    const instance = expectDefined(graph.createInstance(component.id, graph.getPages()[0].id))
    const clone = graph.getChildren(instance.id)[0]
    graph.updateNode(clone.id, { text: 'Override', visible: true, width: 160 })
    setInstanceOverride(instance.instanceOverrides, instance.id, clone.id, protectedField, true)
    graph.syncInstances(component.id)
    expect(clone.text).toBe(protectedField === 'text' ? 'Override' : source.text)
    expect(clone.width).toBe(protectedField === 'width' ? 160 : 80)
    expect(clone.visible).toBe(false)
  })
}

test('component synchronization updates and removes opacity bindings while preserving a claimed width binding', () => {
  const graph = new SceneGraph()
  const component = graph.createNode('COMPONENT', graph.getPages()[0].id, {
    opacity: 0.5,
    boundVariables: { opacity: 'opacity-var' }
  })
  const instance = expectDefined(graph.createInstance(component.id, graph.getPages()[0].id))
  expect(instance.opacity).toBe(0.5)
  expect(instance.boundVariables.opacity).toBe('opacity-var')
  graph.updateNode(instance.id, {
    boundVariables: { ...instance.boundVariables, width: 'width-var' }
  })
  setInstanceOverride(
    instance.instanceOverrides,
    instance.id,
    instance.id,
    'boundVariables/width',
    true
  )
  graph.updateNode(component.id, { opacity: 1, boundVariables: {} })
  graph.syncInstances(component.id)
  expect(instance.boundVariables).toEqual({ width: 'width-var' })
  expect(instance.opacity).toBe(1)
})
