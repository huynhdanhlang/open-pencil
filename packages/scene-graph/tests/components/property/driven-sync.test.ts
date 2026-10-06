import { expect, test } from 'bun:test'

import {
  applyComponentPropertyValue,
  rescaleNodeTree,
  SceneGraph,
  setInstanceOverride
} from '@open-pencil/scene-graph'

function graphWithAssignedLabel() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'NavItem',
    componentPropertyDefinitions: [
      { id: '207:1', name: 'Label', type: 'TEXT', defaultValue: 'Default' }
    ]
  })
  const label = graph.createNode('TEXT', component.id, {
    name: 'Label',
    text: 'Default',
    componentPropertyReferences: [{ propertyId: '207:1', field: 'TEXT' }]
  })
  const instance = graph.createInstance(component.id, page.id)
  if (!instance) throw new Error('Missing instance')
  return { graph, component, label, instance }
}

/**
 * A component states the default for a field a property drives; the enclosing instance's
 * assignment decides the value. Synchronising must not copy the default over it.
 */
test('synchronizing leaves a field the enclosing instance assigns alone', () => {
  const { graph, component, instance } = graphWithAssignedLabel()
  const clone = graph.getChildren(instance.id)[0]
  graph.updateNode(instance.id, { componentPropertyAssignments: { '207:1': 'Assigned' } })
  graph.updateNode(clone.id, { text: 'Assigned' })

  graph.syncInstances(component.id)

  expect(graph.getNode(clone.id)?.text).toBe('Assigned')
})

test('synchronizing still carries the default to an instance that assigns nothing', () => {
  const { graph, component, label, instance } = graphWithAssignedLabel()
  const clone = graph.getChildren(instance.id)[0]

  graph.updateNode(label.id, { text: 'Edited default' })
  graph.syncInstances(component.id)

  expect(graph.getNode(clone.id)?.text).toBe('Edited default')
})

/** Only the referenced field is left alone; the rest of the component edit still lands. */
test('synchronizing carries other fields of a property-driven layer', () => {
  const { graph, component, label, instance } = graphWithAssignedLabel()
  const clone = graph.getChildren(instance.id)[0]
  graph.updateNode(instance.id, { componentPropertyAssignments: { '207:1': 'Assigned' } })
  graph.updateNode(clone.id, { text: 'Assigned' })

  graph.updateNode(label.id, { opacity: 0.5 })
  graph.syncInstances(component.id)

  expect(graph.getNode(clone.id)?.text).toBe('Assigned')
  expect(graph.getNode(clone.id)?.opacity).toBe(0.5)
})

/** Property IDs are document-authored strings, so one may collide with an Object prototype key. */
test('a property id shared with an Object prototype key is not read as an assignment', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'NavItem',
    componentPropertyDefinitions: [
      { id: 'toString', name: 'Label', type: 'TEXT', defaultValue: 'Default' }
    ]
  })
  const label = graph.createNode('TEXT', component.id, {
    name: 'Label',
    text: 'Default',
    componentPropertyReferences: [{ propertyId: 'toString', field: 'TEXT' }]
  })
  const instance = graph.createInstance(component.id, page.id)
  if (!instance) throw new Error('Missing instance')
  const clone = graph.getChildren(instance.id)[0]

  graph.updateNode(label.id, { text: 'Edited default' })
  graph.syncInstances(component.id)

  expect(graph.getNode(clone.id)?.text).toBe('Edited default')
})

