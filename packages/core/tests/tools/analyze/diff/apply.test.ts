import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'
import { findByName, PROPERTY_CASES } from '#core-tests/helpers/property-cases'
import { pick } from 'es-toolkit'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import { createDefaultNode, SceneGraph } from '@open-pencil/scene-graph'

function tool(name: string) {
  return expectDefined(
    ALL_TOOLS.find((candidate) => candidate.name === name),
    name
  )
}

describe('diff_apply property coverage', () => {
  test('changing a paint replaces its inherited binding and preserves unrelated bindings', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const frame = figma.createFrame()
    const collection = figma.createVariableCollection('Colors')
    const border = figma.createVariable('Border', 'COLOR', collection.id, {
      r: 1,
      g: 0,
      b: 0,
      a: 1
    })
    const focus = figma.createVariable('Focus', 'COLOR', collection.id, { r: 0, g: 1, b: 0, a: 1 })
    frame.strokes = [{ color: { r: 1, g: 0, b: 0, a: 1 }, weight: 1, opacity: 1, visible: true }]
    figma.bindVariable(frame.id, 'strokes/0/color', border.id)
    figma.bindVariable(frame.id, 'fills/0/color', border.id)
    const apply = (source: string) =>
      tool('diff_apply').execute(figma, {
        patch: `@@ /Frame #${frame.id}\n+stroke=${source}`,
        force: true
      })
    expect(await apply('{designVar("Focus")}')).toMatchObject({ applied: 1, failed: 0 })
    expect(graph.getNode(frame.id)?.boundVariables).toEqual({
      'strokes/0/color': focus.id,
      'fills/0/color': border.id
    })
    expect(await apply('"#00ff00"')).toMatchObject({ applied: 1, failed: 0 })
    expect(graph.getNode(frame.id)?.boundVariables).toEqual({ 'fills/0/color': border.id })
    expect(
      await tool('diff_apply').execute(figma, {
        patch: `@@ /Frame #${frame.id}\n+stroke={designVar("Focus")}\n+bind={{"strokes/0/color": "${border.id}"}}`,
        force: true
      })
    ).toMatchObject({ applied: 1, failed: 0 })
    expect(graph.getNode(frame.id)?.boundVariables).toEqual({ 'strokes/0/color': border.id })
  })

  test('JSON-transported JSX expressions preserve newlines and intentional backslashes', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const text = figma.createText()
    for (const value of ['First\nSecond', String.raw`First\nSecond`]) {
      const args = JSON.parse(
        JSON.stringify({
          patch: `@@ /Text #${text.id}\n+text={${JSON.stringify(value)}}`,
          force: true
        })
      )
      expect(await tool('diff_apply').execute(figma, args)).toMatchObject({ applied: 1, failed: 0 })
      expect(text.characters).toBe(value)
    }
  })

  test('instance property assignments fail explicitly rather than reporting unchanged', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const component = figma.createComponent()
    const instance = component.createInstance()
    expect(
      await tool('diff_apply').execute(figma, {
        patch: `@@ /Instance #${instance.id}\n+properties={{Title: "Updated"}}`
      })
    ).toMatchObject({ error: 'Patch does not apply', results: [{ status: 'failed' }] })
  })

  test.each(['strokeWidth={3}', 'borderWidth={3}', 'style={{borderWidth: 3}}'])(
    'literal %s drops its old scalar binding',
    async (source) => {
      const graph = new SceneGraph()
      const figma = new FigmaAPI(graph)
      const frame = figma.createFrame()
      frame.strokes = [{ color: { r: 1, g: 0, b: 0, a: 1 }, weight: 1, opacity: 1, visible: true }]
      const collection = figma.createVariableCollection('Sizes')
      const width = figma.createVariable('Width', 'FLOAT', collection.id, 1)
      figma.bindVariable(frame.id, 'strokeWeight', width.id)
      expect(
        await tool('diff_apply').execute(figma, {
          patch: `@@ /Frame #${frame.id}\n+${source}`,
          force: true
        })
      ).toMatchObject({ applied: 1, failed: 0 })
      expect(graph.getNode(frame.id)?.boundVariables.strokeWeight).toBeUndefined()
      expect(graph.getNode(frame.id)?.strokes[0].weight).toBe(3)
    }
  )

  test('an unchanged padding longhand keeps its binding when adding a shorthand', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const frame = figma.createFrame()
    frame.layoutMode = 'VERTICAL'
    frame.paddingTop = 8
    frame.paddingLeft = 2
    frame.paddingRight = 3
    frame.paddingBottom = 4
    const collection = figma.createVariableCollection('Sizes')
    const top = figma.createVariable('Top', 'FLOAT', collection.id, 8)
    figma.bindVariable(frame.id, 'paddingTop', top.id)
    expect(
      await tool('diff_apply').execute(figma, {
        patch: `@@ /Frame #${frame.id}\n+p={16}`
      })
    ).toMatchObject({ applied: 0, failed: 0 })
    expect(graph.getNode(frame.id)?.boundVariables.paddingTop).toBe(top.id)
    expect(frame.paddingTop).toBe(8)
  })

  test('losing style and paint shorthands preserve the effective explicit bindings', async () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const frame = figma.createFrame()
    const collection = figma.createVariableCollection('Colors')
    const token = figma.createVariable('Color', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 })
    figma.bindVariable(frame.id, 'fills/0/color', token.id)
    expect(
      await tool('diff_apply').execute(figma, {
        patch: `@@ /Frame #${frame.id}\n+style={{background: "#00ff00"}}`
      })
    ).toMatchObject({ applied: 0, failed: 0 })
    expect(graph.getNode(frame.id)?.boundVariables['fills/0/color']).toBe(token.id)
    frame.fills = [
      { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: true, opacity: 1 },
      { type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 }, visible: true, opacity: 1 }
    ]
    expect(
      await tool('diff_apply').execute(figma, {
        patch: `@@ /Frame #${frame.id}\n+bg="#00ff00"`
      })
    ).toMatchObject({ applied: 0, failed: 0 })
    expect(graph.getNode(frame.id)?.boundVariables['fills/0/color']).toBe(token.id)
  })
  test.each(PROPERTY_CASES.map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    async (_, testCase) => {
      const graph = new SceneGraph()
      const figma = new FigmaAPI(graph)
      const page = expectDefined(graph.getPages()[0], 'page')
      const goal = testCase.build(graph, page.id)
      const plain = testCase.build(graph, page.id)
      const target = findByName(graph, plain.rootId, plain.target)
      // The same tree with the target's properties at their defaults.
      const defaults = createDefaultNode(() => target.id, target.type)
      graph.updateNode(target.id, pick(defaults, testCase.fields))
      const expected = findByName(graph, goal.rootId, goal.target)
      expect(pick(target, testCase.fields)).not.toEqual(pick(expected, testCase.fields))

      const created = await tool('diff_create').execute(figma, {
        from: plain.rootId,
        to: goal.rootId
      })
      const patch = expectDefined((created as { diff?: string | null }).diff, 'patch')
      const applied = await tool('diff_apply').execute(figma, { patch })
      expect(applied).toMatchObject({ failed: 0 })

      expect(pick(findByName(graph, plain.rootId, plain.target), testCase.fields)).toEqual(
        pick(expected, testCase.fields)
      )
      expect(
        await tool('diff_create').execute(figma, { from: plain.rootId, to: goal.rootId })
      ).toMatchObject({ diff: null })
    }
  )
})
