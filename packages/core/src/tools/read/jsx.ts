import * as v from 'valibot'

import { sceneNodeToJSX } from '@open-pencil/design-jsx'

import { jsxPatch } from '#core/tools/analyze/diff/jsx'
import { nodeIdInput, nodeComparisonInput } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'

const MAX_JSX_LENGTH = 12_000

export const getJSX = defineTool({
  name: 'get_jsx',
  description:
    'Get JSX representation of a node and its children. Inline results over 12,000 characters are truncated previews; supply path for complete file output. Uses the render tool syntax, with documented export fidelity limitations.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({
    id: nodeIdInput,
    path: v.optional(
      v.pipe(
        v.string(),
        v.description(
          'Write complete, untruncated JSX to this path instead of returning it (requires OPENPENCIL_MCP_ROOT)'
        )
      )
    )
  }),
  execute: (figma, { id, path }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    const jsx = sceneNodeToJSX(id, figma.graph)
    if (!path && jsx.length > MAX_JSX_LENGTH) {
      return {
        id,
        name: node.name,
        jsx: jsx.slice(0, MAX_JSX_LENGTH),
        truncated: true,
        totalLength: jsx.length
      }
    }
    return { id, name: node.name, jsx }
  }
})

export const diffJSX = defineTool({
  name: 'diff_jsx',
  description:
    'Structural diff between two nodes in JSX format. Shows added/removed children, changed props.',
  execution: { kind: 'sync', mutation: 'none' },
  input: nodeComparisonInput,
  execute: (figma, { from, to }) => {
    const fromNode = figma.getNodeById(from)
    if (!fromNode) return { error: `Node "${from}" not found` }
    const toNode = figma.getNodeById(to)
    if (!toNode) return { error: `Node "${to}" not found` }

    const patch = jsxPatch(
      fromNode.name,
      toNode.name,
      sceneNodeToJSX(from, figma.graph),
      sceneNodeToJSX(to, figma.graph)
    )
    return patch === null ? { diff: null, message: 'No differences' } : { diff: patch }
  }
})
