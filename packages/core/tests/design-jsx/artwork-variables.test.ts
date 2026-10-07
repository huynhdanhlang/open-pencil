import { describe, expect, test } from 'bun:test'

import { renderJSX, renderTree } from '@open-pencil/core/design-jsx'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io'
import {
  createDesignJSXRenderer,
  decodeTreeFromTransport,
  designVar,
  encodeTreeForTransport
} from '@open-pencil/design-jsx'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createIconFromPaths } from '#core/icons/render'
import { buildIconData } from '#core/icons/svg'

const body =
  '<path d="M0 0h10v10H0z" fill="currentColor" stroke="currentColor"/><path d="M12 0h10v10H12z" fill="#cc6600"/>'
const orange = { r: 0.8, g: 0.4, b: 0, a: 1 }

function setup() {
  const graph = new SceneGraph()
  graph.addCollection({
    id: 'palette',
    name: 'Palette',
    modes: [
      { modeId: 'default', name: 'Default' },
      { modeId: 'green', name: 'Green' }
    ],
    defaultModeId: 'default',
    variableIds: []
  })
  graph.addVariable({
    id: 'accent',
    name: 'Accent',
    type: 'COLOR',
    collectionId: 'palette',
    valuesByMode: { default: orange, green: { r: 0, g: 0.8, b: 0.2, a: 1 } },
    description: '',
    hiddenFromPublishing: false
  })
  return graph
}

function vectors(graph: SceneGraph, rootId: string) {
  const children = graph.getChildren(rootId)
  expect(children).toHaveLength(2)
  return children
}

describe('artwork color variables', () => {
  test('SVG currentColor keeps bindings, explicit equal-color paths stay literal, and Save/import retains them', async () => {
    let graph = setup()
    const [root] = await renderJSX(
      graph,
      `<svg name="Owned SVG" viewBox="0 0 24 24" color={designVar("Accent")} body={${JSON.stringify(body)}} />`
    )
    let [bound, literal] = vectors(graph, root.id)
    expect(bound.fills[0].color).toEqual(orange)
    expect(bound.strokes[0].color).toEqual(orange)
    expect(bound.boundVariables).toEqual({ 'fills/0/color': 'accent', 'strokes/0/color': 'accent' })
    expect(literal.fills[0].color).toEqual(orange)
    expect(literal.boundVariables).toEqual({})
    graph.setActiveMode('palette', 'green')
    expect(graph.resolveColorVariableForNode(bound.id, 'accent')).toEqual({
      r: 0,
      g: 0.8,
      b: 0.2,
      a: 1
    })
    expect(literal.fills[0].color).toEqual(orange)
    const bytes = await exportFigFile(graph)
    graph = await parseFigFile(bytes.slice().buffer, { populate: 'all' })
    const restored = [...graph.nodes.values()].find((node) => node.name === 'Icon / Owned SVG')
    if (!restored) throw new Error('Saved SVG missing')
    ;[bound, literal] = vectors(graph, restored.id)
    const variable = [...graph.variables.values()].find((value) => value.name === 'Accent')
    if (!variable) throw new Error('Saved color token missing')
    expect(bound.boundVariables).toEqual({
      'fills/0/color': variable.id,
      'strokes/0/color': variable.id
    })
    expect(literal.boundVariables).toEqual({})
  })

  test('Icon JSON transport uses the same path binding owner and accepts a Color fallback', async () => {
    const graph = setup()
    const artwork = buildIconData({ body }, 'owned', 'palette', 24, 24, 24)
    const renderer = createDesignJSXRenderer({
      icon: async () => artwork,
      svg: () => artwork,
      createArtwork: (graph, icon, { parentId, size, color, overrides, colorVariableId }) =>
        createIconFromPaths(
          graph,
          icon,
          icon.name,
          size,
          color,
          parentId,
          overrides,
          colorVariableId
        ),
      layout: () => undefined
    })
    const encoded = encodeTreeForTransport({
      type: 'icon',
      props: { name: 'owned:palette', color: designVar('accent', orange) },
      children: []
    })
    const wire = JSON.stringify(encoded)
    const transported: unknown = JSON.parse(wire)
    const result = await renderer.renderTree(graph, decodeTreeFromTransport(transported))
    const [bound, literal] = vectors(graph, result.id)
    expect(bound.fills[0].color).toEqual(orange)
    expect(bound.boundVariables).toEqual({ 'fills/0/color': 'accent', 'strokes/0/color': 'accent' })
    expect(literal.boundVariables).toEqual({})
    const direct = await renderTree(graph, {
      type: 'svg',
      props: { body, viewBox: '0 0 24 24', color: orange },
      children: []
    })
    expect(vectors(graph, direct.id)[0].fills[0].color).toEqual(orange)
  })

  test('a missing or wrong-type token rejects and restores the partial render', async () => {
    const graph = setup()
    const before = structuredClone([...graph.nodes])
    await expect(
      renderJSX(
        graph,
        `<><Frame name="Valid"/><svg body={${JSON.stringify(body)}} color={designVar("Missing")}/></>`
      )
    ).rejects.toThrow('color variable')
    expect([...graph.nodes]).toEqual(before)
    graph.addVariable({
      id: 'spacing',
      name: 'Spacing',
      type: 'FLOAT',
      collectionId: 'palette',
      valuesByMode: { default: 8 },
      description: '',
      hiddenFromPublishing: false
    })
    await expect(
      renderJSX(graph, `<svg body={${JSON.stringify(body)}} color={designVar("Spacing")}/>`)
    ).rejects.toThrow('color variable')
    expect([...graph.nodes]).toEqual(before)
    graph.addVariable({
      id: 'empty',
      name: 'Empty',
      type: 'COLOR',
      collectionId: 'palette',
      valuesByMode: {},
      description: '',
      hiddenFromPublishing: false
    })
    await expect(
      renderJSX(graph, `<svg body={${JSON.stringify(body)}} color={designVar("Empty")}/>`)
    ).rejects.toThrow('color variable')
    expect([...graph.nodes]).toEqual(before)
  })
})
