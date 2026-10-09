import { expect, test } from 'bun:test'

import { exportFigFile } from '@open-pencil/core/io'
import { initCodec } from '@open-pencil/core/kiwi'
import { createFigDocumentSession } from '@open-pencil/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

for (const editMaster of [false, true]) {
  test(`a later page retains placed root dimensions${editMaster ? ' except a live master size edit' : ''}`, async () => {
    const source = new SceneGraph()
    const library = source.getPages()[0]
    const master = source.createNode('COMPONENT', library.id, {
      name: 'Resizable',
      width: 752,
      height: 120
    })
    source.createNode('RECTANGLE', master.id, { width: 80, height: 24 })
    const placed = source.createInstance(master.id, source.addPage('Placed').id)
    if (!placed) throw new Error('Missing placed instance')
    source.updateNode(placed.id, { width: 1000, height: 240 })
    const bytes = await exportFigFile(source, undefined, undefined, undefined, false, {
      rendering: 'none'
    })
    const session = createFigDocumentSession(bytes.buffer as ArrayBuffer, { derivedBounds: true })
    const importedEvents: boolean[] = []
    const stop = session.graph.onNodeEvents({
      created: () => importedEvents.push(session.graph.isApplyingImportedState),
      updated: () => importedEvents.push(session.graph.isApplyingImportedState)
    })
    session.loadPage(session.pages[0].id)
    expect(importedEvents.length).toBeGreaterThan(0)
    expect(importedEvents.every(Boolean)).toBe(true)
    stop()
    const libraryId = session.graphPageId(session.pages[0].id) ?? ''
    const loadedMaster = session.graph
      .getChildren(libraryId)
      .find((node) => node.name === 'Resizable')
    if (!loadedMaster) throw new Error('Missing loaded master')
    expect(loadedMaster.source.editedFields).not.toContain('width')
    if (editMaster) session.graph.updateNode(loadedMaster.id, { width: 800 })
    const page = session.pages.find((candidate) => candidate.name === 'Placed')
    if (!page) throw new Error('Missing placed page')
    session.loadPage(page.id)
    const loaded = session.graph.getChildren(session.graphPageId(page.id) ?? '')[0]
    expect(loaded.width).toBe(editMaster ? 800 : 1000)
    expect(loaded.height).toBe(240)
    expect(loaded.source.editedFields).not.toContain('width')
    expect(loaded.source.editedFields).not.toContain('height')
  })
}

test('saved root sizes do not suppress an instance width variable binding', async () => {
  const source = new SceneGraph()
  const page = source.getPages()[0]
  const collection = source.createCollection('Sizing')
  const width = source.createVariable('width', 'FLOAT', collection.id, 360)
  const master = source.createNode('COMPONENT', page.id, { width: 752, height: 120 })
  const instance = source.createInstance(master.id, page.id)
  if (!instance) throw new Error('Missing bound instance')
  source.updateNode(instance.id, { width: 1000, boundVariables: { width: width.id } })
  const bytes = await exportFigFile(source, undefined, undefined, undefined, false, {
    rendering: 'none'
  })
  const session = createFigDocumentSession(bytes.buffer as ArrayBuffer, { derivedBounds: true })
  session.loadPage(session.pages[0].id)
  const loaded = session.graph
    .getChildren(session.graphPageId(session.pages[0].id) ?? '')
    .find((node) => node.type === 'INSTANCE')
  expect(loaded?.width).toBe(360)
  expect(loaded?.source.editedFields).not.toContain('width')
})

test('loading a later page keeps the derived sizes of instances earlier pages placed', async () => {
  await initCodec()
  const source = new SceneGraph()
  const first = source.getPages()[0]
  const component = source.createNode('COMPONENT', first.id, { name: 'Field', width: 200 })
  source.createNode('RECTANGLE', component.id, { name: 'Box', width: 100, height: 20 })
  const placed = source.createInstance(component.id, first.id)
  if (!placed) throw new Error('Missing instance')
  // The instance's box is wider than the component's, as a fill child of a resized instance is;
  // export saves that as the size Figma derived for it.
  const box = source.getChildren(placed.id)[0]
  source.updateNode(box.id, { width: 150 })
  source.createInstance(component.id, source.addPage('Second').id)
  const bytes = await exportFigFile(source)

  // The app's sessions read the sizes Figma derived, as this one does.
  const session = createFigDocumentSession(bytes.buffer as ArrayBuffer, { derivedBounds: true })
  session.loadPage(session.pages[0].id)
  const firstPageId = session.graphPageId(session.pages[0].id)
  const instance = session.graph
    .getChildren(firstPageId ?? '')
    .find((node) => node.type === 'INSTANCE')
  if (!instance) throw new Error('Missing loaded instance')
  const loadedBox = () => session.graph.getChildren(instance.id)[0]
  expect(loadedBox().width).toBe(150)

  session.loadPage(session.pages[1].id)
  expect(loadedBox().width).toBe(150)
})

