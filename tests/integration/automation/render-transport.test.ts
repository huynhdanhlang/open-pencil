import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test } from 'bun:test'

import * as v from 'valibot'

import { recordInstanceOverride } from '@open-pencil/scene-graph'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import { createEditorStore, type EditorStore } from '@/app/editor/session/create'

import { preprocessRPC } from '#mcp/jsx-preprocess'

const { handleTargetCommand } = createAutomationCommandHandlers(makeFigmaFromStore)
let store: EditorStore

beforeEach(() => {
  Object.assign(globalThis, { window: { innerWidth: 1024, innerHeight: 768 } })
  store = createEditorStore()
})
afterEach(() => {
  store.dispose()
  Reflect.deleteProperty(globalThis, 'window')
})

async function render(args: Record<string, unknown>) {
  const body = preprocessRPC({ command: 'tool', args: { name: 'render', args } })
  const wire = v.parse(
    v.pipe(v.string(), v.parseJson(), v.object({ args: v.record(v.string(), v.unknown()) })),
    JSON.stringify(body)
  )
  return handleTargetCommand(
    {
      store,
      documentId: 'tab-1',
      documentName: 'Owned',
      pageId: store.state.currentPageId,
      pageName: 'Page'
    },
    'tool',
    wire.args
  )
}

test('wire render replaces on the actual owner page, preserving order and geometry through Undo/Redo', async () => {
  const page = store.graph.addPage('Other')
  const parent = store.graph.createNode('FRAME', page.id)
  store.graph.createNode('RECTANGLE', parent.id, { name: 'Before' })
  const old = store.graph.createNode('RECTANGLE', parent.id, { name: 'Old', x: 31, y: 47 })
  store.graph.createNode('RECTANGLE', parent.id, { name: 'After' })
  await render({ replace_id: old.id, jsx: '<Rectangle name="New" w={20} h={30} />' })
  expect(store.graph.getNode(old.id)).toBeUndefined()
  expect(store.graph.getChildren(parent.id).map((n) => n.name)).toEqual(['Before', 'New', 'After'])
  const added = store.graph.getChildren(parent.id)[1]
  expect(added).toMatchObject({ x: 31, y: 47, parentId: parent.id })
  store.undo.undo()
  expect(store.graph.getChildren(parent.id).map((n) => n.name)).toEqual(['Before', 'Old', 'After'])
  store.undo.redo()
  expect(store.graph.getChildren(parent.id).map((n) => n.name)).toEqual(['Before', 'New', 'After'])
  expect(store.graph.getNode(added.id)).toMatchObject({ x: 31, y: 47 })
})

test('wire fragment inserts every root contiguously and reports its siblings', async () => {
  const parent = store.graph.createNode('FRAME', store.state.currentPageId)
  store.graph.createNode('RECTANGLE', parent.id, { name: 'Before' })
  store.graph.createNode('RECTANGLE', parent.id, { name: 'After' })
  const response = await render({
    parent_id: parent.id,
    insert_index: 1,
    jsx: '<><Rectangle name="A" /><Rectangle name="B" /></>'
  })
  expect(store.graph.getChildren(parent.id).map((n) => n.name)).toEqual([
    'Before',
    'A',
    'B',
    'After'
  ])
  expect(response).toMatchObject({
    result: { name: 'A', siblings: [{ name: 'B', type: 'RECTANGLE' }] }
  })
  store.undo.undo()
  expect(store.graph.getChildren(parent.id).map((n) => n.name)).toEqual(['Before', 'After'])
})

test('actual JSON preprocessing preserves name and ID variable bindings', async () => {
  const collection = store.graph.createCollection('Tokens')
  const color = store.graph.createVariable('Canvas', 'COLOR', collection.id, {
    r: 0.2,
    g: 0.4,
    b: 0.6,
    a: 1
  })
  const width = store.graph.createVariable('Width', 'FLOAT', collection.id, 64)
  await render({
    jsx: `<Rectangle name="Bound" w={designVar("${width.id}", 0)} bg={designVar("Canvas")} bind={{ "fills/0/color": designVar("Canvas") }} />`
  })
  const node = store.graph.getChildren(store.state.currentPageId).find((n) => n.name === 'Bound')
  expect(node?.boundVariables).toMatchObject({ width: width.id, 'fills/0/color': color.id })
  expect(node?.width).toBe(64)
})

