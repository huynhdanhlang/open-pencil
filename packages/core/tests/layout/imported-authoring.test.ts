import { expect, test } from 'bun:test'

import {
  finishRenderPlacement,
  renderJSX,
  renderTreeRoots,
  resolveRenderPlacement
} from '@open-pencil/core/design-jsx'
import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

test('inserting authored content reflows imported AUTO siblings, preserving cold geometry and Undo', async () => {
  const source = new SceneGraph()
  await renderJSX(
    source,
    `<>
    <Frame name="Target" flex="col" w={200} h={400} gap={10} p={10}>
      <Frame name="Old top" w={100} h={60} />
      <Frame name="Old bottom" w={100} h={60} />
    </Frame>
    <Frame name="Untouched" flex="col" w={200} h={400}>
      <Frame name="Stored irregular geometry" w={100} h={60} />
    </Frame>
  </>`
  )
  const named = (graph: SceneGraph, name: string) => {
    const node = [...graph.getAllNodes()].find((item) => item.name === name)
    if (!node) throw new Error(`Missing fixture node: ${name}`)
    return node
  }
  source.updateNode(named(source, 'Stored irregular geometry').id, { x: 33, y: 999 })
  const graph = await parseFigFile(await exportFigFile(source))
  const parent = named(graph, 'Target')
  const bottom = named(graph, 'Old bottom')
  const unrelated = named(graph, 'Stored irregular geometry')
  const pageId = graph.getPages()[0].id
  computeAllLayouts(graph, pageId)
  expect(parent.source.format).toBe('fig')
  expect(bottom.source.format).toBe('fig')
  expect(bottom.y).toBe(80)
  expect(unrelated).toMatchObject({ x: 33, y: 999 })

  const editor = createEditor({ graph, skipInitialGraphSetup: true })
  try {
    const before = editor.snapshotPage(pageId)
    const placement = resolveRenderPlacement(
      graph,
      { parent_id: parent.id, insert_index: 1 },
      pageId
    )
    const roots = await renderTreeRoots(
      graph,
      {
        type: 'frame',
        props: { name: 'Inserted', w: 100, h: 60 },
        children: []
      },
      placement
    )
    finishRenderPlacement(graph, roots, placement)
    expect(graph.getChildren(parent.id).map((node) => [node.name, node.y])).toEqual([
      ['Old top', 10],
      ['Inserted', 80],
      ['Old bottom', 150]
    ])
    expect(graph.getNode(bottom.id)).toMatchObject({ width: 100, height: 60 })
    expect(graph.getNode(unrelated.id)).toMatchObject({ x: 33, y: 999 })
    const after = editor.snapshotPage(pageId, before)
    editor.pushUndoEntry({
      label: 'Owned insertion',
      forward: () => editor.restorePageFromSnapshot(after),
      inverse: () => editor.restorePageFromSnapshot(before)
    })
    editor.undoAction()
    expect(graph.getChildren(parent.id).map((node) => [node.name, node.y])).toEqual([
      ['Old top', 10],
      ['Old bottom', 80]
    ])
    editor.redoAction()
    expect(graph.getNode(bottom.id)?.y).toBe(150)
    const reopened = await parseFigFile(await exportFigFile(graph))
    computeAllLayouts(reopened, reopened.getPages()[0].id)
    expect(
      reopened.getChildren(named(reopened, 'Target').id).map((node) => [node.name, node.y])
    ).toEqual([
      ['Old top', 10],
      ['Inserted', 80],
      ['Old bottom', 150]
    ])
    expect(named(reopened, 'Stored irregular geometry')).toMatchObject({ x: 33, y: 999 })
  } finally {
    editor.dispose()
  }
})

test('failed authored reflow restores imported source markers with geometry', async () => {
  const source = new SceneGraph()
  const [root] = await renderJSX(
    source,
    `<Frame flex="col" w={200} h={400} gap={10} p={10}>
    <Frame name="First" w={100} h={60}/><Frame name="Second" w={100} h={60}/>
  </Frame>`
  )
  const [first, second] = source.getChildren(root.id)
  source.updateNode(first.id, { x: 33 })
  source.updateNode(second.id, { y: 99 })
  const graph = await parseFigFile(await exportFigFile(source))
  const parent = graph.getChildren(graph.getPages()[0].id)[0]
  const last = graph.getChildren(parent.id)[1]
  const before = structuredClone([...graph.nodes])
  let fail = true
  graph.onNodeEvents({
    updated: (id, changes) => {
      if (fail && id === last.id && changes.y !== undefined) {
        fail = false
        throw new Error('Later imported sibling failed')
      }
    }
  })
  await expect(
    renderJSX(graph, '<Frame w={100} h={60}/>', { parentId: parent.id })
  ).rejects.toThrow('Later imported sibling failed')
  expect([...graph.nodes]).toEqual(before)
})

test('authored reflow stops at imported INSTANCE geometry', async () => {
  const source = new SceneGraph()
  await renderJSX(
    source,
    `<Frame flex="col" w={200} h={400} gap={10} p={10}>
    <Frame name="Nested" flex="col" w={100} h={120}>
      <Frame w={80} h={30}/>
    </Frame><Frame name="Stored sibling" w={100} h={60}/>
  </Frame>`
  )
  const graph = await parseFigFile(await exportFigFile(source))
  const parent = graph.getChildren(graph.getPages()[0].id)[0]
  // Use the imported source metadata and a baked instance boundary.
  parent.type = 'INSTANCE'
  const [nested, sibling] = graph.getChildren(parent.id)
  expect(nested.layoutMode).toBe('VERTICAL')
  graph.updateNode(nested.id, { y: 66 })
  graph.updateNode(sibling.id, { y: 777 })
  await renderJSX(graph, '<Frame w={80} h={30}/>', { parentId: nested.id })
  expect(nested.y).toBe(66)
  expect(sibling.y).toBe(777)
  expect(graph.getChildren(nested.id).map((node) => node.y)).toEqual([0, 30])
})
