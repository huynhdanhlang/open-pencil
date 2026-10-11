import { expect, test } from 'bun:test'

import { SceneGraph, setInstanceOverride, type SceneNode } from '@open-pencil/scene-graph'

import { expectDefined } from '../helpers/assert'

test('existing children inherit changed layout-child fields while root placement and explicit overrides stay owned', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id)
  const source = graph.createNode('RECTANGLE', component.id)
  const instance = expectDefined(graph.createInstance(component.id, page.id))
  const child = graph.getChildren(instance.id)[0]
  graph.updateNode(instance.id, {
    layoutGrow: 4,
    layoutAlignSelf: 'MAX',
    layoutPositioning: 'ABSOLUTE'
  })
  graph.updateNode(source.id, {
    layoutGrow: 2,
    layoutAlignSelf: 'STRETCH',
    layoutPositioning: 'ABSOLUTE'
  })
  graph.syncInstances(component.id)
  expect([child.layoutGrow, child.layoutAlignSelf, child.layoutPositioning]).toEqual([
    2,
    'STRETCH',
    'ABSOLUTE'
  ])
  expect([instance.layoutGrow, instance.layoutAlignSelf, instance.layoutPositioning]).toEqual([
    4,
    'MAX',
    'ABSOLUTE'
  ])
  graph.updateNode(child.id, { layoutAlignSelf: 'CENTER' })
  setInstanceOverride(instance.instanceOverrides, instance.id, child.id, 'layoutAlignSelf', true)
  graph.updateNode(source.id, { layoutGrow: 3, layoutPositioning: 'AUTO' })
  graph.syncInstances(component.id)
  expect([child.layoutGrow, child.layoutAlignSelf, child.layoutPositioning]).toEqual([
    3,
    'CENTER',
    'AUTO'
  ])
})

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

test('a component edit reaches every field its instances do not override, as in Figma', () => {
  // Repeats a Figma desktop 126 script: move, rotate, and restyle the component's layers.
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const card = graph.createNode('COMPONENT', page, { width: 200, height: 100 })
  const dot = graph.createNode('RECTANGLE', card.id, {
    name: 'Dot',
    x: 170,
    y: 10,
    width: 20,
    height: 20,
    horizontalConstraint: 'MAX'
  })
  const bar = graph.createNode('RECTANGLE', card.id, {
    name: 'Bar',
    x: 20,
    y: 60,
    width: 100,
    height: 10,
    strokeWeight: 1
  })
  const plain = expectDefined(graph.createInstance(card.id, page))
  const wide = expectDefined(graph.createInstance(card.id, page, { width: 300 }))
  setInstanceOverride(wide.instanceOverrides, wide.id, wide.id, 'width', 300)
  const overridden = expectDefined(graph.createInstance(card.id, page))
  const overriddenBar = graph.getChildren(overridden.id)[1]
  graph.updateNode(overriddenBar.id, { strokeWeight: 6 })
  setInstanceOverride(overridden.instanceOverrides, overridden.id, overriddenBar.id, 'strokeWeight', 6)

  graph.updateNode(dot.id, { x: 150, y: 30, rotation: 30 })
  graph.updateNode(bar.id, { x: 40, strokeWeight: 3, strokeAlign: 'OUTSIDE', cornerSmoothing: 0.6 })
  graph.syncInstances(card.id)

  const read = (instance: SceneNode) => {
    const [copyDot, copyBar] = graph.getChildren(instance.id)
    return {
      dot: [copyDot.x, copyDot.y, copyDot.rotation],
      bar: [copyBar.x, copyBar.strokeWeight, copyBar.strokeAlign, copyBar.cornerSmoothing]
    }
  }
  expect(read(plain)).toEqual({ dot: [150, 30, 30], bar: [40, 3, 'OUTSIDE', 0.6] })
  // A wider instance places the right-pinned dot by its constraint.
  expect(read(wide).dot).toEqual([250, 30, 30])
  expect(read(overridden).bar).toEqual([40, 6, 'OUTSIDE', 0.6])
})

test('a layer in an auto layout flow takes its place from the layout, not the component', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const row = graph.createNode('COMPONENT', page, { layoutMode: 'HORIZONTAL', width: 100, height: 20 })
  const item = graph.createNode('RECTANGLE', row.id, { x: 0, y: 0, width: 20, height: 20 })
  const instance = expectDefined(graph.createInstance(row.id, page))
  const copy = graph.getChildren(instance.id)[0]
  graph.updateNode(copy.id, { x: 12 })
  graph.updateNode(item.id, { x: 30, cornerSmoothing: 0.6 })
  graph.syncInstances(row.id)
  expect([copy.x, copy.cornerSmoothing]).toEqual([12, 0.6])
})

test('restyled ranges reach instances, except one that overrides its text', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const label = graph.createNode('COMPONENT', page)
  const text = graph.createNode('TEXT', label.id, { text: 'Hello' })
  const plain = expectDefined(graph.createInstance(label.id, page))
  const instance = expectDefined(graph.createInstance(label.id, page))
  const copy = graph.getChildren(instance.id)[0]
  const runs = [{ start: 0, length: 2, style: { fontWeight: 700 } }]
  graph.updateNode(copy.id, { text: 'Hi there', styleRuns: runs })
  setInstanceOverride(instance.instanceOverrides, instance.id, copy.id, 'text', 'Hi there')
  const italic = [{ start: 0, length: 5, style: { italic: true } }]
  graph.updateNode(text.id, { styleRuns: italic })
  graph.syncInstances(label.id)
  expect(graph.getChildren(plain.id)[0].styleRuns).toEqual(italic)
  expect(copy.styleRuns).toEqual(runs)
})