test('missing replacement and invalid insertion reject before any mutation or Undo', async () => {
  const count = store.graph.nodes.size
  for (const placement of [{ replace_id: 'missing' }, { insert_index: -1 }]) {
    await expect(render({ ...placement, jsx: '<Rectangle />' })).rejects.toThrow()
    expect(store.graph.nodes.size).toBe(count)
    expect(store.undo.canUndo).toBe(false)
  }
})

test('invalid variable transport fails without raw-JSX fallback or document changes', async () => {
  await expect(
    render({ jsx: '<Rectangle w={{ "$openpencil.variable": { version: 1, name: "Fake" } }} />' })
  ).rejects.toThrow('reserved')
  await expect(
    handleTargetCommand(
      {
        store,
        documentId: 'tab-1',
        documentName: 'Owned',
        pageId: store.state.currentPageId,
        pageName: 'Page'
      },
      'tool',
      {
        name: 'render',
        args: {
          tree: {
            type: 'rectangle',
            props: { w: { '$openpencil.variable': { version: 2, name: 'Width' } } },
            children: []
          }
        }
      }
    )
  ).rejects.toThrow('variable')
  expect(store.graph.getChildren(store.state.currentPageId)).toHaveLength(0)
  expect(store.undo.canUndo).toBe(false)
})

test('render Undo removes propagated component children from instances on another page', async () => {
  const component = store.graph.createNode('COMPONENT', store.state.currentPageId, { name: 'Main' })
  store.graph.createNode('RECTANGLE', component.id, { name: 'Original' })
  const other = store.graph.addPage('Instances')
  const instance = store.graph.createInstance(component.id, other.id)
  if (!instance) throw new Error('Missing instance')
  await render({ parent_id: component.id, jsx: '<Text name="Added" size={15}>New label</Text>' })
  expect(store.graph.getChildren(instance.id).map((n) => n.name)).toEqual(['Original', 'Added'])
  store.undo.undo()
  await Promise.resolve()
  expect(store.graph.getChildren(component.id).map((n) => n.name)).toEqual(['Original'])
  expect(store.graph.getChildren(instance.id).map((n) => n.name)).toEqual(['Original'])
  store.undo.redo()
  await Promise.resolve()
  expect(store.graph.getChildren(instance.id).map((n) => n.name)).toEqual(['Original', 'Added'])
})

test('replacement and Undo preserve exact foreign instance overrides and unrelated siblings', async () => {
  const component = store.graph.createNode('COMPONENT', store.state.currentPageId)
  const original = store.graph.createNode('TEXT', component.id, {
    name: 'Original',
    text: 'Default',
    x: 31,
    y: 47
  })
  const other = store.graph.addPage('Instances')
  const instance = store.graph.createInstance(component.id, other.id)
  if (!instance) throw new Error('Missing instance')
  const child = store.graph.getChildren(instance.id)[0]
  store.graph.updateNode(child.id, { text: 'My override' })
  recordInstanceOverride(store.graph, child.id, ['text'])
  await render({ replace_id: original.id, jsx: '<Text name="Replacement">New</Text>' })
  expect(store.graph.getChildren(instance.id).map((n) => n.name)).toEqual(['Replacement'])
  expect(store.graph.getChildren(instance.id)[0]).toMatchObject({ x: 31, y: 47 })
  const unrelated = store.graph.createNode('RECTANGLE', other.id, { name: 'Unrelated' })
  store.undo.undo()
  await Promise.resolve()
  expect(store.graph.getChildren(instance.id).map((n) => n.id)).toEqual([child.id])
  expect(store.graph.getNode(child.id)?.text).toBe('My override')
  expect(store.graph.getNode(unrelated.id)).toBe(unrelated)
  store.undo.redo()
  await Promise.resolve()
  expect(store.graph.getChildren(instance.id).map((n) => n.name)).toEqual(['Replacement'])
  expect(store.graph.getChildren(instance.id)[0]).toMatchObject({ x: 31, y: 47 })
  expect(store.graph.getNode(unrelated.id)).toBe(unrelated)
  const redoneIds = store.graph.getChildren(instance.id).map((n) => n.id)
  store.undo.undo()
  store.undo.redo()
  await Promise.resolve()
  expect(store.graph.getChildren(instance.id).map((n) => n.id)).toEqual(redoneIds)
})

