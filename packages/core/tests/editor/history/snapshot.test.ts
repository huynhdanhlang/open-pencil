import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

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
