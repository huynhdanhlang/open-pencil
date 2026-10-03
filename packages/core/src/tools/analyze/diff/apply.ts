import { groupBy, isEqual } from 'es-toolkit'

import {
  buildComponent,
  createElement,
  jsxNodeFields,
  parseJSXAttributes,
  resolveToTree,
  sceneNodeAttributes,
  type JSXAttributeSource
} from '@open-pencil/design-jsx'
import { recordInstanceOverride, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { assertNodeEditable } from '#core/editor/capabilities'
import type { FigmaAPI } from '#core/figma-api'

import type { DiffOperation } from './operations'

export type ApplyStatus = 'applied' | 'removed' | 'moved' | 'added' | 'unchanged' | 'failed'

export interface ApplyResult {
  path: string
  id: string | null
  status: ApplyStatus
  /** Attributes an update sets or clears. */
  changes?: string[]
  error?: string
}

export interface ApplyOptions {
  dryRun: boolean
  /** Skip comparing the patch's old values with the document. */
  force: boolean
}

interface NodeUpdate {
  id: string
  fields: Partial<SceneNode>
  bind: Record<string, string>
  unbind: string[]
}

/** Where a moved node (`id`) or an added one (`jsx`) ends up. */
interface Placement {
  parentId: string
  index: number
  id?: string
  jsx?: string
}

/** A checked operation, with what committing it needs. */
interface Plan {
  result: ApplyResult
  update?: NodeUpdate
  place?: Placement
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failed(operation: DiffOperation, error: string): Plan {
  const id = operation.kind === 'add' ? operation.parentId : operation.id
  return { result: { path: operation.path, id, status: 'failed', error } }
}

function editableNode(graph: SceneGraph, id: string): SceneNode | string {
  const node = graph.getNode(id)
  if (!node) return `Node "${id}" not found`
  try {
    assertNodeEditable(graph, id)
  } catch (error) {
    return errorMessage(error)
  }
  return node
}

function parseSources(sources: string[]): JSXAttributeSource[] {
  return sources.flatMap((source) => parseJSXAttributes(source))
}

/** Old values that differ from the node's, and new attributes it already has. */
function staleValues(
  current: Map<string, string>,
  removed: JSXAttributeSource[],
  added: JSXAttributeSource[]
): string[] {
  const removedNames = new Set(removed.map((attribute) => attribute.name))
  const describe = (name: string) => current.get(name) ?? '(none)'
  return [
    ...removed
      .filter((attribute) => current.get(attribute.name) !== attribute.source)
      .map(({ name, source }) => `${name}: expected ${source}, found ${describe(name)}`),
    ...added
      .filter((attribute) => !removedNames.has(attribute.name) && current.has(attribute.name))
      .map(({ name }) => `${name}: expected none, found ${describe(name)}`)
  ]
}

/** The fields and bindings that change between two attribute sets of one node. */
function nodeUpdate(
  graph: SceneGraph,
  node: SceneNode,
  before: JSXAttributeSource[],
  after: JSXAttributeSource[]
): NodeUpdate {
  const parentId = node.parentId ?? ''
  const from = jsxNodeFields(graph, node.type, before, parentId)
  const to = jsxNodeFields(graph, node.type, after, parentId)
  const fields = Object.fromEntries(
    Object.entries(to.fields).filter(
      ([key, value]) => !isEqual(from.fields[key as keyof SceneNode], value)
    )
  )
  return {
    id: node.id,
    fields,
    bind: Object.fromEntries(
      Object.entries(to.bindings).filter(([field, id]) => from.bindings[field] !== id)
    ),
    unbind: Object.keys(from.bindings).filter((field) => !(field in to.bindings))
  }
}

function planUpdate(
  graph: SceneGraph,
  operation: Extract<DiffOperation, { kind: 'update' }>,
  force: boolean
): Plan {
  const node = editableNode(graph, operation.id)
  if (typeof node === 'string') return failed(operation, node)
  const attributes = sceneNodeAttributes(node.id, graph)
  if (!attributes) return failed(operation, `${node.type} nodes have no JSX attributes`)
  try {
    const removed = parseSources(operation.removed)
    const added = parseSources(operation.added)
    const current = new Map(attributes.map(({ name, source }) => [name, source]))
    const stale = force ? [] : staleValues(current, removed, added)
    if (stale.length > 0) {
      return failed(operation, `Current state does not match: ${stale.join('; ')}`)
    }
    const target = new Map(current)
    for (const { name } of removed) target.delete(name)
    for (const { name, source } of added) target.set(name, source)
    const toSources = (map: Map<string, string>) =>
      [...map].map(([name, source]) => ({ name, source }))
    const update = nodeUpdate(graph, node, attributes, toSources(target))
    const changes = [...new Set([...removed, ...added].map((attribute) => attribute.name))]
    const empty =
      Object.keys(update.fields).length === 0 &&
      Object.keys(update.bind).length === 0 &&
      update.unbind.length === 0
    const status = empty ? 'unchanged' : 'applied'
    return { result: { path: operation.path, id: node.id, status, changes }, update }
  } catch (error) {
    return failed(operation, errorMessage(error))
  }
}

function planAdd(graph: SceneGraph, operation: Extract<DiffOperation, { kind: 'add' }>): Plan {
  const parent = editableNode(graph, operation.parentId)
  if (typeof parent === 'string') return failed(operation, parent)
  if (!operation.jsx.trim()) return failed(operation, 'Added node has no JSX')
  try {
    // Evaluate now so invalid JSX fails before anything changes.
    if (!resolveToTree(createElement(buildComponent(operation.jsx), null))) {
      return failed(operation, 'Added JSX renders nothing')
    }
  } catch (error) {
    return failed(operation, errorMessage(error))
  }
  const place = { parentId: parent.id, index: operation.index, jsx: operation.jsx }
  return { result: { path: operation.path, id: null, status: 'added' }, place }
}

function planOperation(graph: SceneGraph, operation: DiffOperation, force: boolean): Plan {
  switch (operation.kind) {
    case 'update':
      return planUpdate(graph, operation, force)
    case 'remove': {
      const node = editableNode(graph, operation.id)
      if (typeof node === 'string') return failed(operation, node)
      return { result: { path: operation.path, id: node.id, status: 'removed' } }
    }
    case 'move': {
      const node = editableNode(graph, operation.id)
      if (typeof node === 'string') return failed(operation, node)
      if (!node.parentId) return failed(operation, `Node "${node.id}" has no parent`)
      const place = { parentId: node.parentId, index: operation.index, id: node.id }
      return { result: { path: operation.path, id: node.id, status: 'moved' }, place }
    }
  }
  return planAdd(graph, operation)
}

/** Check every operation against the document without changing it. */
export function planOperations(
  graph: SceneGraph,
  operations: DiffOperation[],
  force: boolean
): Plan[] {
  return operations.map((operation) => planOperation(graph, operation, force))
}

function commitUpdate(graph: SceneGraph, update: NodeUpdate): void {
  graph.updateNode(update.id, update.fields)
  recordInstanceOverride(graph, update.id, Object.keys(update.fields))
  for (const field of update.unbind) graph.unbindVariable(update.id, field)
  for (const [field, variableId] of Object.entries(update.bind)) {
    graph.bindVariable(update.id, field, variableId)
  }
}

/**
 * Moves and additions under one parent, as jsondiffpatch patches arrays: take the moved
 * children out, then insert each moved or added child at its final index, in index order.
 */
async function commitPlacements(
  figma: FigmaAPI,
  parentId: string,
  plans: (Plan & { place: Placement })[]
) {
  const { renderJSX } = await import('#core/design-jsx')
  const graph = figma.graph
  const moved = new Set(plans.flatMap((plan) => plan.place.id ?? []))
  const order = (graph.getNode(parentId)?.childIds ?? []).filter((id) => !moved.has(id))
  for (const plan of plans.toSorted((a, b) => a.place.index - b.place.index)) {
    const { id, jsx, index } = plan.place
    if (id) {
      order.splice(index, 0, id)
      continue
    }
    try {
      const results = await renderJSX(graph, jsx ?? '', { parentId })
      plan.result.id = results[0].id
      order.splice(index, 0, ...results.map((result) => result.id))
    } catch (error) {
      plan.result.status = 'failed'
      plan.result.error = errorMessage(error)
    }
  }
  for (const [index, id] of order.entries()) {
    if (graph.getNode(parentId)?.childIds[index] !== id) graph.insertChildAt(id, parentId, index)
  }
}

/**
 * Apply a patch's operations. Every operation is checked first and nothing changes unless all
 * pass; a dry run stops there. Updates go through the JSX renderer's prop handling and change
 * only the fields their attributes move, so IDs, instance links, and other state survive.
 */
export async function applyOperations(
  figma: FigmaAPI,
  operations: DiffOperation[],
  options: ApplyOptions
): Promise<ApplyResult[]> {
  const plans = planOperations(figma.graph, operations, options.force)
  if (options.dryRun || plans.some((plan) => plan.result.status === 'failed')) {
    return plans.map((plan) => plan.result)
  }
  for (const plan of plans) {
    if (plan.update && plan.result.status === 'applied') {
      commitUpdate(figma.graph, plan.update)
    }
  }
  for (const plan of plans) {
    if (plan.result.status === 'removed' && plan.result.id) {
      // A removed ancestor already took its descendants with it.
      figma.getNodeById(plan.result.id)?.remove()
    }
  }
  const placed = plans.filter((plan): plan is Plan & { place: Placement } => !!plan.place)
  const byParent = groupBy(placed, (plan) => plan.place.parentId)
  for (const [parentId, group] of Object.entries(byParent)) {
    await commitPlacements(figma, parentId, group)
  }
  return plans.map((plan) => plan.result)
}
