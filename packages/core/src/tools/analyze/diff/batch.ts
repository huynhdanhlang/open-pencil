import * as v from 'valibot'

import {
  DESIGN_JSX_SUPPORTED_PROPERTIES,
  normalizeJSXAttributeSources,
  parseJSXAttributes,
  sceneNodeAttributes
} from '@open-pencil/design-jsx'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { nodeIdInput } from '#core/tools/input'

import type { DiffOperation } from './operations'

export const MAX_DIFF_OPERATIONS = 500
export const MAX_DIFF_PAYLOAD = 1_048_576
const attributes = v.pipe(v.string(), v.maxLength(MAX_DIFF_PAYLOAD))
const index = v.pipe(v.number(), v.integer(), v.minValue(0))

export const bulkOperationsInput = v.pipe(
  v.array(
    v.variant('kind', [
      v.strictObject({
        kind: v.literal('update'),
        id: nodeIdInput,
        attributes,
        expected: v.optional(attributes),
        unset: v.optional(v.pipe(v.array(v.string()), v.maxLength(100)))
      }),
      v.strictObject({ kind: v.literal('remove'), id: nodeIdInput }),
      v.strictObject({ kind: v.literal('move'), id: nodeIdInput, index }),
      v.strictObject({ kind: v.literal('add'), parentId: nodeIdInput, index, jsx: attributes })
    ])
  ),
  v.minLength(1),
  v.maxLength(MAX_DIFF_OPERATIONS),
  v.description(
    'Up to 500 edits: update JSX attributes (optional expected values/unset names), add a JSX subtree, remove, or move to a final sibling index. One grouped edit; IDs refer to existing nodes.'
  )
)

type BulkOperation = v.InferOutput<typeof bulkOperationsInput>[number]

export function checkBulkExpected(graph: SceneGraph, input: BulkOperation[], force: boolean): void {
  if (force) return
  for (const operation of input) {
    if (operation.kind !== 'update' || !operation.expected) continue
    const current = new Map(
      sceneNodeAttributes(operation.id, graph)?.map(({ name, source }) => [name, source])
    )
    for (const { name, source } of normalizeJSXAttributeSources(
      parseJSXAttributes(operation.expected)
    )) {
      if (current.get(name) !== source)
        throw new Error(`Node "${operation.id}": current state does not match ${source}`)
    }
  }
}

/** Translate convenient edits into the same checked patch plan; never a second executor. */
export function bulkOperations(
  graph: SceneGraph,
  input: BulkOperation[],
  force: boolean
): DiffOperation[] {
  checkBulkExpected(graph, input, force)
  return input.map((operation) => {
    if (operation.kind === 'add') return { ...operation, path: `/added to ${operation.parentId}` }
    const node = graph.getNode(operation.id)
    if (!node) throw new Error(`Node "${operation.id}" not found`)
    const path = `/${node.name}`
    if (operation.kind !== 'update') return { ...operation, path }
    const current = new Map(
      sceneNodeAttributes(node.id, graph)?.map(({ name, source }) => [name, source])
    )
    const added = normalizeJSXAttributeSources(parseJSXAttributes(operation.attributes))
    const unset = normalizeJSXAttributeSources(
      (operation.unset ?? []).map((name) => {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !DESIGN_JSX_SUPPORTED_PROPERTIES.has(name))
          throw new Error(`Unsupported unset attribute "${name}"`)
        return { name, source: `${name}={undefined}` }
      })
    ).map(({ name }) => name)
    const names = new Set([...added.map(({ name }) => name), ...unset])
    for (const name of unset) {
      if (added.some((attribute) => attribute.name === name))
        throw new Error(`Cannot set and unset "${name}" together`)
    }
    return {
      kind: 'update',
      path,
      id: node.id,
      removed: [...names].flatMap((name) => current.get(name) ?? []),
      added: added.map(({ source }) => source)
    }
  })
}

/** Every directly edited forest is owned by the grouped history, including across pages. */
export function checkOperationScope(
  graph: SceneGraph,
  operations: DiffOperation[],
  pageIds: string[]
): void {
  const pages = new Set(pageIds)
  for (const id of pages)
    if (graph.getNode(id)?.type !== 'CANVAS') throw new Error(`Page "${id}" not found`)
  const removed = new Set(operations.filter((op) => op.kind === 'remove').map((op) => op.id))
  const updates = new Set<string>()
  const moves = new Set<string>()
  for (const operation of operations) {
    const id = operation.kind === 'add' ? operation.parentId : operation.id
    const node = graph.getNode(id)
    const page = graph.closest(id, (candidate) => candidate.type === 'CANVAS')
    if (!node || !page || !pages.has(page.id))
      throw new Error(`Node "${id}" is outside the included pages`)
    if (node.type === 'CANVAS' && operation.kind !== 'add')
      throw new Error('Use page tools to edit canvas roots')
    if (
      operation.kind !== 'remove' &&
      graph.closest(id, (candidate) => removed.has(candidate.id))
    ) {
      throw new Error(`Node "${id}" is removed by this group`)
    }
    if (operation.kind === 'update') {
      if (updates.has(id)) throw new Error(`Combine updates for node "${id}" into one operation`)
      updates.add(id)
    }
    if (operation.kind === 'move') {
      if (moves.has(id)) throw new Error(`Provide one final sibling index for node "${id}"`)
      moves.add(id)
    }
  }
}
