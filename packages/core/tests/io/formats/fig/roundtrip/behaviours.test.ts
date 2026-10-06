import { describe, expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile } from '@open-pencil/core'
import { renderJSX } from '@open-pencil/core/design-jsx'
import { createEditor } from '@open-pencil/core/editor'
import { sceneNodeToJSX } from '@open-pencil/design-jsx'
import {
  emptyBehaviour,
  guessInteractionStates,
  missingBindings,
  readBehaviour
} from '@open-pencil/scene-graph'

describe('.fig round trip of behaviours', () => {
  for (const namespace of ['TextField', 'Textarea']) {
    test(`${namespace} keeps its declared value and Input through two saves`, async () => {
      await initCodec()
      const editor = createEditor()
      await renderJSX(
        editor.graph,
        `
        <${namespace}.Root name="Feedback" modelValue="Draft"
          properties={[{id:"draft",name:"Draft",type:"TEXT",defaultValue:"Initial"}]}>
          <${namespace}.Input name="Unsent correction"
            propertyRefs={[{propertyId:"draft",field:"TEXT"}]}>Initial</${namespace}.Input>
        </${namespace}.Root>
      `
      )
      let graph = editor.graph
      let previousId: string | undefined
      for (let generation = 0; generation < 2; generation++) {
        graph = await parseFigFile((await exportFigFile(graph)).slice().buffer)
        const owner = [...graph.nodes.values()].find((node) => node.name === 'Feedback')
        if (!owner) throw new Error('Feedback component lost')
        const behaviour = readBehaviour(owner)
        if (!behaviour) throw new Error('Textarea behaviour lost')
        expect(owner.componentPropertyDefinitions).toHaveLength(1)
        const property = owner.componentPropertyDefinitions[0]
        expect(property?.name).toBe('Draft')
        expect(property?.defaultValue).toBe('Initial')
        expect(behaviour.texts.value?.propertyId).toBe(property?.id)
        if (previousId) expect(property?.id).toBe(previousId)
        previousId = property?.id
        expect(graph.getChildren(owner.id)[0]?.componentPropertyReferences).toEqual([
          { propertyId: property?.id, field: 'TEXT' }
        ])
        expect(missingBindings(graph, owner, behaviour)).toEqual([])
        const jsx = sceneNodeToJSX(owner.id, graph)
        expect(jsx).toContain('modelValue="Draft"')
        expect(jsx).toContain(`<${namespace}.Input`)
        const fresh = createEditor()
        const [rendered] = await renderJSX(fresh.graph, jsx)
        const again = fresh.graph.getNode(rendered.id)
        expect(again?.componentPropertyDefinitions).toHaveLength(1)
        expect(again && readBehaviour(again)?.texts.value?.propertyId).toBe(property?.id)
      }
    })
  }

  test('bindings follow the GUIDs their component properties get', async () => {
    await initCodec()
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const set = editor.graph.createNode('COMPONENT_SET', pageId, {
      name: 'Field',
      componentPropertyDefinitions: [
        {
          id: 'filled',
          name: 'Filled',
          type: 'VARIANT',
          defaultValue: 'No',
          variantOptions: ['No', 'Yes']
        },
        {
          id: 'interaction',
          name: 'Interaction',
          type: 'VARIANT',
          defaultValue: 'Default',
          variantOptions: ['Default', 'Focus']
        },
        { id: 'value', name: 'Value', type: 'TEXT', defaultValue: 'Email' }
      ]
    })
    for (const filled of ['No', 'Yes'])
      for (const interaction of ['Default', 'Focus']) {
        const variant = editor.graph.createNode('COMPONENT', set.id, {
          name: `Filled=${filled}, Interaction=${interaction}`,
          componentPropertyValues: { Filled: filled, Interaction: interaction }
        })
        editor.graph.createNode('TEXT', variant.id, {
          text: 'Email',
          componentPropertyReferences: [{ propertyId: 'value', field: 'TEXT' }]
        })
      }
    editor.setBehaviour(set.id, {
      ...emptyBehaviour('textField'),
      texts: { value: { propertyId: 'value' } },
      booleans: { filled: { propertyId: 'filled', on: 'Yes', off: 'No' } },
      states: guessInteractionStates('interaction', ['Default', 'Focus'])
    })
    expect(
      missingBindings(editor.graph, set, readBehaviour(set) ?? emptyBehaviour('button'))
    ).toEqual([])

    const reopened = await parseFigFile((await exportFigFile(editor.graph)).slice().buffer)
    const owner = [...reopened.nodes.values()].find((node) => node.name === 'Field')
    const behaviour = owner && readBehaviour(owner)
    if (!owner || !behaviour) throw new Error('Behaviour lost')
    expect(missingBindings(reopened, owner, behaviour)).toEqual([])
    const ids = new Map(owner.componentPropertyDefinitions.map((item) => [item.name, item.id]))
    expect(behaviour.texts.value.propertyId).toBe(ids.get('Value') ?? '')
    expect(behaviour.booleans.filled.propertyId).toBe(ids.get('Filled') ?? '')
    expect(behaviour.states?.propertyId).toBe(ids.get('Interaction'))
    // The document keeps its own ids.
    expect(readBehaviour(editor.graph.getNode(set.id) ?? set)?.texts.value.propertyId).toBe('value')
  })
})