function graphWithAssignedSwap() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const fill = (r: number, g: number) => [
    { type: 'SOLID' as const, color: { r, g, b: 0, a: 1 }, opacity: 1, visible: true }
  ]
  const draft = graph.createNode('COMPONENT', page.id, {
    name: 'Draft',
    width: 120,
    height: 50,
    fills: fill(0, 1)
  })
  const selected = graph.createNode('COMPONENT', page.id, {
    name: 'Selected',
    width: 150,
    height: 60,
    fills: fill(1, 0.5)
  })
  const definition = {
    id: 'swap.choice',
    name: 'Choice',
    type: 'INSTANCE_SWAP' as const,
    defaultValue: draft.id,
    preferredValues: [draft.id, selected.id]
  }
  const host = graph.createNode('COMPONENT', page.id, {
    name: 'Host',
    componentPropertyDefinitions: [definition]
  })
  const opener = graph.createInstance(draft.id, host.id, {
    x: 12,
    y: 8,
    componentPropertyReferences: [{ propertyId: definition.id, field: 'INSTANCE_SWAP' }]
  })
  const instance = graph.createInstance(host.id, page.id)
  if (!opener || !instance) throw new Error('Missing swap fixture')
  applyComponentPropertyValue(graph, instance.id, definition, selected.id)
  const child = graph.getChildren(instance.id)[0]
  return { graph, host, selected, instance, child }
}

test('host synchronization keeps the selected nested component appearance and size', () => {
  const { graph, host, selected, child } = graphWithAssignedSwap()
  expect(child.fills).toEqual(selected.fills)
  for (let pass = 0; pass < 2; pass++) {
    graph.syncInstances(host.id)
    expect(child.componentId).toBe(selected.id)
    expect(child.fills).toEqual(selected.fills)
    expect([child.width, child.height]).toEqual([150, 60])
    expect([child.x, child.y]).toEqual([12, 8])
  }
})

test('host synchronization preserves an explicit paint override on the swapped child', () => {
  const { graph, host, instance, child } = graphWithAssignedSwap()
  const fills = [{ ...child.fills[0], color: { r: 0, g: 0, b: 1, a: 1 } }]
  graph.updateNode(child.id, { fills })
  setInstanceOverride(instance.instanceOverrides, instance.id, child.id, 'fills', true)
  graph.syncInstances(host.id)
  expect(child.fills).toEqual(fills)
})

test('host synchronization preserves the nested instance own paint override', () => {
  const { graph, host, child } = graphWithAssignedSwap()
  const fills = [{ ...child.fills[0], color: { r: 0, g: 0, b: 1, a: 1 } }]
  graph.updateNode(child.id, { fills })
  setInstanceOverride(child.instanceOverrides, child.id, child.id, 'fills', true)
  graph.syncInstances(host.id)
  expect(child.fills).toEqual(fills)
})

test('host synchronization carries selected master edits in occurrence coordinates', () => {
  const { graph, host, selected, instance, child } = graphWithAssignedSwap()
  rescaleNodeTree(graph, instance.id, 2)
  graph.updateNode(selected.id, {
    width: 160,
    height: 70,
    paddingLeft: 8,
    boundVariables: { paddingLeft: 'selected.padding' },
    variableBindingScales: { paddingLeft: 1 }
  })
  graph.syncInstances(host.id)
  expect([child.width, child.height, child.paddingLeft]).toEqual([320, 140, 16])
  expect([child.x, child.y]).toEqual([24, 16])
  expect(child.componentScale).toBe(2)
  expect(child.boundVariables).toEqual({ paddingLeft: 'selected.padding' })
  expect(child.variableBindingScales).toEqual({ paddingLeft: 2 })
})

test('an unassigned imported master link does not protect the old appearance', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0].id
  const draft = graph.createNode('COMPONENT', page, {
    fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const other = graph.createNode('COMPONENT', page, {
    fills: [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const host = graph.createNode('COMPONENT', page)
  const opener = graph.createInstance(draft.id, host.id)
  const instance = graph.createInstance(host.id, page)
  if (!opener || !instance) throw new Error('Missing default fixture')
  const child = graph.getChildren(instance.id)[0]
  // Imported instances may link directly to a master rather than the host occurrence.
  graph.updateNode(child.id, { componentId: draft.id })
  graph.swapInstanceComponent(opener.id, other.id)
  graph.syncInstances(host.id)
  expect(child.fills).toEqual(other.fills)
})
