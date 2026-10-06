import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { CommittedGraphEventError, restorePageCheckpoint } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor'

test('consecutive page snapshots share unchanged copies, never mutable live nodes', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const a = editor.graph.createNode('RECTANGLE', page)
  const b = editor.graph.createNode('RECTANGLE', page)
  const before = editor.snapshotPage(page)
  editor.graph.updateNode(a.id, { name: 'Changed' })
  const after = editor.snapshotPage(page)
  expect(after.get(b.id)).toBe(before.get(b.id))
  expect(after.get(b.id)).not.toBe(b)
  expect(after.get(a.id)).not.toBe(before.get(a.id))
  expect(before.get(a.id)?.name).not.toBe('Changed')
})

test('restoring a page does not alias nested history data into the live graph', () => {
  const editor = createEditor()
  const a = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  const snapshot = editor.snapshotPage()
  editor.restorePageFromSnapshot(snapshot)
  const restored = expectDefined(editor.graph.getNode(a.id), 'restored node')
  expect(restored.fills).not.toBe(snapshot.get(a.id)?.fills)
  const fill = expectDefined(restored.fills[0], 'fill')
  fill.opacity = 0.2
  expect(snapshot.get(a.id)?.fills[0]?.opacity).toBe(1)
  editor.restorePageFromSnapshot(snapshot)
  expect(editor.graph.getNode(a.id)?.fills[0]?.opacity).toBe(1)
})

test('alternating page edits preserve unchanged history copies on each page', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const otherPage = editor.graph.createNode('CANVAS', null)
  const a = editor.graph.createNode('RECTANGLE', page)
  const before = editor.snapshotPage(page)
  editor.snapshotPage(otherPage.id)
  const after = editor.snapshotPage(page)
  expect(after.get(a.id)).toBe(before.get(a.id))
  editor.graph.updateNode(a.id, { name: 'Changed after visiting another page' })
  expect(before.get(a.id)?.name).not.toBe(a.name)
})

test('history and restore preserve shared imported binary payloads without aliasing live data', () => {
  const editor = createEditor()
  const bytes = new Uint8Array([1, 2, 3])
  const page = editor.state.currentPageId
  const a = editor.graph.createNode('TEXT', page, { textPicture: bytes })
  const b = editor.graph.createNode('TEXT', page, { textPicture: bytes })
  const before = editor.snapshotPage(page)
  expect(before.get(a.id)?.textPicture).toBe(before.get(b.id)?.textPicture)
  expect(before.get(a.id)?.textPicture).not.toBe(bytes)
  editor.restorePageFromSnapshot(before)
  const restoredA = expectDefined(editor.graph.getNode(a.id), 'restored first node')
  const restoredB = expectDefined(editor.graph.getNode(b.id), 'restored second node')
  expect(restoredA.textPicture).toBe(restoredB.textPicture)
  expect(restoredA.textPicture).not.toBe(before.get(a.id)?.textPicture)
  expectDefined(restoredA.textPicture, 'restored bytes')[0] = 9
  expect(before.get(a.id)?.textPicture?.[0]).toBe(1)
})

test('restoring one edited node keeps unrelated live nodes and renderer payloads intact', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const a = editor.graph.createNode('RECTANGLE', page)
  const b = editor.graph.createNode('TEXT', page, { textPicture: new Uint8Array([1, 2, 3]) })
  const payload = b.textPicture
  const before = editor.snapshotPage()
  editor.graph.updateNode(a.id, { name: 'Changed' })
  const deleted: string[] = []
  const updated: string[] = []
  editor.graph.onNodeEvents({
    deleted: (id) => deleted.push(id),
    updated: (id) => updated.push(id)
  })
  editor.restorePageFromSnapshot(before)
  expect(editor.graph.getNode(b.id)).toBe(b)
  expect(b.textPicture).toBe(payload)
  expect(updated).not.toContain(b.id)
  expect(deleted).toEqual([])
  expect(editor.graph.getNode(a.id)?.name).toBe(before.get(a.id)?.name)
})

test('structural history restores surviving descendants, sibling order and component indexes', () => {
  const editor = createEditor()
  const graph = editor.graph
  const page = editor.state.currentPageId
  const component = graph.createNode('COMPONENT', page)
  const parent = graph.createNode('FRAME', page, { rotation: 35, x: 19, y: 23 })
  const child = graph.createNode('INSTANCE', parent.id, { componentId: component.id, x: 7, y: 11 })
  const sibling = graph.createNode('RECTANGLE', page)
  const before = editor.snapshotPage()
  graph.reparentNode(child.id, page)
  graph.deleteNode(parent.id)
  graph.reorderChild(sibling.id, page, 0)
  graph.updateNode(child.id, { componentId: null, name: 'Moved instance' })
  const after = editor.snapshotPage()
  editor.restorePageFromSnapshot(before)
  expect(graph.getNode(child.id)).toBe(child)
  expect(graph.getNode(child.id)).toEqual(before.get(child.id))
  expect(graph.getNode(page)?.childIds).toEqual(before.get(page)?.childIds)
  expect(graph.instanceIndex.get(component.id)?.has(child.id)).toBe(true)
  editor.restorePageFromSnapshot(after)
  expect(graph.getNode(child.id)).toBe(child)
  expect(graph.getNode(parent.id)).toBeUndefined()
  expect(graph.getNode(child.id)).toEqual(after.get(child.id))
  expect(graph.instanceIndex.get(component.id)?.has(child.id)).toBe(false)
  expect(graph.getNode(page)?.childIds).toEqual(after.get(page)?.childIds)
})

