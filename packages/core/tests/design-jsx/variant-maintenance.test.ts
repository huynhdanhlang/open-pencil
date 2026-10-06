import { expect, test } from 'bun:test'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'

function setup() {
  const editor = createEditor()
  const graph = editor.graph
  const set = graph.createNode('COMPONENT_SET', editor.state.currentPageId, {
    name: 'Feedback',
    componentPropertyDefinitions: [
      {
        id: 'context',
        name: 'Context',
        type: 'VARIANT',
        defaultValue: 'Unknown',
        variantOptions: ['Draft', 'Unknown']
      },
      {
        id: 'size',
        name: 'Size',
        type: 'VARIANT',
        defaultValue: 'Medium',
        variantOptions: ['Medium']
      },
      { id: 'label', name: 'Label', type: 'TEXT', defaultValue: 'Keep' }
    ]
  })
  const draft = graph.createNode('COMPONENT', set.id, {
    name: 'Context=Draft, Size=Medium',
    componentPropertyValues: { Context: 'Draft', Size: 'Medium' }
  })
  graph.createNode('COMPONENT', set.id, {
    name: 'Context=Unknown, Size=Medium',
    componentPropertyValues: { Context: 'Unknown', Size: 'Medium' }
  })
  const instance = graph.createInstance(draft.id, editor.state.currentPageId)
  if (!instance) throw new Error('Missing instance')
  graph.updateNode(instance.id, { componentPropertyAssignments: { label: 'Creator text' } })
  return { editor, graph, set, draft, instance }
}

test('appending variants under an existing set refreshes exact definitions without rebuilding it', async () => {
  const { graph, set, instance } = setup()
  const originalInstance = structuredClone(instance)
  const originalDefinitions = structuredClone(set.componentPropertyDefinitions)
  const [admitted] = await renderJSX(
    graph,
    '<Component name="Context=Admitted, Size=Medium" w={120} h={50}/>',
    { parentId: set.id }
  )
  expect(set.componentPropertyDefinitions[0]).toEqual({
    ...originalDefinitions[0],
    variantOptions: ['Draft', 'Unknown', 'Admitted']
  })
  expect(graph.getNode(admitted.id)?.componentPropertyValues).toEqual({
    Context: 'Admitted',
    Size: 'Medium'
  })
  const proxy = new FigmaAPI(graph).getNodeById(admitted.id)
  if (!proxy) throw new Error('Missing admitted')
  proxy.name = 'Context=Queued'
  await renderJSX(graph, '<Component name="Context=Running, Size=Medium" w={120} h={50}/>', {
    parentId: set.id
  })
  expect(set.componentPropertyDefinitions[0]).toEqual({
    ...originalDefinitions[0],
    variantOptions: ['Draft', 'Unknown', 'Queued', 'Running']
  })
  expect(graph.getNode(admitted.id)?.componentPropertyValues).toEqual({
    Context: 'Queued',
    Size: 'Medium'
  })
  expect(set.componentPropertyDefinitions.slice(1)).toEqual(originalDefinitions.slice(1))
  expect(graph.getNode(instance.id)).toEqual(originalInstance)
})

test('native layer rename restores names, values, default and option order through Undo and Redo', () => {
  const { editor, set, draft } = setup()
  const before = structuredClone({
    name: draft.name,
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  })
  editor.renameNode(draft.id, 'Context=Queued, Size=Large')
  expect(draft.componentPropertyValues).toEqual({ Context: 'Queued', Size: 'Large' })
  const after = structuredClone({
    name: draft.name,
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  })
  editor.undo.undo()
  expect({
    name: draft.name,
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  }).toEqual(before)
  editor.undo.redo()
  expect({
    name: draft.name,
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  }).toEqual(after)
})

test('failed append metadata delivery restores parent definitions and source edit markers', async () => {
  const { graph, set } = setup()
  const before = structuredClone([...graph.nodes])
  let fail = true
  graph.onNodeEvents({
    updated: (id, changes) => {
      if (fail && id === set.id && changes.componentPropertyDefinitions) {
        fail = false
        throw new Error('Variant observer failed')
      }
    }
  })
  await expect(
    renderJSX(graph, '<Component name="Context=Queued, Size=Medium"/>', { parentId: set.id })
  ).rejects.toThrow('Variant observer failed')
  expect([...graph.nodes]).toEqual(before)
})

test('generic labels and unknown dimension names preserve existing variant semantics', () => {
  const { graph, set, draft } = setup()
  const before = structuredClone({
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  })
  const proxy = new FigmaAPI(graph).getNodeById(draft.id)
  if (!proxy) throw new Error('Missing draft')
  proxy.name = 'Creator choice'
  expect({
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  }).toEqual(before)
  proxy.name = 'Other=Unrelated'
  expect({
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  }).toEqual(before)
})

