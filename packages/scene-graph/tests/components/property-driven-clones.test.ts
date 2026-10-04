import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

/**
 * A component can gain a property-driven child after an instance of it exists. Cloning that
 * child into the instance must honour the assignment the instance already made, not the
 * component's default, which is what the instance would show everywhere else.
 */
function graphWithLateChild() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'NavItem',
    componentPropertyDefinitions: [
      { id: '207:1', name: 'Label', type: 'TEXT', defaultValue: 'Default' }
    ]
  })
  const instance = graph.createInstance(component.id, page.id)
  graph.updateNode(instance.id, { componentPropertyAssignments: { '207:1': 'Assigned' } })
  return { graph, component, instance, page }
}

test('a child added after the instance takes the assigned text', () => {
  const { graph, component, instance } = graphWithLateChild()

  graph.createNode('TEXT', component.id, {
    name: 'Label',
    text: 'Default',
    componentPropertyReferences: [{ propertyId: '207:1', field: 'TEXT' }]
  })
  graph.syncInstances(component.id)

  const label = graph.getChildren(instance.id).find((child) => child.name === 'Label')
  expect(label?.text).toBe('Assigned')
})

test('an instance that assigns nothing still takes the component default', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const component = graph.createNode('COMPONENT', page.id, {
    name: 'NavItem',
    componentPropertyDefinitions: [
      { id: '207:1', name: 'Label', type: 'TEXT', defaultValue: 'Default' }
    ]
  })
  const instance = graph.createInstance(component.id, page.id)

  graph.createNode('TEXT', component.id, {
    name: 'Label',
    text: 'Default',
    componentPropertyReferences: [{ propertyId: '207:1', field: 'TEXT' }]
  })
  graph.syncInstances(component.id)

  const label = graph.getChildren(instance.id).find((child) => child.name === 'Label')
  expect(label?.text).toBe('Default')
})

test('a late visibility-driven child takes the assigned visibility', () => {
  const { graph, component, instance } = graphWithLateChild()
  graph.updateNode(component.id, {
    componentPropertyDefinitions: [
      { id: '207:1', name: 'Label', type: 'TEXT', defaultValue: 'Default' },
      { id: '207:2', name: 'Badge', type: 'BOOLEAN', defaultValue: 'true' }
    ]
  })
  graph.updateNode(instance.id, {
    componentPropertyAssignments: { '207:1': 'Assigned', '207:2': 'false' }
  })

  graph.createNode('RECTANGLE', component.id, {
    name: 'Badge',
    visible: true,
    componentPropertyReferences: [{ propertyId: '207:2', field: 'VISIBLE' }]
  })
  graph.syncInstances(component.id)

  const badge = graph.getChildren(instance.id).find((child) => child.name === 'Badge')
  expect(badge?.visible).toBe(false)
})