test('delete-only sync reaches an empty retained frame and transitive instances without deleting local/imported content', async () => {
  const page = store.state.currentPageId
  const a = store.graph.createNode('COMPONENT', page, { name: 'A' })
  const frame = store.graph.createNode('FRAME', a.id, { name: 'Retained' })
  const text = store.graph.createNode('TEXT', frame.id, { name: 'Last child' })
  const second = store.graph.addPage('B')
  const b = store.graph.createNode('COMPONENT', second.id, { name: 'B' })
  const nested = store.graph.createInstance(a.id, b.id)
  const third = store.graph.addPage('C')
  const outer = store.graph.createInstance(b.id, third.id)
  if (!nested || !outer) throw new Error('Missing instances')
  await Promise.resolve()
  const nestedFrame = store.graph.getChildren(nested.id)[0]
  const childId = store.graph.getChildren(nestedFrame.id)[0].id
  const local = store.graph.createNode('RECTANGLE', nestedFrame.id, { name: 'Local' })
  const unresolved = store.graph.createNode('RECTANGLE', nestedFrame.id, {
    name: 'Imported',
    componentId: 'unresolved:source'
  })
  await handleTargetCommand(
    { store, documentId: 'tab-1', documentName: 'Owned', pageId: page, pageName: 'A' },
    'tool',
    { name: 'delete_node', args: { id: text.id } }
  )
  expect(store.graph.getChildren(nestedFrame.id).map((n) => n.id)).toEqual([
    local.id,
    unresolved.id
  ])
  const outerNested = store.graph.getChildren(outer.id)[0]
  const outerFrame = store.graph.getChildren(outerNested.id)[0]
  expect(store.graph.getChildren(outerFrame.id).some((n) => n.name === 'Last child')).toBe(false)
  store.undo.undo()
  await Promise.resolve()
  expect(store.graph.getChildren(nestedFrame.id).some((n) => n.id === childId)).toBe(true)
  expect(store.graph.getChildren(outerFrame.id).some((n) => n.name === 'Last child')).toBe(true)
  expect(store.graph.getNode(local.id)).toBeDefined()
  expect(store.graph.getNode(unresolved.id)).toBeDefined()
})

test('deleting a locally cloned nested instance propagates and Undo restores its exact ID', async () => {
  const page = store.state.currentPageId
  const inner = store.graph.createNode('COMPONENT', page, { name: 'Inner' })
  store.graph.createNode('TEXT', inner.id, { text: 'Inner text' })
  const outer = store.graph.createNode('COMPONENT', page, { name: 'Outer' })
  const nested = store.graph.createInstance(inner.id, outer.id)
  const other = store.graph.addPage('Instances')
  const instance = store.graph.createInstance(outer.id, other.id)
  if (!nested || !instance) throw new Error('Missing instances')
  await Promise.resolve()
  const child = store.graph.getChildren(instance.id)[0]
  await handleTargetCommand(
    { store, documentId: 'tab-1', documentName: 'Owned', pageId: page, pageName: 'Page' },
    'tool',
    { name: 'delete_node', args: { id: nested.id } }
  )
  expect(store.graph.getChildren(instance.id)).toHaveLength(0)
  store.undo.undo()
  await Promise.resolve()
  expect(store.graph.getChildren(instance.id).map((n) => n.id)).toEqual([child.id])
})

test.each([
  '<Rectangle left={2} top={3} w={24} h={24} />',
  '<svg viewBox="0 0 24 24"><path d="M0 0L24 0L24 24Z" /></svg>'
])('replacement placement reaches creation observers for %s', async (jsx) => {
  const component = store.graph.createNode('COMPONENT', store.state.currentPageId)
  const old = store.graph.createNode('RECTANGLE', component.id, { x: 31, y: 47 })
  const other = store.graph.addPage('Instances')
  const instance = store.graph.createInstance(component.id, other.id)
  if (!instance) throw new Error('Missing instance')
  await render({ replace_id: old.id, jsx })
  expect(store.graph.getChildren(component.id)[0]).toMatchObject({ x: 31, y: 47 })
  expect(store.graph.getChildren(instance.id)[0]).toMatchObject({ x: 31, y: 47 })
})

test('replacement placement preserves ordinary auto-layout flow', async () => {
  const component = store.graph.createNode('COMPONENT', store.state.currentPageId, {
    layoutMode: 'HORIZONTAL',
    width: 300,
    height: 100
  })
  const old = store.graph.createNode('RECTANGLE', component.id, { width: 24, height: 24 })
  const other = store.graph.addPage('Instances')
  const instance = store.graph.createInstance(component.id, other.id)
  if (!instance) throw new Error('Missing instance')
  await render({ replace_id: old.id, jsx: '<Rectangle w={24} h={24} />' })
  expect(store.graph.getChildren(component.id)[0].layoutPositioning).toBe('AUTO')
  expect(store.graph.getChildren(instance.id)[0].layoutPositioning).toBe('AUTO')
})
