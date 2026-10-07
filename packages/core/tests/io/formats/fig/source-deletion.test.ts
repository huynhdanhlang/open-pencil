import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile, populateFigPage } from '@open-pencil/core/io/formats/fig'
import { SceneGraph } from '@open-pencil/scene-graph'

function named(graph: SceneGraph, name: string) {
  const nodes = [...graph.nodes.values()].filter((node) => node.name === name)
  if (nodes.length !== 1) throw new Error(`Missing/ambiguous fixture ${name}`)
  return nodes[0]
}

test('deleting deeply nested loaded source controls survives two full Saves and unvisited instance imports', async () => {
  const original = new SceneGraph()
  original.createNode('RECTANGLE', original.getPages()[0].id, { name: 'Cover' })
  const sourcePage = original.addPage('Sources')
  const source = original.createNode('COMPONENT', sourcePage.id, { name: 'Captured controls' })
  const nested = original.createNode('FRAME', source.id, { name: 'Nested controls' })
  original.createNode('FRAME', nested.id, { name: 'Remove disabled' })
  original.createNode('FRAME', nested.id, { name: 'Guided disabled' })
  original.createNode('TEXT', nested.id, { name: 'Read-only label', text: 'Before' })
  const screen = original.addPage('Unvisited screen')
  original.createInstance(source.id, screen.id)
  let bytes = await exportFigFile(original, undefined, undefined, undefined, false, {
    rendering: 'none'
  })
  for (let generation = 0; generation < 2; generation++) {
    const graph = await parseFigFile(bytes.slice().buffer as ArrayBuffer, {
      populate: 'first-page'
    })
    const page = graph.getPages().find((node) => node.name === 'Sources')
    if (!page) throw new Error('Missing source page')
    populateFigPage(graph, page.id)
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    editor.subscribeToGraph()
    try {
      await editor.runMutationWithLayout(() => {
        if (generation === 0) {
          graph.deleteNode(named(graph, 'Remove disabled').id)
          graph.deleteNode(named(graph, 'Guided disabled').id)
        }
        graph.updateNode(named(graph, 'Read-only label').id, { text: `Read-only ${generation}` })
      }, page.id)
      bytes = await exportFigFile(graph, undefined, undefined, page.id, false, {
        rendering: 'none'
      })
      const imported = await parseFigFile(bytes.slice().buffer as ArrayBuffer, { populate: 'all' })
      expect([...imported.nodes.values()].some((node) => node.name === 'Remove disabled')).toBe(
        false
      )
      expect([...imported.nodes.values()].some((node) => node.name === 'Guided disabled')).toBe(
        false
      )
      const labels = [...imported.nodes.values()].filter((node) => node.name === 'Read-only label')
      expect(labels).toHaveLength(2)
      expect(labels.map((node) => node.text)).toEqual([
        `Read-only ${generation}`,
        `Read-only ${generation}`
      ])
    } finally {
      editor.dispose()
      editor.releaseGraphResources()
    }
  }
})
