import { describe, expect, test } from 'bun:test'

import { effectiveFigmaRawNodeFields, effectiveFigmaSourcePayload } from '#fig/source-metadata'

import { SceneGraph } from '@open-pencil/scene-graph'

describe('@open-pencil/fig source metadata policy', () => {
  test('text box edits invalidate baked layout without deleting text or provenance', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', graph.getPages()[0].id, { width: 399, height: 54 })
    const textData = { characters: 'Editable text' }
    const derivedTextData = { layoutSize: { x: 399, y: 54 } }
    node.source.fig.rawNodeFields = { textData, derivedTextData, textUserLayoutVersion: 4 }
    graph.updateNode(node.id, { width: 200 })
    expect(effectiveFigmaRawNodeFields(node)).toEqual({ textData })
    expect(node.source.fig.rawNodeFields.derivedTextData).toBe(derivedTextData)
  })

  test('filters only raw fields made stale by normalized edits', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id)
    node.source.fig.rawNodeFields = {
      fillPaints: [{ type: 'SOLID' }],
      effects: [{ type: 'NOISE' }],
      prototypeInteractions: [{ trigger: 'ON_CLICK' }]
    }

    graph.updateNode(node.id, { fills: [] })

    expect(effectiveFigmaRawNodeFields(node)).toEqual({
      effects: [{ type: 'NOISE' }],
      prototypeInteractions: [{ trigger: 'ON_CLICK' }]
    })
    expect(node.source.fig.rawNodeFields.fillPaints).toBeDefined()
  })

  test('invalidates explicit blend and text alignment metadata after edits', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('VECTOR', graph.getPages()[0].id)
    node.source.fig.rawNodeFields = {
      blendMode: 'NORMAL',
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'CENTER',
      derivedTextData: { layoutSize: { x: 24, y: 24 } }
    }

    graph.updateNode(node.id, {
      blendMode: 'MULTIPLY',
      textAlignHorizontal: 'LEFT',
      textAlignVertical: 'TOP'
    })

    expect(effectiveFigmaRawNodeFields(node)).toEqual({})
  })

  test('invalidates effective raw geometry without deleting provenance', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('RECTANGLE', graph.getPages()[0].id)
    node.source.fig.rawSize = { x: 100, y: 100 }
    node.source.fig.rawTransform = { m00: 1, m01: 0, m02: 4, m10: 0, m11: 1, m12: 8 }

    graph.updateNode(node.id, { width: 200, x: 20 })

    expect(effectiveFigmaSourcePayload(node)).toMatchObject({
      rawSize: null,
      rawTransform: null
    })
    expect(node.source.fig.rawSize).toEqual({ x: 100, y: 100 })
    expect(node.source.fig.rawTransform).toBeDefined()
  })
})
