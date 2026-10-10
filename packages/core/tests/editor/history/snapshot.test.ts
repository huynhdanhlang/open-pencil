import { expect, spyOn, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { isEqual } from 'es-toolkit'

import { CommittedGraphEventError, restorePageCheckpoint } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor'

test('checkpoint replay evaluates caller equality before any graph mutation', () => {
  const editor = createEditor()
  const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId)
  const snapshot = editor.snapshotPage()
  editor.graph.updateNode(node.id, { x: 10 })
  const compared: string[] = []
  restorePageCheckpoint(editor.graph, snapshot, undefined, (live, saved) => {
    expect(editor.graph.getNode(node.id)?.x).toBe(10)
    compared.push(saved.id)
    return isEqual(live, saved)
  })
  expect(compared).toEqual([...snapshot.keys()])
  expect(editor.graph.getNode(node.id)?.x).toBe(0)
  editor.dispose()
})

test('history replay compares aliased FIG bytes once and detects edits on the next replay', () => {
  const editor = createEditor()
  const bytes = new Uint8Array(1024)
  bytes[0] = 1
  const nodes = Array.from({ length: 20 }, () => {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId)
    node.source.fig.rawNodeFields = { payload: bytes }
    return node
  })
  const snapshot = editor.snapshotPage()
  const first = expectDefined(nodes[0], 'first')
  editor.graph.updateNode(first.id, { x: 10 })
  const reads = spyOn(DataView.prototype, 'getUint32')
  try {
    editor.restorePageFromSnapshot(snapshot)
    expect(reads.mock.calls.length).toBeGreaterThan(0)
    expect(reads.mock.calls.length).toBeLessThanOrEqual((bytes.byteLength / 4) * 2)
    bytes[0] = 9
    editor.restorePageFromSnapshot(snapshot)
    for (const node of nodes) {
      const payload = editor.graph.getNode(node.id)?.source.fig.rawNodeFields.payload
      if (!(payload instanceof Uint8Array)) throw new Error('Owned source payload missing')
      expect(payload[0]).toBe(1)
    }
  } finally {
    reads.mockRestore()
    editor.dispose()
  }
})

test('cold history owns shared backing views across page and dependent instance payloads', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const component = editor.graph.createNode('COMPONENT', page)
  const buffer = new ArrayBuffer(32)
  const left = new Uint8Array(buffer, 3, 9)
  left.set([1, 2, 3, 4, 5, 6, 7, 8, 9])
  const child = editor.graph.createNode('TEXT', component.id, { textPicture: left })
  const foreign = editor.graph.addPage('Foreign')
  const instance = expectDefined(editor.graph.createInstance(component.id, foreign.id), 'instance')
  const derived = expectDefined(editor.graph.getChildren(instance.id)[0], 'derived')
  const right = new Uint8Array(buffer, 7, 5)
  editor.graph.updateNode(derived.id, { textPicture: right })
  const snapshot = editor.snapshotPage(page)
  const ownedLeft = expectDefined(snapshot.get(child.id)?.textPicture, 'owned left')
  const ownedRight = expectDefined(snapshot.get(derived.id)?.textPicture, 'owned right')
  expect(ownedLeft.buffer).toBe(ownedRight.buffer)
  expect(ownedLeft.buffer).not.toBe(buffer)
  expect([ownedLeft.byteOffset, ownedLeft.byteLength]).toEqual([3, 9])
  expect([ownedRight.byteOffset, ownedRight.byteLength]).toEqual([7, 5])
  left[4] = 99
  expect(ownedRight[0]).toBe(5)
  editor.restorePageFromSnapshot(snapshot)
  expect(editor.graph.getNode(derived.id)?.textPicture?.[0]).toBe(5)
  expect(editor.graph.getNode(derived.id)?.componentId).toBe(snapshot.get(derived.id)?.componentId)
  editor.dispose()
})

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

test('scalar edits reuse immutable payload fields across history while payload edits stay isolated', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const bytes = new Uint8Array([1, 2, 3])
  const a = editor.graph.createNode('TEXT', page, { textPicture: bytes })
  const b = editor.graph.createNode('TEXT', page, { textPicture: bytes })
  const before = editor.snapshotPage(page)
  editor.graph.updateNode(a.id, { x: 10, name: 'Moved text' })
  editor.graph.updateNode(b.id, { x: 20 })
  const after = editor.snapshotPage(page, before)
  expect(after.get(a.id)).not.toBe(before.get(a.id))
  expect(after.get(a.id)?.textPicture).toBe(before.get(a.id)?.textPicture)
  expect(after.get(b.id)?.textPicture).toBe(before.get(a.id)?.textPicture)
  expect(after.get(a.id)?.textPicture).not.toBe(bytes)
  const added = editor.graph.createNode('TEXT', page, { textPicture: bytes })
  const extended = editor.snapshotPage(page, after)
  expect(extended.get(added.id)?.textPicture).toBe(after.get(a.id)?.textPicture)
  bytes[0] = 9
  const changed = editor.snapshotPage(page, extended)
  expect(changed.get(a.id)?.textPicture).not.toBe(after.get(a.id)?.textPicture)
  expect(changed.get(a.id)?.textPicture).toBe(changed.get(b.id)?.textPicture)
  expect(changed.get(a.id)?.textPicture?.[0]).toBe(9)
  expect(before.get(a.id)?.textPicture?.[0]).toBe(1)
  editor.restorePageFromSnapshot(after)
  expect(editor.graph.getNode(a.id)?.x).toBe(10)
  expect(editor.graph.getNode(a.id)?.textPicture?.[0]).toBe(1)
  editor.restorePageFromSnapshot(before)
  expect(editor.graph.getNode(a.id)?.x).toBe(0)
})

