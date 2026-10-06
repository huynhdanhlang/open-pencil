import { expect, test } from 'bun:test'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { sceneNodeToJSX } from '@open-pencil/design-jsx'
import { SceneGraph, readBehaviour } from '@open-pencil/scene-graph'

async function render(source: string) {
  const graph = new SceneGraph()
  const [result] = await renderJSX(graph, source)
  const root = graph.getNode(result.id)
  if (!root) throw new Error('Missing rendered component')
  return { graph, root }
}

test('Checkbox export preserves BOOLEAN, TEXT, visibility and its native slot identity', async () => {
  const first = await render(`
    <Checkbox.Root modelValue="Checked" properties={[
      {id:"checked",name:"Checked",type:"BOOLEAN",defaultValue:"true"},
      {id:"label",name:"Label",type:"TEXT",defaultValue:"Ánh sáng"}
    ]}>
      <Checkbox.Indicator name="Chosen by creator"
        propertyRefs={[{propertyId:"checked",field:"VISIBLE"}]} />
      <Text name="Label" propertyRefs={[{propertyId:"label",field:"TEXT"}]}>Ánh sáng</Text>
    </Checkbox.Root>
  `)
  const source = sceneNodeToJSX(first.root.id, first.graph)
  const second = await render(source)
  expect(second.root.componentPropertyDefinitions).toEqual(first.root.componentPropertyDefinitions)
  expect(readBehaviour(second.root)).toEqual(readBehaviour(first.root))
  expect(
    second.graph.getChildren(second.root.id).map((node) => node.componentPropertyReferences)
  ).toEqual(first.graph.getChildren(first.root.id).map((node) => node.componentPropertyReferences))
  expect(sceneNodeToJSX(second.root.id, second.graph)).toBe(source)
})

test('generic ComponentSet preserves declared property IDs and SLOT settings', async () => {
  const first = await render(`
    <ComponentSet properties={[
      {id:"state",name:"State",type:"VARIANT",defaultValue:"On",variantOptions:["Off","On"]},
      {id:"slot",name:"Content",type:"SLOT",defaultValue:"",description:"Creator content",
       preferredValues:["preferred"],slotSettings:{minChildren:0,maxChildren:2,
       allowPreferredValuesOnly:true,displayEmptyByDefault:true,stretchChildOnInsert:true}}
    ]}>
      <Component name="State=Off"><Frame propertyRefs={[{propertyId:"slot",field:"SLOT_CONTENT"}]} /></Component>
      <Component name="State=On"><Frame propertyRefs={[{propertyId:"slot",field:"SLOT_CONTENT"}]} /></Component>
    </ComponentSet>
  `)
  const second = await render(sceneNodeToJSX(first.root.id, first.graph))
  expect(second.root.type).toBe('COMPONENT_SET')
  expect(second.root.componentPropertyDefinitions).toEqual(first.root.componentPropertyDefinitions)
  for (const variant of second.graph.getChildren(second.root.id))
    expect(second.graph.getChildren(variant.id)[0]?.componentPropertyReferences).toEqual([
      { propertyId: 'slot', field: 'SLOT_CONTENT' }
    ])
})

test('implicit Tabs containers preserve their original SLOT definitions on export/import', async () => {
  const first = await render(`
    <Tabs.Root>
      <Tabs.List><Tabs.Trigger>First</Tabs.Trigger></Tabs.List>
      <Tabs.Content>Content</Tabs.Content>
    </Tabs.Root>
  `)
  const source = sceneNodeToJSX(first.root.id, first.graph)
  const second = await render(source)
  expect(second.root.componentPropertyDefinitions).toEqual(first.root.componentPropertyDefinitions)
  expect(readBehaviour(second.root)?.parts).toEqual(readBehaviour(first.root)?.parts)
  expect(sceneNodeToJSX(second.root.id, second.graph)).toBe(source)
})

test('variant-owned slots and state IDs survive a Reka export/import', async () => {
  const first = await render(`
    <Switch.Root modelValue="State">
      <Component name="State=Off"><Switch.Thumb /></Component>
      <Component name="State=On"><Switch.Thumb /></Component>
    </Switch.Root>
  `)
  const second = await render(sceneNodeToJSX(first.root.id, first.graph))
  expect(second.root.componentPropertyDefinitions).toEqual(first.root.componentPropertyDefinitions)
  expect(readBehaviour(second.root)).toEqual(readBehaviour(first.root))
  expect(
    second.graph.getChildren(second.root.id).map((variant) => variant.componentPropertyDefinitions)
  ).toEqual(
    first.graph.getChildren(first.root.id).map((variant) => variant.componentPropertyDefinitions)
  )
})

