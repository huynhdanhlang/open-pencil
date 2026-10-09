import * as v from 'valibot'

import type { TreeNode } from './tree'
import { parseScriptInput } from './validation'
import { designVar, isVariable } from './vars'

const VARIABLE_TAG = '$openpencil.variable'
const VariableSchema = v.strictObject({
  version: v.literal(1),
  id: v.optional(v.string()),
  name: v.string(),
  value: v.optional(
    v.union([
      v.string(),
      v.number(),
      v.strictObject({ r: v.number(), g: v.number(), b: v.number(), a: v.number() })
    ])
  )
})
const TreeSchema: v.GenericSchema<TreeNode> = v.object({
  type: v.string(),
  props: v.record(v.string(), v.unknown()),
  children: v.array(v.union([v.string(), v.lazy(() => TreeSchema)])),
  source: v.optional(v.object({ line: v.number() }))
})

/** Authored JSX may use branded variables, never forge their wire envelope. No tree copy. */
export function assertAuthoredTreeVariables(tree: TreeNode): void {
  const visited = new WeakSet<object>()
  const visitValue = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || isVariable(value)) return
    if (VARIABLE_TAG in value)
      throw new Error(`Design JSX transport key ${VARIABLE_TAG} is reserved`)
    if (visited.has(value)) return
    visited.add(value)
    for (const item of Object.values(value)) visitValue(item)
  }
  const visitTree = (node: TreeNode): void => {
    visitValue(node.props)
    for (const child of node.children) if (typeof child !== 'string') visitTree(child)
  }
  visitTree(tree)
}

function mapValue(value: unknown, decode: boolean): unknown {
  if (!decode && isVariable(value)) {
    return { [VARIABLE_TAG]: { version: 1, id: value.id, name: value.name, value: value.value } }
  }
  if (Array.isArray(value)) return value.map((item) => mapValue(item, decode))
  if (value === null || typeof value !== 'object') return value
  if (VARIABLE_TAG in value) {
    if (!decode) throw new Error(`Design JSX transport key ${VARIABLE_TAG} is reserved`)
    const envelope = parseScriptInput(
      'Invalid design variable transport',
      v.strictObject({ [VARIABLE_TAG]: VariableSchema }),
      value
    )
    return designVar(envelope[VARIABLE_TAG])
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, mapValue(item, decode)])
  )
}

function mapTree(tree: TreeNode, decode: boolean): TreeNode {
  return {
    ...tree,
    props: Object.fromEntries(
      Object.entries(tree.props).map(([key, value]) => [key, mapValue(value, decode)])
    ),
    children: tree.children.map((child) =>
      typeof child === 'string' ? child : mapTree(child, decode)
    )
  }
}

/** Preserve Symbol-branded variables across JSON without changing ordinary object semantics. */
export function encodeTreeForTransport(tree: TreeNode): TreeNode {
  return mapTree(tree, false)
}

/** Validate the complete incoming tree before a renderer can mutate the graph. */
export function decodeTreeFromTransport(value: unknown): TreeNode {
  return mapTree(parseScriptInput('Invalid design JSX tree', TreeSchema, value), true)
}