test('loading a later page keeps a live edit to a nested instance layer over its derived size', async () => {
  await initCodec()
  const source = new SceneGraph()
  const library = source.getPages()[0]
  const inner = source.createNode('COMPONENT', library.id, { name: 'Inner', width: 100 })
  source.createNode('RECTANGLE', inner.id, { name: 'Box', width: 100, height: 20 })
  const outer = source.createNode('COMPONENT', library.id, { name: 'Outer', width: 300 })
  const layer = source.createInstance(inner.id, outer.id)
  if (!layer) throw new Error('Missing nested instance layer')
  const placed = source.createInstance(outer.id, source.addPage('Placed').id)
  if (!placed) throw new Error('Missing placed instance')
  // Figma derived a wider nested instance in the placed copy, as a fill child would be.
  const nested = source.getChildren(placed.id)[0]
  source.updateNode(nested.id, { width: 150 })
  const bytes = await exportFigFile(source)

  const session = createFigDocumentSession(bytes.buffer as ArrayBuffer, { derivedBounds: true })
  session.loadPage(session.pages[0].id)
  const libraryId = session.graphPageId(session.pages[0].id) ?? ''
  const loadedOuter = session.graph.getChildren(libraryId).find((node) => node.name === 'Outer')
  const loadedLayer = loadedOuter ? session.graph.getChildren(loadedOuter.id)[0] : undefined
  if (!loadedLayer) throw new Error('Missing loaded nested instance layer')
  // Editing the component's layer live, after the file opened.
  session.graph.updateNode(loadedLayer.id, { width: 120 })
  expect(session.graph.getNode(loadedLayer.id)?.source.editedFields).toContain('width')

  const placedPage = session.pages.find((page) => page.name === 'Placed')
  if (!placedPage) throw new Error('Missing placed page')
  session.loadPage(placedPage.id)
  const placedId = session.graphPageId(placedPage.id) ?? ''
  const loadedPlaced = session.graph.getChildren(placedId)[0]
  expect(session.graph.getChildren(loadedPlaced.id)[0].width).toBe(120)
})

/**
 * Syncing a whole component visits every instance of it in the graph, including those earlier
 * pages placed, whose sizes Figma derived. A resumed page syncs only the instances it places,
 * each once.
 */
test('a resumed page load syncs each instance it places once, never a whole component', async () => {
  await initCodec()
  const source = new SceneGraph()
  const library = source.getPages()[0]
  const component = source.createNode('COMPONENT', library.id, { name: 'Badge' })
  source.createNode('TEXT', component.id, { name: 'Label', text: 'Badge' })
  const page = source.addPage('Placed')
  for (let index = 0; index < 8; index++) source.createInstance(component.id, page.id)
  const bytes = await exportFigFile(source)

  const session = createFigDocumentSession(bytes.buffer as ArrayBuffer)
  const synced: string[] = []
  const wholeComponents: string[] = []
  const syncInstance = session.graph.syncInstance.bind(session.graph)
  session.graph.syncInstance = (instanceId: string) => {
    synced.push(instanceId)
    return syncInstance(instanceId)
  }
  const syncInstances = session.graph.syncInstances.bind(session.graph)
  session.graph.syncInstances = (componentId: string) => {
    wholeComponents.push(componentId)
    return syncInstances(componentId)
  }
  const placed = session.pages.find((candidate) => candidate.name === 'Placed')
  if (!placed) throw new Error('Missing placed page')
  session.loadPage(placed.id)

  const pageId = session.graphPageId(placed.id)
  if (!pageId) throw new Error('Missing materialized page')
  const instances = session.graph.getChildren(pageId)
  expect(instances).toHaveLength(8)
  expect(wholeComponents).toEqual([])
  expect(synced.toSorted()).toEqual(instances.map((instance) => instance.id).toSorted())
  for (const instance of instances)
    expect(session.graph.getChildren(instance.id)[0].text).toBe('Badge')
})
