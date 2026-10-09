import { expect, test } from 'bun:test'

import { parseFigBuffer } from '@open-pencil/fig'
import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

import { exportFigFile } from '#core/io/formats/fig/export'
import { registerReaderSession } from '#core/kiwi/fig/session/document-state'
import { openReaderSession } from '#core/kiwi/fig/session/reader'

test('saving pending pages keeps a moved component under its live parent exactly once', async () => {
  await initCodec()
  const source = new SceneGraph()
  const page = source.getPages()[0]
  const oldParent = source.createNode('FRAME', page.id, { name: 'Old owner' })
  const component = source.createNode('COMPONENT', oldParent.id, { name: 'Phase=Shots' })
  source.createNode('RECTANGLE', oldParent.id, { name: 'First' })
  source.createNode('RECTANGLE', oldParent.id, { name: 'Last' })
  const child = source.createNode('FRAME', component.id, { name: 'Body' })
  source.createNode('TEXT', child.id, { name: 'Title', text: 'Shots' })
  const pending = source.addPage('Pending instances')
  source.createInstance(component.id, pending.id)
  const archive = await exportFigFile(source)
  const bytes = archive.slice().buffer as ArrayBuffer
  const reader = openReaderSession(bytes, 'first-page')
  registerReaderSession(bytes, reader.session)
  const find = (name: string) => {
    const node = [...reader.graph.getAllNodes()].find((node) => node.name === name)
    if (!node) throw new Error(`Missing ${name}`)
    return node
  }
  const moved = find('Phase=Shots')
  const old = find('Old owner')
  const liveParent = reader.graph.createNode('FRAME', reader.graph.getPages()[0].id, {
    name: 'New owner'
  })
  reader.graph.reparentNode(moved.id, liveParent.id)
  const inserted = reader.graph.createNode('RECTANGLE', old.id, { name: 'Live middle' })
  reader.graph.reorderChild(inserted.id, old.id, 1)
  const before = structuredClone([...reader.graph.nodes])
  const saved = await exportFigFile(reader.graph)
  expect([...reader.graph.nodes]).toEqual(before)
  const parsed = parseFigBuffer(saved.slice().buffer as ArrayBuffer)
  const guids = parsed.nodeChanges.map((node) => `${node.guid?.sessionID}:${node.guid?.localID}`)
  expect(new Set(guids).size).toBe(guids.length)
  const cold = openReaderSession(saved.slice().buffer as ArrayBuffer, 'all').graph
  const masters = [...cold.getAllNodes()].filter(
    (node) => node.name === 'Phase=Shots' && node.type === 'COMPONENT'
  )
  expect(masters).toHaveLength(1)
  expect(cold.getNode(masters[0].parentId!)?.name).toBe('New owner')
  const coldOld = [...cold.getAllNodes()].find((node) => node.name === old.name)
  expect(coldOld && cold.getChildren(coldOld.id).map((node) => node.name)).toEqual([
    'First',
    'Live middle',
    'Last'
  ])
  const instance = [...cold.getAllNodes()].find((node) => node.type === 'INSTANCE')
  expect(instance?.componentId).toBe(masters[0].id)
  expect(instance && cold.getChildren(cold.getChildren(instance.id)[0].id)[0].text).toBe('Shots')
})

async function sessionWithComponent() {
  await initCodec()
  const source = new SceneGraph()
  const component = source.createNode('COMPONENT', source.getPages()[0].id, { name: 'Component' })
  source.createNode('RECTANGLE', component.id, { name: 'Delete me' })
  const bytes = await exportFigFile(source)
  const session = openReaderSession(bytes.slice().buffer as ArrayBuffer, 'all')
  registerReaderSession(bytes.slice().buffer as ArrayBuffer, session.session)
  return session
}

test('export keeps an unloaded deleted page absent while loading retained pages', async () => {
  await initCodec()
  const source = new SceneGraph()
  source.createNode('TEXT', source.getPages()[0].id, { text: 'Loaded' })
  const deleted = source.addPage('Deleted before population')
  source.createNode('COMPONENT', deleted.id, { name: 'Deleted unloaded component' })
  const retained = source.addPage('Retained unloaded page')
  source.createNode('TEXT', retained.id, { text: 'Unloaded content' })
  const bytes = await exportFigFile(source)
  const reader = openReaderSession(bytes.slice().buffer as ArrayBuffer, 'first-page')
  registerReaderSession(bytes.slice().buffer as ArrayBuffer, reader.session)
  const page = reader.graph.getPages().find((node) => node.name === deleted.name)
  if (!page) throw new Error('Missing unloaded page shell')
  reader.graph.deleteNode(page.id)
  const before = structuredClone([...reader.graph.nodes])
  const saved = await exportFigFile(reader.graph)
  expect([...reader.graph.nodes]).toEqual(before)
  const reopened = openReaderSession(saved.slice().buffer as ArrayBuffer, 'all')
  expect(reopened.graph.getPages().map((node) => node.name)).toEqual(['Page 1', retained.name])
  expect(
    [...reopened.graph.getAllNodes()].some((node) => node.name === 'Deleted unloaded component')
  ).toBe(false)
  expect([...reopened.graph.getAllNodes()].some((node) => node.text === 'Unloaded content')).toBe(
    true
  )
})

test('loaded structural component edits can be checkpointed and exported', async () => {
  const session = await sessionWithComponent()
  const component = [...session.graph.getAllNodes()].find((node) => node.name === 'Component')
  if (!component) throw new Error('Missing component')
  session.graph.deleteNode(session.graph.getChildren(component.id)[0].id)
  expect(() => session.checkpoint()).not.toThrow()
  await expect(exportFigFile(session.graph)).resolves.toBeInstanceOf(Uint8Array)
})

for (const target of ['component', 'page'] as const) {
  test(`export preserves a deleted loaded ${target} without resuming its stale component`, async () => {
    const session = await sessionWithComponent()
    const component = [...session.graph.getAllNodes()].find((node) => node.name === 'Component')
    if (!component) throw new Error('Missing component')
    const page = session.graph.getPages()[0]
    const retained = session.graph.addPage('Retained')
    session.graph.createNode('TEXT', retained.id, { name: 'Unsaved work', text: 'Preserve me' })
    session.graph.deleteNode(target === 'component' ? component.id : page.id)
    const before = structuredClone([...session.graph.nodes])
    const bytes = await exportFigFile(session.graph)
    expect([...session.graph.nodes]).toEqual(before)
    const reopened = await openReaderSession(bytes.slice().buffer as ArrayBuffer, 'all')
    expect([...reopened.graph.getAllNodes()].some((node) => node.name === 'Component')).toBe(false)
    expect(
      [...reopened.graph.getAllNodes()].find((node) => node.name === 'Unsaved work')?.text
    ).toBe('Preserve me')
    expect(reopened.graph.getPages().map((node) => node.name)).toEqual(
      session.graph.getPages().map((node) => node.name)
    )
  })
}
