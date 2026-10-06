import { expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import { SceneGraph } from '@open-pencil/scene-graph'

function execute(name: string, figma: FigmaAPI, args: Record<string, unknown>) {
  const tool = ALL_TOOLS.find((item) => item.name === name)
  if (!tool) throw new Error(`Missing tool ${name}`)
  return tool.execute(figma, args)
}

test('expose_instance_swap returns the exact property an agent can assign and read', () => {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const draft = figma.createComponent()
  draft.name = 'Draft'
  const unknown = figma.createComponent()
  unknown.name = 'Unknown'
  const source = figma.createComponent()
  const opener = draft.createInstance()
  source.appendChild(opener)
  const result = execute('expose_instance_swap', figma, {
    instance_ids: [opener.id],
    candidate_ids: [draft.id, unknown.id],
    property_name: 'Captured opener'
  })
  const definition = graph.getNode(source.id)?.componentPropertyDefinitions[0]
  if (!definition) throw new Error('Missing native definition')
  expect(result).toMatchObject({ id: source.id, property: definition })
  const current = execute('get_node', figma, { id: source.id, depth: 0 })
  expect(current).toMatchObject({ componentPropertyDefinitions: [definition] })
  const reference = execute('get_node', figma, { id: opener.id, depth: 0 })
  expect(reference).toMatchObject({
    componentId: draft.id,
    componentPropertyReferences: [{ propertyId: definition.id, field: 'INSTANCE_SWAP' }]
  })
  const instance = source.createInstance()
  instance.setProperties({ [`${definition.name}#${definition.id}`]: unknown.id })
  const assigned = execute('get_node', figma, { id: instance.id, depth: 0 })
  expect(assigned).toMatchObject({ componentPropertyAssignments: { [definition.id]: unknown.id } })
  expect(graph.getChildren(instance.id)[0]?.componentId).toBe(unknown.id)
})

test('component map states its page scope instead of implying document-wide zero usage', () => {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const sourcePage = figma.currentPage
  const component = figma.createComponent()
  const consumerPage = figma.createPage()
  figma.currentPage = consumerPage
  component.createInstance()
  figma.currentPage = sourcePage
  const result = execute('design_to_component_map', figma, {})
  expect(result).toMatchObject({ pageId: sourcePage.id, instanceCountScope: 'page' })
  expect(result).toMatchObject({ components: [{ id: component.id, instanceCount: 0 }] })
})
