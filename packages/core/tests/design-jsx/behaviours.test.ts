import { describe, expect, test } from 'bun:test'

import { getNodeOrThrow } from '#core-tests/helpers/assert'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { sceneNodeToJSX } from '@open-pencil/design-jsx'
import {
  missingBindings,
  readBehaviour,
  SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

async function render(jsx: string) {
  const graph = new SceneGraph()
  const [result] = await renderJSX(graph, jsx)
  const root = getNodeOrThrow(graph, result.id)
  const behaviour = readBehaviour(root)
  if (!behaviour) throw new Error(`${root.name} has no behaviour`)
  const names = (definitions: SceneNode['componentPropertyDefinitions']) =>
    definitions.map((item) => `${item.name}:${item.type}`)
  return { graph, root, behaviour, names, missing: missingBindings(graph, root, behaviour) }
}

describe('Reka UI elements in design JSX', () => {
  for (const namespace of ['TextField', 'Textarea']) {
    for (const explicitInput of [false, true]) {
      test(`${namespace} preserves its declared root binding with input reference ${explicitInput}`, async () => {
        const { graph, root, behaviour, missing } = await render(`
          <${namespace}.Root modelValue="Draft"
            properties={[{id:"draft",name:"Draft",type:"TEXT",defaultValue:"Initial"}]}>
            <${namespace}.Input name="Unsent correction"
              ${explicitInput ? 'propertyRefs={[{propertyId:"draft",field:"TEXT"}]}' : ''}>Initial</${namespace}.Input>
          </${namespace}.Root>
        `)
        expect(root.componentPropertyDefinitions).toHaveLength(1)
        expect(behaviour.texts.value?.propertyId).toBe('draft')
        expect(graph.getChildren(root.id)[0]?.componentPropertyReferences).toEqual([
          { propertyId: 'draft', field: 'TEXT' }
        ])
        expect(missing).toEqual([])
        const jsx = sceneNodeToJSX(root.id, graph)
        expect(jsx).toContain('modelValue="Draft"')
        expect(jsx).toContain(`<${namespace}.Input`)
        const reopened = await render(jsx)
        expect(reopened.root.componentPropertyDefinitions).toHaveLength(1)
        expect(reopened.behaviour.texts.value?.propertyId).toBe('draft')
      })
    }
  }

  test('an input reuses its declared TEXT reference without a root modelValue', async () => {
    const { root, behaviour } = await render(`
      <Textarea.Root properties={[{id:"draft",name:"Draft",type:"TEXT",defaultValue:"Draft"}]}>
        <Textarea.Input propertyRefs={[{propertyId:"draft",field:"TEXT"}]}>Draft</Textarea.Input>
      </Textarea.Root>
    `)
    expect(root.componentPropertyDefinitions).toHaveLength(1)
    expect(behaviour.texts.value?.propertyId).toBe('draft')
  })

  test('NumberField preserves its separate input text without exporting a text modelValue', async () => {
    const { graph, root, behaviour } = await render(`
      <NumberField.Root min={0} max={10} defaultValue={3}>
        <NumberField.Input>3</NumberField.Input>
      </NumberField.Root>
    `)
    const jsx = sceneNodeToJSX(root.id, graph)
    expect(jsx).not.toContain('modelValue=')
    expect(jsx).not.toContain('text=')
    expect(jsx).toContain('<NumberField.Input')
    const again = await render(jsx)
    expect(again.behaviour.texts.text?.propertyId).toBe(behaviour.texts.text?.propertyId)
    expect(again.behaviour.numbers).toEqual(behaviour.numbers)
    expect(again.root.componentPropertyDefinitions).toHaveLength(1)
  })

  test('Input export finds its behaviour binding after an unrelated legacy TEXT reference', async () => {
    const { graph, root } = await render(`
      <Textarea.Root modelValue="Draft" properties={[
        {id:"draft",name:"Draft",type:"TEXT",defaultValue:"Draft"},
        {id:"other",name:"Other",type:"TEXT",defaultValue:"Other"}
      ]}>
        <Textarea.Input>Draft</Textarea.Input>
      </Textarea.Root>
    `)
    const input = graph.getChildren(root.id)[0]
    if (!input) throw new Error('Input missing')
    graph.updateNode(input.id, {
      componentPropertyReferences: [
        { propertyId: 'other', field: 'TEXT' },
        { propertyId: 'draft', field: 'TEXT' }
      ]
    })
    const jsx = sceneNodeToJSX(root.id, graph)
    expect(jsx).toContain('<Textarea.Input')
    expect(jsx).toContain('modelValue="Draft"')
    const again = await render(jsx)
    expect(again.graph.getChildren(again.root.id)[0]?.componentPropertyReferences).toEqual([
      { propertyId: 'draft', field: 'TEXT' }
    ])
  })

  test('conflicting root and input text bindings are rejected', async () => {
    await expect(
      render(`
      <Textarea.Root modelValue="Draft" properties={[
        {id:"draft",name:"Draft",type:"TEXT",defaultValue:"Draft"},
        {id:"other",name:"Other",type:"TEXT",defaultValue:"Other"}
      ]}>
        <Textarea.Input propertyRefs={[{propertyId:"other",field:"TEXT"}]}>Draft</Textarea.Input>
      </Textarea.Root>
    `)
    ).rejects.toThrow('Conflicting text bindings')
  })

  test('a textarea binding retains the variant that owns its TEXT definition', async () => {
    const { graph, root, behaviour } = await render(`
      <Textarea.Root modelValue="Draft">
        <Component name="State=Default" properties={[
          {id:"draft",name:"Draft",type:"TEXT",defaultValue:"Draft"}
        ]}>
          <Textarea.Input propertyRefs={[{propertyId:"draft",field:"TEXT"}]}>Draft</Textarea.Input>
        </Component>
      </Textarea.Root>
    `)
    expect(behaviour.texts.value?.propertyId).toBe('draft')
    expect(root.componentPropertyDefinitions.filter((item) => item.type === 'TEXT')).toEqual([])
    const jsx = sceneNodeToJSX(root.id, graph)
    const again = await render(jsx)
    expect(again.behaviour.texts.value?.propertyId).toBe('draft')
    expect(again.root.componentPropertyDefinitions.filter((item) => item.type === 'TEXT')).toEqual(
      []
    )
    expect(again.graph.getChildren(again.root.id)[0]?.componentPropertyDefinitions).toMatchObject([
      { id: 'draft', name: 'Draft', type: 'TEXT' }
    ])
  })

  test('a Switch.Root with variants is a set whose thumb is one slot across its variants', async () => {
    const { graph, root, behaviour, missing } = await render(`
      <Switch.Root name="Switch" modelValue="State" states="Interaction">
        <Component name="State=Off, Interaction=Default" w={44} h={24}>
          <Switch.Thumb x={2} y={2} w={20} h={20} />
        </Component>
        <Component name="State=On, Interaction=Default" w={44} h={24}>
          <Switch.Thumb x={22} y={2} w={20} h={20} />
        </Component>
        <Component name="State=Off, Interaction=Hover" w={44} h={24}>
          <Switch.Thumb x={2} y={2} w={20} h={20} />
        </Component>
      </Switch.Root>
    `)
    expect(root.type).toBe('COMPONENT_SET')
    expect(behaviour.kind).toBe('switch')
    expect(behaviour.booleans.value).toMatchObject({ on: 'On', off: 'Off' })
    expect(behaviour.states).toMatchObject({ rest: 'Default', hover: 'Hover' })
    const thumbs = [...graph.getAllNodes()].filter((node) => node.name === 'Thumb')
    expect(thumbs).toHaveLength(3)
    expect(
      new Set(thumbs.map((thumb) => thumb.componentPropertyReferences[0]?.propertyId))
    ).toEqual(new Set([behaviour.parts.thumb]))
    expect(missing).toEqual([])
  })

  test('a TextField.Input becomes the field’s text property', async () => {
    const { root, behaviour, names, missing } = await render(`
      <TextField.Root name="Field" w={200} h={36}>
        <TextField.Input x={10} y={10}>Email</TextField.Input>
      </TextField.Root>
    `)
    expect(names(root.componentPropertyDefinitions)).toEqual(['Text:TEXT'])
    expect(behaviour.texts.value?.propertyId).toBe(root.componentPropertyDefinitions[0]?.id)
    expect(missing).toEqual([])
  })

  test('tab triggers and panels go in their List and Panels slots, the first panel showing', async () => {
    const { graph, root, behaviour, missing } = await render(`
      <Tabs.Root name="Tabs" w={240} flex="col">
        <Tabs.List flex="row" gap={8}>
          <Tabs.Trigger><Text>Account</Text></Tabs.Trigger>
          <Tabs.Trigger><Text>Password</Text></Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content><Text>Your name</Text></Tabs.Content>
        <Tabs.Content><Text>Your password</Text></Tabs.Content>
      </Tabs.Root>
    `)
    expect(graph.getChildren(root.id).map((child) => child.name)).toEqual(['List', 'Panels'])
    const panels = graph.getChildren(graph.getChildren(root.id)[1]?.id ?? '')
    expect(panels.map((panel) => panel.visible)).toEqual([true, false])
    expect(Object.keys(behaviour.parts).sort()).toEqual(['list', 'panels'])
    expect(missing).toEqual([])
  })

  test('a radio group’s items are instances of its RadioGroup.Item component in an Items slot', async () => {
    const graph = new SceneGraph()
    const [radio] = await renderJSX(
      graph,
      `<RadioGroup.Item name="Radio" modelValue="Checked">
        <Component name="Checked=Off" w={20} h={20} />
        <Component name="Checked=On" w={20} h={20} />
      </RadioGroup.Item>`
    )
    const [group] = await renderJSX(
      graph,
      `<RadioGroup.Root name="Plan">
        <RadioGroup.Item of="${radio.id}" />
        <RadioGroup.Item of="${radio.id}" />
      </RadioGroup.Root>`
    )
    const root = getNodeOrThrow(graph, group.id)
    const [items] = graph.getChildren(root.id)
    expect(items?.name).toBe('Items')
    expect(graph.getChildren(items?.id ?? '').map((item) => item.type)).toEqual([
      'INSTANCE',
      'INSTANCE'
    ])
    expect(readBehaviour(getNodeOrThrow(graph, radio.id))?.kind).toBe('radio')
    const behaviour = readBehaviour(root)
    expect(behaviour && missingBindings(graph, root, behaviour)).toEqual([])
  })
})

describe('Reka UI elements in JSX export', () => {
  test('a switch set exports as Switch.Root with its thumb and renders back the same', async () => {
    const graph = new SceneGraph()
    const [first] = await renderJSX(
      graph,
      `<Switch.Root name="Switch" modelValue="State">
        <Component name="State=Off" w={44} h={24}><Switch.Thumb x={2} y={2} w={20} h={20} /></Component>
        <Component name="State=On" w={44} h={24}><Switch.Thumb x={22} y={2} w={20} h={20} /></Component>
      </Switch.Root>`
    )
    const code = sceneNodeToJSX(first.id, graph)
    expect(code).toContain('<Switch.Root')
    expect(code).toContain('modelValue={{ property: "State", on: "On", off: "Off" }}')
    expect(code.match(/<Switch\.Thumb/g)).toHaveLength(2)

    const [second] = await renderJSX(graph, code)
    const again = readBehaviour(getNodeOrThrow(graph, second.id))
    const before = readBehaviour(getNodeOrThrow(graph, first.id))
    expect(again?.kind).toBe('switch')
    expect(again?.booleans.value).toMatchObject({ on: 'On', off: 'Off' })
    expect(Object.keys(again?.parts ?? {})).toEqual(Object.keys(before?.parts ?? {}))
  })

  test('tabs and a radio group export their repeated parts and items as Reka writes them', async () => {
    const graph = new SceneGraph()
    const [radio] = await renderJSX(
      graph,
      `<RadioGroup.Item name="Radio" modelValue="Checked">
        <Component name="Checked=Off" w={20} h={20} />
        <Component name="Checked=On" w={20} h={20} />
      </RadioGroup.Item>`
    )
    const [group] = await renderJSX(
      graph,
      `<RadioGroup.Root name="Plan"><RadioGroup.Item of="${radio.id}" /></RadioGroup.Root>`
    )
    expect(sceneNodeToJSX(group.id, graph)).toContain(`<RadioGroup.Item of="${radio.id}" />`)

    const [tabs] = await renderJSX(
      graph,
      `<Tabs.Root name="Tabs">
        <Tabs.List><Tabs.Trigger><Text>One</Text></Tabs.Trigger></Tabs.List>
        <Tabs.Content><Text>First</Text></Tabs.Content>
      </Tabs.Root>`
    )
    const code = sceneNodeToJSX(tabs.id, graph)
    expect(code).toContain('<Tabs.List')
    expect(code).toContain('<Tabs.Trigger')
    expect(code).toContain('<Tabs.Content')
    expect(code).not.toContain('name="Panels"')
  })
})