test('source edit markers share only the owned FIG payload across history revisions', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const node = editor.graph.createNode('TEXT', page)
  const bytes = new Uint8Array(256 * 1024)
  bytes[0] = 1
  node.source.format = 'fig'
  node.source.fig.rawNodeFields = { payload: bytes }
  const before = editor.snapshotPage(page)
  const saved = expectDefined(before.get(node.id), 'saved source')
  expect(saved.source.fig).not.toBe(node.source.fig)
  editor.graph.updateNode(node.id, { name: 'Changed' })
  const named = editor.snapshotPage(page, before)
  expect(named.get(node.id)?.source).not.toBe(saved.source)
  expect(named.get(node.id)?.source.fig).toBe(saved.source.fig)
  expect(saved.source.editedFields).toEqual([])
  editor.graph.updateNode(node.id, { text: 'New text' })
  const written = editor.snapshotPage(page, named)
  expect(written.get(node.id)?.source.fig).toBe(saved.source.fig)
  bytes[0] = 9
  const changed = editor.snapshotPage(page, written)
  expect(changed.get(node.id)?.source.fig).not.toBe(saved.source.fig)
  const savedBytes = saved.source.fig.rawNodeFields.payload
  if (!(savedBytes instanceof Uint8Array)) throw new Error('Missing owned source bytes')
  expect(savedBytes[0]).toBe(1)
  editor.restorePageFromSnapshot(written)
  expect(editor.graph.getNode(node.id)?.source.fig).not.toBe(saved.source.fig)
  expect(editor.graph.getNode(node.id)?.source.fig.rawNodeFields.payload).toEqual(
    saved.source.fig.rawNodeFields.payload
  )
  editor.dispose()
})

test('dependent instance history shares binary copies and leaves unrelated foreign page nodes outside the snapshot', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const component = editor.graph.createNode('COMPONENT', page)
  const bytes = new Uint8Array([1, 2, 3])
  const child = editor.graph.createNode('TEXT', component.id, { textPicture: bytes })
  const other = editor.graph.addPage('Instances')
  const instance = expectDefined(editor.graph.createInstance(component.id, other.id), 'instance')
  const derived = expectDefined(editor.graph.getChildren(instance.id)[0], 'derived text')
  editor.graph.updateNode(derived.id, { textPicture: bytes })
  const unrelated = editor.graph.createNode('RECTANGLE', other.id)
  const before = editor.snapshotPage(page)
  const after = editor.snapshotPage(page, before)
  expect(before.has(unrelated.id)).toBe(false)
  expect(before.has(other.id)).toBe(false)
  expect(before.get(child.id)?.textPicture).toBe(before.get(derived.id)?.textPicture)
  expect(after.get(derived.id)).toBe(before.get(derived.id))
  expect(before.get(derived.id)).not.toBe(derived)
})

test('dependent history reparenting owns the captured instance, never a new foreign component ancestor', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const main = editor.graph.createNode('COMPONENT', page)
  editor.graph.createNode('RECTANGLE', main.id)
  const other = editor.graph.addPage('Other')
  const instance = expectDefined(editor.graph.createInstance(main.id, other.id), 'instance')
  const foreign = editor.graph.createNode('COMPONENT', other.id)
  const untouched = editor.graph.createNode('RECTANGLE', foreign.id)
  const before = editor.snapshotPage(page)
  editor.graph.reparentNode(instance.id, foreign.id)
  const after = editor.snapshotPage(page, before)
  editor.restorePageFromSnapshot(before)
  expect(editor.graph.getNode(foreign.id)).toBe(foreign)
  expect(editor.graph.getNode(untouched.id)).toBe(untouched)
  expect(editor.graph.getNode(instance.id)?.parentId).toBe(other.id)
  editor.restorePageFromSnapshot(after)
  expect(editor.graph.getNode(instance.id)?.parentId).toBe(foreign.id)
  expect(editor.graph.getChildren(foreign.id).map((node) => node.id)).toEqual([
    untouched.id,
    instance.id
  ])
})

test('a captured ordinary subtree moved across pages restores both history directions', () => {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const other = editor.graph.addPage('Other')
  const moved = editor.graph.createNode('FRAME', page)
  const child = editor.graph.createNode('RECTANGLE', moved.id)
  const untouched = editor.graph.createNode('RECTANGLE', other.id)
  const before = editor.snapshotPage(page)
  editor.graph.reparentNode(moved.id, other.id)
  const after = editor.snapshotPage(page, before)
  editor.restorePageFromSnapshot(before)
  expect(editor.graph.getNode(moved.id)?.parentId).toBe(page)
  editor.restorePageFromSnapshot(after)
  expect(editor.graph.getNode(moved.id)?.parentId).toBe(other.id)
  expect(editor.graph.getNode(child.id)?.parentId).toBe(moved.id)
  expect(editor.graph.getNode(untouched.id)).toBe(untouched)
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
  const otherPage = editor.graph.addPage('Other')
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
