import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { expectDefined, getNodeOrThrow } from '../helpers/assert'

describe('SceneGraph.cloneTree', () => {
  test('invalid or uncloneable late descendants fail before publishing a partial copy', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const root = graph.createNode('FRAME', page.id)
    graph.createNode('RECTANGLE', root.id)
    const child = graph.createNode('RECTANGLE', root.id)
    const before = [...graph.nodes.keys()]
    child.source.fig.rawNodeFields = { unsupported: () => undefined }
    expect(() => graph.cloneTree(root.id, page.id)).toThrow()
    expect([...graph.nodes.keys()]).toEqual(before)
    child.source.fig.rawNodeFields = {}
    child.childIds.push(root.id)
    expect(() => graph.cloneTree(root.id, page.id)).toThrow('Cannot clone a cyclic subtree')
    expect([...graph.nodes.keys()]).toEqual(before)
  })

  test('a copied subtree owns one shared FIG backing store and isolates the live import', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const root = graph.createNode('FRAME', page.id, { name: 'Original tree' })
    const backing = new ArrayBuffer(2 * 1024 * 1024)
    for (let index = 0; index < 8; index++) {
      const node = graph.createNode('RECTANGLE', root.id)
      const bytes = new Uint8Array(backing, index * 32, 16)
      bytes.fill(index + 1)
      node.source = {
        ...node.source,
        format: 'fig',
        id: `1:${index}`,
        orderKey: `key${index}`,
        fig: {
          ...node.source.fig,
          rawNodeFields: { bytes, view: new DataView(backing, index * 32 + 4, 8) }
        }
      }
    }
    const clone = expectDefined(
      graph.cloneTree(root.id, page.id, { name: 'Copied tree', x: 40 }),
      'clone'
    )
    const children = graph.getChildren(clone.id)
    expect(children).toHaveLength(8)
    expect(clone.name).toBe('Copied tree')
    expect(clone.x).toBe(40)
    const buffers = new Set<ArrayBufferLike>()
    for (const [index, node] of children.entries()) {
      const bytes = node.source.fig.rawNodeFields.bytes as Uint8Array
      const view = node.source.fig.rawNodeFields.view as DataView
      buffers.add(bytes.buffer)
      expect(bytes.buffer).not.toBe(backing)
      expect(bytes.byteOffset).toBe(index * 32)
      expect(bytes.byteLength).toBe(16)
      expect([...bytes]).toEqual(Array.from({ length: 16 }, () => index + 1))
      expect(view.buffer).toBe(bytes.buffer)
      expect(view.byteOffset).toBe(index * 32 + 4)
      expect(view.byteLength).toBe(8)
      expect(node.parentId).toBe(clone.id)
      expect(node.source.id).toBeNull()
      expect(node.source.orderKey).toBeNull()
      expect(node.source.format).toBe('fig')
    }
    expect(buffers.size).toBe(1)
    ;(children[0].source.fig.rawNodeFields.bytes as Uint8Array).fill(99)
    expect(new Uint8Array(backing)[0]).toBe(1)
    const second = expectDefined(graph.cloneTree(root.id, page.id), 'second clone')
    const secondBytes = graph.getChildren(second.id)[0].source.fig.rawNodeFields.bytes as Uint8Array
    expect(buffers.has(secondBytes.buffer)).toBe(false)
    expect(secondBytes[0]).toBe(1)
  })

  test('clone clears source.id from the clone', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50
    })
    // Simulate an imported node with a Figma source.id
    graph.updateNode(rect.id, {
      source: { ...rect.source, id: '1:42', orderKey: '!', format: 'fig' }
    })
    const original = getNodeOrThrow(graph, rect.id)
    expect(original).toBeDefined()
    expect(original.source.id).toBe('1:42')

    const clone = expectDefined(graph.cloneTree(rect.id, page.id), 'clone')
    expect(clone).not.toBeNull()
    // Clone must NOT carry the original's Figma GUID
    expect(clone.source.id).toBeNull()
    expect(clone.source.orderKey).toBeNull()
    // But format should be preserved
    expect(clone.source.format).toBe('fig')
  })

  test('clone of clone does not leak source.id', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50
    })
    graph.updateNode(rect.id, {
      source: { ...rect.source, id: '1:99', format: 'fig' }
    })

    const clone1 = expectDefined(graph.cloneTree(rect.id, page.id), 'clone')
    expect(clone1).not.toBeNull()
    const clone2 = expectDefined(graph.cloneTree(clone1.id, page.id), 'clone')
    expect(clone2).not.toBeNull()
    expect(clone2.source.id).toBeNull()
  })

  test('clone preserves visual properties', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50
    })
    graph.updateNode(rect.id, {
      source: { ...rect.source, id: '1:42', format: 'fig' },
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 0, b: 0, a: 1 },
          visible: true,
          opacity: 1,
          blendMode: 'NORMAL' as const
        }
      ]
    })

    const clone = expectDefined(graph.cloneTree(rect.id, page.id), 'clone')
    expect(clone).not.toBeNull()
    expect(clone.name).toBe('Original')
    expect(clone.width).toBe(100)
    expect(clone.height).toBe(50)
    expect(clone.fills).toEqual(rect.fills)
  })

  test('clone recursively clears source.id on children', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Frame',
      width: 200,
      height: 200
    })
    graph.updateNode(frame.id, {
      source: { ...frame.source, id: '2:10', format: 'fig' }
    })
    const child = graph.createNode('RECTANGLE', frame.id, {
      name: 'Child',
      width: 50,
      height: 50
    })
    graph.updateNode(child.id, {
      source: { ...child.source, id: '2:11', format: 'fig' }
    })

    const clone = expectDefined(graph.cloneTree(frame.id, page.id), 'clone')
    expect(clone).not.toBeNull()
    expect(clone.source.id).toBeNull()
    const clonedChild = graph.getChildren(clone.id)[0]
    expect(clonedChild.source.id).toBeNull()
  })
  test('clone deep-copies source.fig so mutations do not affect original', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50
    })
    graph.updateNode(rect.id, {
      source: {
        ...rect.source,
        id: '1:42',
        orderKey: '!',
        format: 'fig',
        fig: {
          rawSize: { x: 100, y: 50 },
          rawTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
          rawNodeFields: { visible: true, opacity: 1 },
          layout: null,
          symbolOverrides: [],
          componentPropAssignments: [],
          derivedSymbolData: [],
          derivedSymbolDataLayoutVersion: null,
          uniformScaleFactor: null
        }
      }
    })

    const original = getNodeOrThrow(graph, rect.id)
    expect(original.source.fig.rawNodeFields).toEqual({ visible: true, opacity: 1 })

    const clone = expectDefined(graph.cloneTree(rect.id, page.id), 'clone')
    expect(clone).not.toBeNull()

    // Mutate the clone's source.fig (simulating what clearEditedSourceMetadata does)
    clone.source.fig.rawNodeFields = {}
    clone.source.fig.rawSize = null

    // Original must be unaffected
    expect(original.source.fig.rawNodeFields).toEqual({ visible: true, opacity: 1 })
    expect(original.source.fig.rawSize).toEqual({ x: 100, y: 50 })
  })
})
