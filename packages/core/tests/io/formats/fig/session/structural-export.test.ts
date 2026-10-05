import { expect, test } from 'bun:test'

import { initCodec } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph } from '@open-pencil/scene-graph'

import { exportFigFile } from '#core/io/formats/fig/export'
import { registerReaderSession } from '#core/kiwi/fig/session/document-state'
import { openReaderSession } from '#core/kiwi/fig/session/reader'

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
    reopened.graph.getAllNodes().some((node) => node.name === 'Deleted unloaded component')
  ).toBe(false)
  expect(reopened.graph.getAllNodes().some((node) => node.text === 'Unloaded content')).toBe(true)
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
    const component = session.graph.getAllNodes().find((node) => node.name === 'Component')
    if (!component) throw new Error('Missing component')
    const page = session.graph.getPages()[0]
    const retained = session.graph.addPage('Retained')
    session.graph.createNode('TEXT', retained.id, { name: 'Unsaved work', text: 'Preserve me' })
    session.graph.deleteNode(target === 'component' ? component.id : page.id)
    const before = structuredClone([...session.graph.nodes])
    const bytes = await exportFigFile(session.graph)
    expect([...session.graph.nodes]).toEqual(before)
    const reopened = await openReaderSession(bytes.slice().buffer as ArrayBuffer, 'all')
    expect(reopened.graph.getAllNodes().some((node) => node.name === 'Component')).toBe(false)
    expect(reopened.graph.getAllNodes().find((node) => node.name === 'Unsaved work')?.text).toBe(
      'Preserve me'
    )
    expect(reopened.graph.getPages().map((node) => node.name)).toEqual(
      session.graph.getPages().map((node) => node.name)
    )
  })
}