test('invalid and conflicting SLOT references fail explicitly', async () => {
  await expect(
    render(`<Component properties={[{id:"slot",name:"Content",type:"SLOT",defaultValue:""}]}>
    <Text propertyRefs={[{propertyId:"slot",field:"SLOT_CONTENT"}]}>Invalid</Text>
  </Component>`)
  ).rejects.toThrow('SLOT_CONTENT properties require a frame')
  await expect(
    render(`<Checkbox.Root parts={{indicator:"First"}} properties={[
    {id:"first",name:"First",type:"SLOT",defaultValue:""},
    {id:"second",name:"Second",type:"SLOT",defaultValue:""}
  ]}><Checkbox.Indicator propertyRefs={[{propertyId:"second",field:"SLOT_CONTENT"}]} />
  </Checkbox.Root>`)
  ).rejects.toThrow('Conflicting slot bindings')
  await expect(
    render(`<Checkbox.Root parts={{indicator:"Missing"}}>
    <Checkbox.Indicator />
  </Checkbox.Root>`)
  ).rejects.toThrow('Missing SLOT property')
})

test('Input export preserves visibility alongside its authoritative TEXT binding', async () => {
  const first = await render(`<Textarea.Root modelValue="Draft" properties={[
    {id:"draft",name:"Draft",type:"TEXT",defaultValue:""},
    {id:"visible",name:"Visible",type:"BOOLEAN",defaultValue:"true"}
  ]}><Textarea.Input propertyRefs={[
    {propertyId:"draft",field:"TEXT"},{propertyId:"visible",field:"VISIBLE"}
  ]} /></Textarea.Root>`)
  const second = await render(sceneNodeToJSX(first.root.id, first.graph))
  expect(second.graph.getChildren(second.root.id)[0]?.componentPropertyReferences).toEqual([
    { propertyId: 'visible', field: 'VISIBLE' },
    { propertyId: 'draft', field: 'TEXT' }
  ])
  expect(second.root.componentPropertyDefinitions).toEqual(first.root.componentPropertyDefinitions)
})

test('flattened nested instances retain outer visibility without orphaned master references', async () => {
  const graph = new SceneGraph()
  const [master] = await renderJSX(
    graph,
    `<Component properties={[
    {id:"label",name:"Label",type:"TEXT",defaultValue:"Label"}
  ]}><Text propertyRefs={[{propertyId:"label",field:"TEXT"}]}>Label</Text></Component>`
  )
  const [owner] = await renderJSX(
    graph,
    `<Component properties={[
    {id:"show",name:"Show label",type:"BOOLEAN",defaultValue:"true"}
  ]}><Instance of="${master.id}" propertyRefs={[{propertyId:"show",field:"VISIBLE"}]} /></Component>`
  )
  const source = sceneNodeToJSX(owner.id, graph)
  const second = await render(source)
  const frame = second.graph.getChildren(second.root.id)[0]
  expect(frame?.type).toBe('FRAME')
  expect(frame?.componentPropertyReferences).toEqual([{ propertyId: 'show', field: 'VISIBLE' }])
  expect(second.graph.getChildren(frame?.id ?? '')[0]?.componentPropertyReferences).toEqual([])
})

test('a two-level flattened instance does not export its master-owned visibility ID', async () => {
  const graph = new SceneGraph()
  const [label] = await renderJSX(graph, '<Component><Text>Label</Text></Component>')
  const [nested] = await renderJSX(
    graph,
    `<Component properties={[
    {id:"nested-show",name:"Show label",type:"BOOLEAN",defaultValue:"true"}
  ]}><Instance of="${label.id}" propertyRefs={[{propertyId:"nested-show",field:"VISIBLE"}]} /></Component>`
  )
  const [owner] = await renderJSX(graph, `<Component><Instance of="${nested.id}" /></Component>`)
  const second = await render(sceneNodeToJSX(owner.id, graph))
  const outer = second.graph.getChildren(second.root.id)[0]
  const inner = second.graph.getChildren(outer?.id ?? '')[0]
  expect(inner?.type).toBe('FRAME')
  expect(inner?.componentPropertyReferences).toEqual([])
})