test('renaming one variant preserves unrelated imported values even if its label is stale', () => {
  const { graph, set, draft } = setup()
  const sibling = graph.getChildren(set.id).find((node) => node.id !== draft.id)
  if (!sibling) throw new Error('Missing sibling')
  graph.updateNode(sibling.id, { name: 'Context=Stale label' })
  const before = structuredClone(sibling)
  const proxy = new FigmaAPI(graph).getNodeById(draft.id)
  if (!proxy) throw new Error('Missing draft')
  proxy.name = 'Context=Queued'
  expect(graph.getNode(sibling.id)).toEqual(before)
  expect(set.componentPropertyDefinitions[0].variantOptions).toEqual(['Unknown', 'Queued'])
})

test('late validation failure never changes the existing parent variant metadata', async () => {
  const { graph, set } = setup()
  const before = structuredClone([...graph.nodes])
  await expect(
    renderJSX(
      graph,
      `<><Component name="Context=Queued"/><Component properties={[
    {id:"bad",name:"Bad",type:"BOOLEAN",defaultValue:true}
  ]}/></>`,
      { parentId: set.id }
    )
  ).rejects.toThrow('Invalid properties')
  expect([...graph.nodes]).toEqual(before)
})

test('semantic rollback restores source markers even when rollback delivery also throws', async () => {
  const { graph, set } = setup()
  const before = structuredClone([...graph.nodes])
  graph.onNodeEvents({
    updated: (id, changes) => {
      if (id === set.id && changes.componentPropertyDefinitions) throw new Error('Observer failed')
    }
  })
  await expect(
    renderJSX(graph, '<Component name="Context=Queued"/>', { parentId: set.id })
  ).rejects.toThrow('cleanup failed')
  expect([...graph.nodes]).toEqual(before)
})

test('incomplete dimension labels cannot erase valid variant values', () => {
  const { editor, graph, set, draft } = setup()
  const before = structuredClone({
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  })
  const proxy = new FigmaAPI(graph).getNodeById(draft.id)
  if (!proxy) throw new Error('Missing draft')
  proxy.name = 'Context='
  expect({
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  }).toEqual(before)
  editor.renameNode(draft.id, 'Context=  , Size= ')
  expect({
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  }).toEqual(before)
  editor.undo.undo()
  expect(draft.name).toBe('Context=')
})

test('a native rename failure restores variant metadata, names, source markers and Undo', () => {
  const { editor, graph, set, draft } = setup()
  const before = structuredClone([...graph.nodes])
  let fail = true
  graph.onNodeEvents({
    updated: (id, changes) => {
      if (fail && id === set.id && changes.componentPropertyDefinitions) {
        fail = false
        throw new Error('Rename observer failed')
      }
    }
  })
  expect(() => editor.renameNode(draft.id, 'Context=Queued')).toThrow('Rename observer failed')
  expect([...graph.nodes]).toEqual(before)
  expect(editor.undo.canUndo).toBe(false)
})

test('native rename restores all fields when rollback observer delivery keeps failing', () => {
  const { editor, graph, set, draft } = setup()
  const before = structuredClone([...graph.nodes])
  graph.onNodeEvents({
    updated: (id, changes) => {
      if (id === set.id && changes.componentPropertyDefinitions) throw new Error('Observer failed')
    }
  })
  expect(() => editor.renameNode(draft.id, 'Context=Queued')).toThrow('rollback delivery failed')
  expect([...graph.nodes]).toEqual(before)
  expect(editor.undo.canUndo).toBe(false)
})

test('batch layer rename retains complete variant options and values in its existing Undo entry', () => {
  const { editor, graph, set, draft } = setup()
  editor.select([draft.id])
  const before = structuredClone({
    name: draft.name,
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  })
  editor.renameSelected({ match: 'Draft', replacement: 'Queued', startNumber: 1 })
  expect(draft.componentPropertyValues.Context).toBe('Queued')
  const after = structuredClone({
    name: draft.name,
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  })
  editor.undo.undo()
  expect({
    name: draft.name,
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  }).toEqual(before)
  editor.undo.redo()
  expect({
    name: draft.name,
    values: draft.componentPropertyValues,
    definitions: set.componentPropertyDefinitions
  }).toEqual(after)
  expect(graph.getNode(draft.id)?.parentId).toBe(set.id)
})

for (const batch of [false, true]) {
  test(`${batch ? 'batch' : 'single'} variant Undo/Redo commits complete state despite failed event delivery`, () => {
    const { editor, graph, set, draft } = setup()
    const state = () =>
      structuredClone({
        name: draft.name,
        values: draft.componentPropertyValues,
        definitions: set.componentPropertyDefinitions
      })
    const before = state()
    if (batch) {
      editor.select([draft.id])
      editor.renameSelected({ match: 'Draft', replacement: 'Queued', startNumber: 1 })
    } else editor.renameNode(draft.id, 'Context=Queued')
    const after = state()
    graph.onNodeEvents({
      updated: (id, changes) => {
        if (id === set.id && changes.componentPropertyDefinitions)
          throw new Error('Replay delivery failed')
      }
    })
    expect(() => editor.undo.undo()).toThrow('Committed graph event delivery failed')
    expect(state()).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
    expect(editor.undo.canRedo).toBe(true)
    expect(() => editor.undo.redo()).toThrow('Committed graph event delivery failed')
    expect(state()).toEqual(after)
    expect(editor.undo.canUndo).toBe(true)
    expect(editor.undo.canRedo).toBe(false)
  })
}
