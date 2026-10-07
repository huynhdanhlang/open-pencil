import { expect, test } from 'bun:test'

import * as v from 'valibot'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import { SceneGraph } from '@open-pencil/scene-graph'

import { getJSX } from '#core/tools/read/jsx'

const text = 'Nội dung thiết kế <giữ nguyên> & kết thúc. '.repeat(400)
const resultSchema = v.object({
  jsx: v.string(),
  truncated: v.optional(v.boolean()),
  totalLength: v.optional(v.number())
})

function setup() {
  const graph = new SceneGraph()
  const root = graph.createNode('FRAME', graph.getPages()[0].id, { name: 'Large subtree' })
  graph.createNode('TEXT', root.id, { name: 'Last label', text })
  return { graph, root, api: new FigmaAPI(graph) }
}

test('inline JSX remains a bounded preview with explicit truncation metadata', () => {
  const { root, api } = setup()
  const result = v.parse(resultSchema, getJSX.execute(api, { id: root.id }))
  expect(result).toMatchObject({ truncated: true })
  expect(result.jsx?.length).toBe(12_000)
  expect(result.totalLength).toBeGreaterThan(12_000)
})

test('path JSX is complete and can render its final text without clipping', async () => {
  const { root, api } = setup()
  const result = v.parse(
    resultSchema,
    getJSX.execute(api, { id: root.id, path: '/owned/subtree.jsx' })
  )
  expect(result.truncated).not.toBe(true)
  expect(result.jsx?.length).toBeGreaterThan(12_000)
  const restored = new SceneGraph()
  const roots = await renderJSX(restored, result.jsx ?? '')
  expect(roots).toHaveLength(1)
  expect(restored.getChildren(roots[0].id)[0].text).toBe(text)
})
