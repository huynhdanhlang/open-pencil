import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { initCanvasKit } from '@open-pencil/core/io'
import { SceneGraph, setInstanceOverride } from '@open-pencil/scene-graph'

import { exportFigFile, parseFigFile } from '#core/io/formats/fig'
import { computeAllLayouts } from '#core/layout'

test('nested fill media instances keep their own AUTO placement across FIG import and layout', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const library = graph.addPage('Media library')
  const set = graph.createNode('COMPONENT_SET', library.id, { name: 'Frame variants' })
  const master = graph.createNode('COMPONENT', set.id, {
    name: 'Frame=6',
    width: 724,
    height: 407.25,
    layoutMode: 'HORIZONTAL',
    layoutPositioning: 'ABSOLUTE'
  })
  graph.createNode('RECTANGLE', master.id, {
    name: 'Fill media leaf',
    width: 724,
    height: 407.25,
    layoutGrow: 1,
    layoutAlignSelf: 'STRETCH'
  })
  const panel = graph.createNode('COMPONENT', library.id, {
    name: 'Storyboard panel',
    width: 756,
    height: 450,
    layoutMode: 'VERTICAL',
    paddingLeft: 16,
    paddingRight: 16
  })
  const wrapper = graph.createNode('FRAME', panel.id, {
    name: 'Exact media wrapper',
    width: 724,
    height: 407.25,
    layoutMode: 'VERTICAL'
  })
  expectDefined(
    graph.createInstance(master.id, wrapper.id, {
      name: 'Hero media occurrence',
      layoutPositioning: 'AUTO',
      primaryAxisSizing: 'HUG',
      layoutAlignSelf: 'STRETCH'
    })
  )
  expectDefined(graph.createInstance(panel.id, page.id, { name: 'Storyboard consumer' }))
  expectDefined(
    graph.createInstance(master.id, page.id, {
      name: 'Explicit absolute media',
      layoutPositioning: 'ABSOLUTE'
    })
  )
  const ck = await initCanvasKit()
  const bytes = await exportFigFile(graph, ck)
  const reopened = await parseFigFile(bytes.buffer as ArrayBuffer, { populate: 'all' })
  const heroes = [...reopened.getAllNodes()].filter((n) => n.name === 'Hero media occurrence')
  expect(heroes).toHaveLength(2)
  for (const hero of heroes) expect(hero.layoutPositioning).toBe('AUTO')
  expect(
    expectDefined([...reopened.getAllNodes()].find((n) => n.name === 'Explicit absolute media'))
      .layoutPositioning
  ).toBe('ABSOLUTE')
  computeAllLayouts(reopened)
  computeAllLayouts(reopened)
  for (const hero of heroes) {
    expect(hero.width).toBe(724)
    expect(hero.height).toBe(407.25)
    const leaf = expectDefined(reopened.getChildren(hero.id)[0])
    expect(leaf.width).toBe(724)
    expect(leaf.height).toBe(407.25)
  }
})

test('explicit nested placement overrides survive repeated FIG Save/import', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const media = graph.createNode('COMPONENT', page.id, {
    name: 'Placement media',
    width: 32,
    height: 24,
    layoutPositioning: 'ABSOLUTE'
  })
  const host = graph.createNode('COMPONENT', page.id, {
    name: 'Placement host',
    width: 100,
    height: 100
  })
  expectDefined(
    graph.createInstance(media.id, host.id, { name: 'Placement child', layoutPositioning: 'AUTO' })
  )
  const consumer = expectDefined(
    graph.createInstance(host.id, page.id, { name: 'Placement consumer' })
  )
  const nested = expectDefined(graph.getChildren(consumer.id)[0])
  graph.updateNode(nested.id, { layoutPositioning: 'ABSOLUTE' })
  setInstanceOverride(
    consumer.instanceOverrides,
    consumer.id,
    nested.id,
    'layoutPositioning',
    'ABSOLUTE'
  )
  const ck = await initCanvasKit()
  let current = graph
  for (let generation = 0; generation < 2; generation++) {
    const bytes = await exportFigFile(current, ck)
    current = await parseFigFile(bytes.buffer as ArrayBuffer, { populate: 'all' })
    const source = expectDefined(
      [...current.getAllNodes()].find((n) => n.name === 'Placement host')
    )
    const use = expectDefined(
      [...current.getAllNodes()].find((n) => n.name === 'Placement consumer')
    )
    expect(expectDefined(current.getChildren(source.id)[0]).layoutPositioning).toBe('AUTO')
    expect(expectDefined(current.getChildren(use.id)[0]).layoutPositioning).toBe('ABSOLUTE')
  }
})
