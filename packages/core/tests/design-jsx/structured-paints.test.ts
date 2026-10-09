import { expect, test } from 'bun:test'

import { renderJSX, renderTree } from '@open-pencil/core/design-jsx'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io'
import { decodeTreeFromTransport, designVar, encodeTreeForTransport } from '@open-pencil/design-jsx'
import { SceneGraph, resolvedPaintBindings } from '@open-pencil/scene-graph'

const canvas = { r: 0.1, g: 0.2, b: 0.3, a: 1 }
function setup() {
  const graph = new SceneGraph()
  graph.addCollection({
    id: 'palette',
    name: 'Palette',
    modes: [
      { modeId: 'default', name: 'Default' },
      { modeId: 'dim', name: 'Dim' }
    ],
    defaultModeId: 'default',
    variableIds: []
  })
  graph.addVariable({
    id: 'canvas',
    name: 'Canvas',
    type: 'COLOR',
    collectionId: 'palette',
    valuesByMode: { default: canvas, dim: { ...canvas, a: 0.5 } },
    description: '',
    hiddenFromPublishing: false
  })
  return graph
}

test('nested paint token survives transport, node alpha, mode resolution and Save/import', async () => {
  let graph = setup()
  const tree = decodeTreeFromTransport(
    JSON.parse(
      JSON.stringify(
        encodeTreeForTransport({
          type: 'rectangle',
          props: {
            name: 'Owned translucent background',
            opacity: 0.78,
            fills: [{ type: 'SOLID', color: designVar('canvas') }],
            strokes: [{ color: designVar('canvas'), weight: 1 }]
          },
          children: []
        })
      )
    )
  )
  const result = await renderTree(graph, tree)
  let node = graph.getNode(result.id)!
  expect(node.fills[0].color).toEqual(canvas)
  expect(node.fills[0].opacity).toBe(1)
  expect(node.boundVariables).toEqual({ 'fills/0/color': 'canvas', 'strokes/0/color': 'canvas' })
  expect(node.opacity).toBe(0.78)
  graph.setActiveMode('palette', 'dim')
  expect(resolvedPaintBindings(graph, node).fills?.[0].opacity).toBe(0.5)
  expect(node.opacity).toBe(0.78)
  const bytes = await exportFigFile(graph)
  graph = await parseFigFile(bytes.slice().buffer, { populate: 'all' })
  node = [...graph.nodes.values()].find((n) => n.name === 'Owned translucent background')!
  const token = [...graph.variables.values()].find((v) => v.name === 'Canvas')!
  expect(node.opacity).toBeCloseTo(0.78, 6)
  expect(node.fills[0].opacity).toBe(1)
  expect(node.boundVariables).toEqual({ 'fills/0/color': token.id, 'strokes/0/color': token.id })
})

test.each([
  [
    'nested token opacity',
    `<Rectangle fills={[{type:'SOLID',color:designVar('Canvas'),opacity:0.78,visible:true}]}/>`,
    'paint opacity'
  ],
  [
    'missing token',
    `<Rectangle fills={[{type:'SOLID',color:designVar('Missing'),visible:true}]}/>`,
    'COLOR'
  ],
  [
    'malformed color',
    `<Rectangle fills={[{type:'SOLID',color:{id:'Canvas'},opacity:0.78,visible:true}]}/>`,
    'fills/0/color'
  ],
  [
    'invalid CSS color',
    `<Rectangle fills={[{type:'SOLID',color:'not-a-color',visible:true}]}/>`,
    'fills/0/color'
  ],
  ['invalid stroke color', `<Rectangle strokes={[{color:{r:0,a:1},weight:1}]}/>`, 'strokes/0/color']
])('invalid %s rejects atomically before Save', async (_label, jsx, error) => {
  const graph = setup()
  const before = structuredClone([...graph.nodes])
  await expect(renderJSX(graph, `<><Frame name="Earlier valid root"/>${jsx}</>`)).rejects.toThrow(
    error
  )
  expect([...graph.nodes]).toEqual(before)
})

test('ambiguous token names reject, while the exact existing ID wins', async () => {
  const graph = setup()
  graph.addVariable({ ...graph.variables.get('canvas')!, id: 'other-canvas' })
  const before = structuredClone([...graph.nodes])
  await expect(
    renderJSX(graph, `<Rectangle fills={[{type:'SOLID',color:designVar('Canvas'),visible:true}]}/>`)
  ).rejects.toThrow('Ambiguous')
  expect([...graph.nodes]).toEqual(before)
  const result = await renderJSX(
    graph,
    `<Rectangle fills={[{type:'SOLID',color:designVar('canvas'),visible:true}]}/>`
  )
  expect(graph.getNode(result[0].id)?.boundVariables['fills/0/color']).toBe('canvas')
})

test('paint bindings follow the effective source, with explicit bind last', async () => {
  const graph = setup()
  graph.addVariable({
    ...graph.variables.get('canvas')!,
    id: 'accent',
    name: 'Accent',
    valuesByMode: { default: { r: 1, g: 0, b: 0, a: 1 } }
  })
  const [rectangle] = await renderJSX(
    graph,
    `<Rectangle fills={[{type:'SOLID',color:designVar('canvas')}]} bg={designVar('accent')}/>`
  )
  expect(graph.getNode(rectangle.id)?.boundVariables).toEqual({ 'fills/0/color': 'canvas' })
  const [literal] = await renderJSX(
    graph,
    `<Text fills={[{type:'SOLID',color:designVar('canvas')},{type:'SOLID',color:designVar('accent')}]} color="#ff0000">Text</Text>`
  )
  expect(graph.getNode(literal.id)?.boundVariables).toEqual({})
  expect(graph.getNode(literal.id)?.fills).toHaveLength(1)
  expect(graph.getNode(literal.id)?.fills[0].color.r).toBe(1)
  const [bound] = await renderJSX(
    graph,
    `<Text fills={[{type:'SOLID',color:designVar('canvas')}]} color={designVar('accent')}>Text</Text>`
  )
  expect(graph.getNode(bound.id)?.boundVariables).toEqual({ 'fills/0/color': 'accent' })
  const [explicit] = await renderJSX(
    graph,
    `<Rectangle fills={[{type:'SOLID',color:designVar('canvas')}]} bind={{'fills/0/color':designVar('accent')}}/>`
  )
  expect(graph.getNode(explicit.id)?.boundVariables).toEqual({ 'fills/0/color': 'accent' })
  const [styleLiteral] = await renderJSX(
    graph,
    `<Rectangle bg="#ff0000" style={{backgroundColor:designVar('canvas')}}/>`
  )
  expect(graph.getNode(styleLiteral.id)?.boundVariables).toEqual({})
  const [styleText] = await renderJSX(
    graph,
    `<Text fills={[{type:'SOLID',color:designVar('canvas')}]} style={{color:designVar('accent')}}>Text</Text>`
  )
  expect(graph.getNode(styleText.id)?.boundVariables).toEqual({ 'fills/0/color': 'accent' })
  const [stroke] = await renderJSX(
    graph,
    `<Rectangle strokes={[{color:designVar('canvas')}]} stroke={designVar('accent')}/>`
  )
  expect(graph.getNode(stroke.id)?.boundVariables).toEqual({ 'strokes/0/color': 'canvas' })
})
