import { describe, expect, test } from 'bun:test'

import { createEditor, executeAtomicTool } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import { SceneGraph } from '@open-pencil/scene-graph'
import { UndoManager } from '@open-pencil/scene-graph/undo'

import { computeLayout } from '#core/layout'
import { setFill } from '#core/tools/modify/paint'

function setup() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const undo = new UndoManager()
  const editor = {
    graph,
    runLayoutForNode: (_id: string) => undefined,
    requestRender: () => undefined,
    pushUndoEntry: undo.push.bind(undo)
  }
  const definition = ALL_TOOLS.find((tool) => tool.name === 'update_node')
  if (!definition) throw new Error('Missing update_node')
  return { graph, figma, undo, editor, definition }
}

describe('scoped atomic node properties', () => {
  test('bindings on a large graph restore nearest and outer instance overrides with scoped Undo', () => {
    const { graph, figma, undo, editor } = setup()
    const inner = figma.createComponent()
    inner.appendChild(figma.createRectangle())
    const outer = figma.createComponent()
    outer.appendChild(inner.createInstance())
    const occurrence = outer.createInstance()
    const nested = occurrence.children[0]
    const target = nested.children[0]
    const targetNode = graph.getNode(target.id)!
    const collection = figma.createVariableCollection('Colors')
    const variable = figma.createVariable('Focus', 'COLOR', collection.id, {
      r: 0,
      g: 1,
      b: 0,
      a: 1
    })
    const size = figma.createVariable('Radius', 'FLOAT', collection.id, 8)
    graph.getNode(occurrence.id)!.variableAssignmentScales.cornerRadius = 2
    const foreign = figma.createPage()
    while (graph.nodes.size < 20_001) graph.createNode('RECTANGLE', foreign.id)
    const unrelated = graph.getChildren(foreign.id)[0]
    unrelated.source.fig.rawNodeFields.notCloneable = () => undefined
    const bind = ALL_TOOLS.find((tool) => tool.name === 'bind_variable')!
    const unbind = ALL_TOOLS.find((tool) => tool.name === 'unbind_variable')!
    const state = () =>
      structuredClone([
        targetNode.boundVariables,
        targetNode.variableBindingScales,
        graph.getNode(nested.id)?.instanceOverrides,
        graph.getNode(occurrence.id)?.instanceOverrides
      ])
    const original = state()
    const args = { node_id: target.id, field: 'fills/0/color', variable_id: variable.id }
    executeAtomicTool(editor, figma, bind, args)
    const bound = state()
    expect(targetNode.boundVariables['fills/0/color']).toBe(variable.id)
    expect(
      graph.resolveColorVariableForNode(target.id, targetNode.boundVariables['fills/0/color'])
    ).toEqual({ r: 0, g: 1, b: 0, a: 1 })
    expect(bound).not.toEqual(original)
    unrelated.name = 'Later edit'
    undo.undo()
    expect(state()).toEqual(original)
    undo.redo()
    expect(state()).toEqual(bound)
    executeAtomicTool(editor, figma, unbind, { node_id: target.id, field: 'fills/0/color' })
    expect(targetNode.boundVariables).toEqual({})
    undo.undo()
    expect(state()).toEqual(bound)
    executeAtomicTool(editor, figma, bind, {
      node_id: target.id,
      field: 'cornerRadius',
      variable_id: size.id
    })
    expect(targetNode.variableBindingScales.cornerRadius).toBe(2)
    undo.undo()
    expect(state()).toEqual(bound)
    for (const invalid of [
      { ...args, variable_id: 'missing' },
      { ...args, variable_id: size.id },
      { ...args, field: 'fills/99/color' }
    ]) {
      expect(() => executeAtomicTool(editor, figma, bind, invalid)).toThrow()
      expect(state()).toEqual(bound)
    }
    editor.runLayoutForNode = () => {
      throw new Error('Layout failed')
    }
    expect(() =>
      executeAtomicTool(editor, figma, unbind, { node_id: target.id, field: 'fills/0/color' })
    ).toThrow('Layout failed')
    expect(state()).toEqual(bound)
    expect(unrelated.name).toBe('Later edit')
    expect(() => executeAtomicTool(editor, figma, { ...bind }, args)).toThrow('maximum 20000')
  })
  test('solid and gradient fills on a large document retain scoped Undo without cloning foreign pages', () => {
    const { graph, figma, undo, editor } = setup()
    const target = figma.createFrame()
    const original = structuredClone(target.fills)
    const foreign = figma.createPage()
    while (graph.nodes.size < 20_001) graph.createNode('RECTANGLE', foreign.id)
    const untouched = graph.getChildren(foreign.id)[0]
    untouched.source.fig.rawNodeFields.notCloneable = () => undefined
    executeAtomicTool(editor, figma, setFill, { id: target.id, color: '#123456' })
    const solid = structuredClone(target.fills)
    expect(solid[0].type).toBe('SOLID')
    expect(solid[0].color).toEqual({ r: 18 / 255, g: 52 / 255, b: 86 / 255, a: 1 })
    executeAtomicTool(editor, figma, setFill, {
      id: target.id,
      color: '#123456',
      color_end: '#abcdef',
      gradient: 'left-right'
    })
    const gradient = structuredClone(target.fills)
    expect(gradient[0].type).toBe('GRADIENT_LINEAR')
    expect(gradient[0].gradientStops).toHaveLength(2)
    untouched.name = 'Later foreign edit'
    undo.undo()
    expect(target.fills).toEqual(solid)
    undo.undo()
    expect(target.fills).toEqual(original)
    undo.redo()
    expect(target.fills).toEqual(solid)
    undo.redo()
    expect(target.fills).toEqual(gradient)
    expect(untouched.name).toBe('Later foreign edit')
    expect(() =>
      executeAtomicTool(
        editor,
        figma,
        { ...setFill },
        {
          id: target.id,
          color: '#ffffff'
        }
      )
    ).toThrow('maximum 20000')
  })

  test('a failed fill restores nested instance overrides and layout writes without adding history', () => {
    const { graph, figma, undo, editor } = setup()
    const component = figma.createComponent()
    component.appendChild(figma.createRectangle())
    const instance = component.createInstance()
    const target = instance.children[0]
    const sibling = figma.createRectangle()
    const original = structuredClone([
      graph.getNode(instance.id),
      graph.getNode(target.id),
      graph.getNode(sibling.id)
    ])
    editor.runLayoutForNode = () => {
      graph.updateNode(sibling.id, { x: 55 })
      throw new Error('Layout failed')
    }
    expect(() =>
      executeAtomicTool(editor, figma, setFill, {
        id: target.id,
        color: '#123456'
      })
    ).toThrow('Layout failed')
    expect([
      graph.getNode(instance.id),
      graph.getNode(target.id),
      graph.getNode(sibling.id)
    ]).toEqual(original)
    expect(undo.canUndo).toBe(false)
  })

  test('a bounded edit works above the document ceiling without copying foreign FIG payloads', () => {
    const { graph, figma, undo, editor, definition } = setup()
    const target = figma.createFrame()
    const foreign = figma.createPage()
    while (graph.nodes.size < 20_001) graph.createNode('RECTANGLE', foreign.id)
    const untouched = graph.getChildren(foreign.id)[0]
    untouched.source.fig.rawNodeFields.notCloneable = () => undefined
    executeAtomicTool(editor, figma, definition, {
      id: target.id,
      x: 140,
      width: 360,
      name: 'Ready'
    })
    expect([target.x, target.width, target.name]).toEqual([140, 360, 'Ready'])
    untouched.name = 'Later foreign edit'
    undo.undo()
    expect([target.x, target.width, target.name]).toEqual([0, 100, 'Frame'])
    expect(untouched.name).toBe('Later foreign edit')
    undo.redo()
    expect([target.x, target.width, target.name]).toEqual([140, 360, 'Ready'])
    expect(() =>
      executeAtomicTool(editor, figma, { ...definition }, { id: target.id, x: 0 })
    ).toThrow('maximum 20000')
  })

  test('a failed layout restores earlier setters, layout writes, source markers and instance overrides', () => {
    const { graph, figma, undo, editor, definition } = setup()
    const component = figma.createComponent()
    const instance = component.createInstance()
    const raw = graph.getNode(instance.id)
    if (!raw) throw new Error('Missing instance')
    const original = structuredClone(raw)
    const sibling = figma.createRectangle()
    const siblingRaw = graph.getNode(sibling.id)
    if (!siblingRaw) throw new Error('Missing sibling')
    const originalSibling = structuredClone(siblingRaw)
    editor.runLayoutForNode = () => {
      graph.updateNode(sibling.id, { x: 55 })
      throw new Error('Layout failed')
    }
    expect(() =>
      executeAtomicTool(editor, figma, definition, {
        id: instance.id,
        width: 360,
        opacity: 0.4
      })
    ).toThrow('Layout failed')
    expect(raw).toEqual(original)
    expect(siblingRaw).toEqual(originalSibling)
    expect(undo.canUndo).toBe(false)
  })

  test('replay restores instance overrides and preserves a later unrelated source edit', () => {
    const { graph, figma, undo, editor, definition } = setup()
    const component = figma.createComponent()
    const child = figma.createRectangle()
    component.appendChild(child)
    const instance = component.createInstance()
    const nested = instance.children[0]
    const owner = graph.getNode(instance.id)
    const raw = graph.getNode(nested.id)
    if (!owner || !raw) throw new Error('Missing nested owner')
    const before = structuredClone(owner.instanceOverrides)
    executeAtomicTool(editor, figma, definition, { id: nested.id, opacity: 0.4 })
    expect(owner.instanceOverrides).not.toEqual(before)
    graph.updateNode(nested.id, { name: 'Later author edit' })
    const after = structuredClone(owner.instanceOverrides)
    undo.undo()
    expect(nested.opacity).toBe(1)
    expect(nested.name).toBe('Later author edit')
    expect(owner.instanceOverrides).toEqual(before)
    expect(raw.source.editedFields).toContain('name')
    undo.redo()
    expect(nested.opacity).toBe(0.4)
    expect(owner.instanceOverrides).toEqual(after)
    expect(raw.source.editedFields).toContain('name')
    expect(raw.source.editedFields).toContain('opacity')
  })

  test('a no-op does not retain source edit markers or create history', () => {
    const { graph, figma, undo, editor, definition } = setup()
    const node = figma.createFrame()
    const raw = graph.getNode(node.id)
    if (!raw) throw new Error('Missing frame')
    const original = structuredClone(raw)
    executeAtomicTool(editor, figma, definition, { id: node.id, width: 100 })
    expect(raw).toEqual(original)
    expect(undo.canUndo).toBe(false)
  })

  test('actual layout invalidation shares one owned glyph backing across Undo and Redo', () => {
    const { graph, figma, undo, editor, definition } = setup()
    const frame = graph.createNode('FRAME', figma.currentPageId, {
      width: 100,
      height: 80,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const backing = new ArrayBuffer(2 * 1024 * 1024)
    const children = [0, 16].map((offset) =>
      graph.createNode('TEXT', frame.id, {
        text: 'Owned glyph',
        width: 100,
        height: 20,
        layoutAlignSelf: 'STRETCH',
        derivedTextGlyphs: [
          { commandsBlob: new Uint8Array(backing, offset, 8), x: 0, y: 0, fontSize: 12 }
        ]
      })
    )
    editor.runLayoutForNode = (id) => {
      computeLayout(graph, id)
    }
    executeAtomicTool(editor, figma, definition, { id: frame.id, width: 360 })
    expect(children.every((child) => child.width === 360 && child.derivedTextGlyphs === null)).toBe(
      true
    )
    undo.undo()
    const buffers = children.map((child) => child.derivedTextGlyphs?.[0].commandsBlob.buffer)
    expect(buffers[0]).toBeDefined()
    expect(buffers[0]).toBe(buffers[1])
    expect(buffers[0]).not.toBe(backing)
    const firstGlyph = children[0].derivedTextGlyphs?.[0]
    if (!firstGlyph) throw new Error('Missing restored glyph')
    firstGlyph.commandsBlob.fill(55)
    expect(new Uint8Array(backing)[0]).toBe(0)
    undo.redo()
    expect(children.every((child) => child.derivedTextGlyphs === null)).toBe(true)
    undo.undo()
    expect(children[0].derivedTextGlyphs?.[0].commandsBlob[0]).toBe(0)
    expect(children[0].derivedTextGlyphs?.[0].commandsBlob.buffer).toBe(
      children[1].derivedTextGlyphs?.[0].commandsBlob.buffer
    )
  })

  test('group fitting captures related geometry without touching unrelated foreign layers', () => {
    const { graph, figma, undo, editor, definition } = setup()
    const group = graph.createNode('GROUP', figma.currentPageId, {
      x: 10,
      y: 10,
      width: 100,
      height: 50
    })
    const child = graph.createNode('RECTANGLE', group.id, { width: 100, height: 50 })
    const original = structuredClone([group, child])
    executeAtomicTool(editor, figma, definition, { id: child.id, width: 360, x: 140 })
    expect(group.width).toBe(360)
    expect(figma.getNodeById(child.id)?.x).toBe(140)
    undo.undo()
    expect([group, child]).toEqual(original)
    undo.redo()
    expect(group.width).toBe(360)
    expect(figma.getNodeById(child.id)?.x).toBe(140)
  })

  test('the affected-node ceiling stops a large layout and restores its earlier changes', () => {
    const { graph, figma, undo, editor, definition } = setup()
    const target = figma.createFrame()
    const children = Array.from({ length: 20_001 }, () =>
      graph.createNode('RECTANGLE', figma.currentPageId)
    )
    editor.runLayoutForNode = () => {
      for (const child of children) graph.updateNode(child.id, { x: 50 })
    }
    expect(() =>
      executeAtomicTool(editor, figma, definition, { id: target.id, width: 360 })
    ).toThrow('Property edit affects too many nodes')
    expect(target.width).toBe(100)
    expect(children.every((child) => child.x === 0 && child.source.editedFields.length === 0)).toBe(
      true
    )
    expect(undo.canUndo).toBe(false)
  })

  test('variant rename captures the sibling values and set definition for Undo and Redo', () => {
    const { graph, figma, undo, editor, definition } = setup()
    const page = figma.currentPageId
    const set = graph.createNode('COMPONENT_SET', page, {
      componentPropertyDefinitions: [
        {
          id: 'phase',
          name: 'Phase',
          type: 'VARIANT',
          defaultValue: 'Pending',
          variantOptions: ['Pending', 'Unknown']
        }
      ]
    })
    const pending = graph.createNode('COMPONENT', set.id, {
      name: 'Phase=Pending',
      componentPropertyValues: { Phase: 'Pending' }
    })
    graph.createNode('COMPONENT', set.id, {
      name: 'Phase=Unknown',
      componentPropertyValues: { Phase: 'Unknown' }
    })
    executeAtomicTool(editor, figma, definition, { id: pending.id, name: 'Phase=Current' })
    expect(set.componentPropertyDefinitions[0].variantOptions).toEqual(['Unknown', 'Current'])
    expect(pending.componentPropertyValues.Phase).toBe('Current')
    undo.undo()
    expect(set.componentPropertyDefinitions[0].variantOptions).toEqual(['Pending', 'Unknown'])
    expect(pending.componentPropertyValues.Phase).toBe('Pending')
    undo.redo()
    expect(set.componentPropertyDefinitions[0].variantOptions).toEqual(['Unknown', 'Current'])
  })

  test('failed event delivery retains a committed edit with usable Undo', () => {
    const { graph, figma, undo, editor, definition } = setup()
    const target = figma.createRectangle()
    const stop = graph.onNodeEvents({
      updated: () => {
        throw new Error('Consumer failed')
      }
    })
    expect(() =>
      executeAtomicTool(editor, figma, definition, { id: target.id, width: 320 })
    ).toThrow('Committed graph event delivery failed')
    expect(target.width).toBe(320)
    expect(undo.canUndo).toBe(true)
    stop()
    undo.undo()
    expect(target.width).toBe(100)
  })

  test('real editor component synchronization follows the committed edit and its replay across pages', async () => {
    const editor = createEditor()
    const figma = new FigmaAPI(editor.graph)
    const component = figma.createComponent()
    const page = figma.createPage()
    const instance = component.createInstance()
    page.appendChild(instance)
    await Promise.resolve()
    const definition = ALL_TOOLS.find((tool) => tool.name === 'update_node')
    if (!definition) throw new Error('Missing update_node')
    executeAtomicTool(editor, figma, definition, { id: component.id, opacity: 0.4 })
    await Promise.resolve()
    expect(instance.opacity).toBe(0.4)
    editor.undo.undo()
    await Promise.resolve()
    expect(instance.opacity).toBe(1)
    editor.undo.redo()
    await Promise.resolve()
    expect(instance.opacity).toBe(0.4)
    editor.dispose()
  })
})
