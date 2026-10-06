import { expect, test } from 'bun:test'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import { createDesignJSXRenderer } from '@open-pencil/design-jsx'
import { SceneGraph } from '@open-pencil/scene-graph'

const invalidMetadata = `<Component properties={[
  {id:"visible",name:"Visible",type:"BOOLEAN",defaultValue:true}
]}><Text>Invalid</Text></Component>`

test('late metadata rejection leaves no partial fragment or component descendants', async () => {
  const graph = new SceneGraph()
  graph.createNode('RECTANGLE', graph.getPages()[0].id, { name: 'Existing' })
  const before = structuredClone([...graph.nodes])
  await expect(
    renderJSX(
      graph,
      `<><Frame><Text>Valid first root</Text></Frame>
    <Frame><Rect/>${invalidMetadata}</Frame></>`
    )
  ).rejects.toThrow('Invalid properties')
  expect([...graph.nodes]).toEqual(before)
})

test('failed replacement preserves the original subtree and sibling order', async () => {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const [original] = await renderJSX(
    graph,
    '<Frame name="Original"><Text>Saved content</Text></Frame>'
  )
  graph.createNode('RECTANGLE', figma.currentPageId, { name: 'Sibling' })
  const before = structuredClone([...graph.nodes])
  const tool = ALL_TOOLS.find((candidate) => candidate.name === 'render')
  if (!tool) throw new Error('Missing render tool')
  await expect(
    tool.execute(figma, {
      replace_id: original.id,
      jsx: `<Frame><Rect/>${invalidMetadata}</Frame>`
    })
  ).rejects.toThrow('Invalid properties')
  expect([...graph.nodes]).toEqual(before)
})

function delayedRenderer() {
  const started = Promise.withResolvers<undefined>()
  const artwork = Promise.withResolvers<string | null>()
  const renderer = createDesignJSXRenderer<string>({
    icon: () => {
      started.resolve(undefined)
      return artwork.promise
    },
    svg: () => null,
    createArtwork: (graph, _artwork, placement) => graph.createNode('VECTOR', placement.parentId),
    layout: (graph) => graph.clearAbsPosCache()
  })
  return { renderer, started, artwork }
}

test('async failure removes only render-owned nodes and preserves a concurrent sibling', async () => {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const { renderer, started, artwork } = delayedRenderer()
  const pending = renderer.renderJSX(
    graph,
    '<Frame name="Partial"><Rect/><Icon name="missing"/></Frame>'
  )
  await started.promise
  const sibling = graph.createNode('TEXT', pageId, { name: 'Concurrent edit', text: 'Keep me' })
  artwork.resolve(null)
  await expect(pending).rejects.toThrow('not found')
  expect(graph.getChildren(pageId).map((node) => node.id)).toEqual([sibling.id])
  expect(graph.getNode(sibling.id)?.text).toBe('Keep me')
})

test('rollback reports a conflict and preserves unrelated children attached during an await', async () => {
  const graph = new SceneGraph()
  const { renderer, started, artwork } = delayedRenderer()
  const pending = renderer.renderJSX(
    graph,
    '<Frame name="Partial"><Rect/><Icon name="missing"/></Frame>'
  )
  await started.promise
  const partial = [...graph.nodes.values()].find((node) => node.name === 'Partial')
  if (!partial) throw new Error('Missing partial root')
  const child = graph.createNode('TEXT', partial.id, { name: 'Concurrent edit', text: 'Keep me' })
  artwork.resolve(null)
  await expect(pending).rejects.toThrow('rollback conflict')
  expect(graph.getNode(child.id)?.text).toBe('Keep me')
  expect(graph.getChildren(partial.id).map((node) => node.id)).toEqual([child.id])
})

test('a throwing creation observer cannot hide a partial node from rollback', async () => {
  const graph = new SceneGraph()
  const before = structuredClone([...graph.nodes])
  graph.onNodeEvents({
    created: () => {
      throw new Error('Creation observer failed')
    }
  })
  await expect(renderJSX(graph, '<Frame><Rect/></Frame>')).rejects.toThrow(
    'Creation observer failed'
  )
  expect([...graph.nodes]).toEqual(before)
})

test('rollback continues cleaning owned nodes when deletion observers fail', async () => {
  const graph = new SceneGraph()
  const before = structuredClone([...graph.nodes])
  graph.onNodeEvents({
    deleted: () => {
      throw new Error('Deletion observer failed')
    }
  })
  await expect(renderJSX(graph, `<Frame><Rect/>${invalidMetadata}</Frame>`)).rejects.toThrow(
    'cleanup failed'
  )
  expect([...graph.nodes]).toEqual(before)
})

test('a layout failure restores existing HUG geometry as well as removing new nodes', async () => {
  const graph = new SceneGraph()
  const [parent] = await renderJSX(
    graph,
    '<Frame w="hug" h="hug" flex="row"><Rect w={40} h={20}/></Frame>'
  )
  const before = structuredClone([...graph.nodes])
  let fail = true
  graph.onNodeEvents({
    updated: (id, changes) => {
      if (fail && id === parent.id && changes.width !== undefined) {
        fail = false
        throw new Error('Layout observer failed')
      }
    }
  })
  await expect(renderJSX(graph, '<Rect w={100} h={50}/>', { parentId: parent.id })).rejects.toThrow(
    'Layout observer failed'
  )
  expect([...graph.nodes]).toEqual(before)
})

test('layout rollback restores implicit TEXT cache invalidation with the original geometry', async () => {
  const graph = new SceneGraph()
  const [parent] = await renderJSX(graph, '<Frame w={360} h={100} flex="row"/>')
  const text = graph.createNode('TEXT', parent.id, {
    text: 'Saved text',
    width: 360,
    height: 100,
    layoutGrow: 1,
    textAutoResize: 'NONE',
    derivedLayout: { width: 359, height: 99 },
    derivedTextGlyphs: [],
    textPicture: new Uint8Array([1, 2, 3])
  })
  const before = structuredClone([...graph.nodes])
  let fail = true
  graph.onNodeEvents({
    updated: (id) => {
      if (fail && id === text.id) {
        fail = false
        throw new Error('Text layout observer failed')
      }
    }
  })
  await expect(renderJSX(graph, '<Rect w={100} h={50}/>', { parentId: parent.id })).rejects.toThrow(
    'Text layout observer failed'
  )
  expect([...graph.nodes]).toEqual(before)
})

test('render layout is scoped to its parent page and leaves unrelated page geometry untouched', async () => {
  const graph = new SceneGraph()
  const other = graph.addPage('Unrelated page')
  const untouched = graph.createNode('FRAME', other.id, {
    width: 230,
    height: 100,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG'
  })
  graph.createNode('RECTANGLE', untouched.id, { width: 40, height: 20 })
  await renderJSX(graph, '<Frame flex="row" w="hug"><Rect w={80}/></Frame>', {
    parentId: graph.getPages()[0].id
  })
  expect(untouched.width).toBe(230)
})