test('history restores exact absent properties and source bindings after a type change', () => {
  const editor = createEditor()
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId)
  node.boundVariables = { width: 'saved-variable' }
  const before = editor.snapshotPage()
  editor.graph.updateNode(node.id, {
    type: 'INSTANCE',
    componentId: 'changed-component',
    text: 'extra'
  })
  const after = editor.snapshotPage()
  editor.restorePageFromSnapshot(before)
  expect(editor.graph.getNode(node.id)).toEqual(before.get(node.id))
  expect(editor.graph.instanceIndex.get('changed-component')?.has(node.id)).not.toBe(true)
  editor.restorePageFromSnapshot(after)
  expect(editor.graph.getNode(node.id)).toEqual(after.get(node.id))
  expect(editor.graph.instanceIndex.get('changed-component')?.has(node.id)).toBe(true)
})

test('history observers see only a complete hierarchy and invalid history leaves live state intact', () => {
  const editor = createEditor()
  const graph = editor.graph
  const page = editor.state.currentPageId
  const parent = graph.createNode('FRAME', page)
  const child = graph.createNode('RECTANGLE', parent.id)
  const before = editor.snapshotPage()
  graph.reparentNode(child.id, page)
  graph.deleteNode(parent.id)
  let observed = 0
  graph.onNodeEvents({
    created: () => {
      observed++
      expect(graph.getNode(parent.id)?.childIds).toEqual([child.id])
      expect(graph.getNode(child.id)?.parentId).toBe(parent.id)
    }
  })
  editor.restorePageFromSnapshot(before)
  expect(observed).toBe(1)
  const malformed = structuredClone(before)
  expectDefined(malformed.get(page), 'saved page').childIds.push(child.id)
  expect(() => restorePageCheckpoint(graph, malformed)).toThrow('Invalid page history hierarchy')
  expect(editor.snapshotPage()).toEqual(before)
  const detached = structuredClone(before)
  expectDefined(detached.get(page), 'saved canvas').parentId = 'wrong-root'
  expect(() => restorePageCheckpoint(graph, detached)).toThrow(
    'Page history must preserve its canvas root'
  )
  expect(editor.snapshotPage()).toEqual(before)
  const documentInPage = structuredClone(before)
  const savedRoot = structuredClone(expectDefined(graph.getNode(graph.rootId), 'document root'))
  savedRoot.parentId = page
  savedRoot.childIds = []
  documentInPage.set(savedRoot.id, savedRoot)
  expectDefined(documentInPage.get(page), 'saved canvas').childIds.push(savedRoot.id)
  expect(() => restorePageCheckpoint(graph, documentInPage)).toThrow(
    'Invalid page history hierarchy'
  )
  expect(editor.snapshotPage()).toEqual(before)
})

test('moving a captured node back from another page returns both affected layout scopes', () => {
  const editor = createEditor()
  const graph = editor.graph
  const page = editor.state.currentPageId
  const other = graph.createNode('CANVAS', graph.rootId)
  const otherSibling = graph.createNode('RECTANGLE', other.id)
  const child = graph.createNode('RECTANGLE', page)
  const before = editor.snapshotPage()
  graph.reparentNode(child.id, other.id)
  const scopes = restorePageCheckpoint(graph, before)
  expect(scopes).toEqual(new Set([page, other.id]))
  expect(other.childIds).toEqual([otherSibling.id])
  expect(graph.getNode(child.id)).toBe(child)
  expect(child.parentId).toBe(page)
})

test('a failed renderer notification still completes page recovery and keeps Redo', () => {
  const editor = createEditor()
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId)
  const before = editor.snapshotPage()
  editor.graph.updateNode(node.id, { name: 'Edited' })
  const after = editor.snapshotPage()
  editor.pushUndoEntry({
    label: 'Owned edit',
    inverse: () => editor.restorePageFromSnapshot(before),
    forward: () => editor.restorePageFromSnapshot(after)
  })
  editor.select([node.id])
  const unbind = editor.graph.onNodeEvents({
    updated: () => {
      throw new Error('renderer unavailable')
    }
  })
  expect(() => editor.undo.undo()).toThrow(CommittedGraphEventError)
  expect(editor.state.selectedIds.size).toBe(0)
  expect(editor.undo.canRedo).toBe(true)
  unbind()
  editor.undo.redo()
  expect(node.name).toBe('Edited')
})
