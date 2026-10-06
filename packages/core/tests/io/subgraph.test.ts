import { expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SceneGraph } from '@open-pencil/scene-graph'

import { extractExportGraph } from '#core/io/subgraph'

test('subgraph extraction preserves shared imported buffers without aliasing live nodes', () => {
  const source = new SceneGraph()
  const page = source.addPage('Export')
  const bytes = new Uint8Array([1, 2, 3])
  const a = source.createNode('TEXT', page.id, { textPicture: bytes })
  const b = source.createNode('TEXT', page.id, { textPicture: bytes })
  const { graph } = extractExportGraph(source, { scope: 'selection', nodeIds: [a.id, b.id] })
  const cloneA = expectDefined(graph.getNode(a.id), 'first clone')
  const cloneB = expectDefined(graph.getNode(b.id), 'second clone')
  expect(cloneA.textPicture).toBe(cloneB.textPicture)
  expect(cloneA.textPicture).not.toBe(bytes)
  expectDefined(cloneA.textPicture, 'owned bytes')[0] = 9
  expect(bytes[0]).toBe(1)
  expect(source.getNode(a.id)).toBe(a)
})
