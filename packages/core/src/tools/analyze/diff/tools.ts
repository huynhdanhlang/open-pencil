import * as v from 'valibot'

import {
  normalizeJSXAttributeSources,
  parseJSXAttributes,
  sceneNodeAttributes,
  sceneNodeToJSX
} from '@open-pencil/design-jsx'
import type { SceneGraph } from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { toolNumber, nodeIdInput, nodeComparisonInput } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'

import { applyOperations, planOperations, prepareAdditions, type ApplyStatus } from './apply'
import {
  bulkOperations,
  bulkOperationsInput,
  checkOperationScope,
  checkBulkExpected,
  MAX_DIFF_OPERATIONS,
  MAX_DIFF_PAYLOAD
} from './batch'
import { formatOperations, parseOperations } from './format'
import { deltaOperations, type DiffOperation } from './operations'
import { DEFAULT_DIFF_DEPTH, diffProjections, projectTree, type ProjectOptions } from './projection'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Operations that turn the `from` tree into the `to` tree, matching children by name path. */
function treeOperations(
  graph: SceneGraph,
  from: string,
  to: string,
  options: ProjectOptions
): DiffOperation[] {
  const before = projectTree(graph, from, options)
  const after = projectTree(graph, to, options)
  if (!before || !after) return []
  // Compare the trees, not their roots' names: a copy is usually renamed.
  const { name: _name, ...attributes } = after.attributes
  const name = before.attributes.name as string | undefined
  const target = {
    ...after,
    name: before.name,
    attributes: name ? { ...attributes, name } : attributes
  }
  return deltaOperations(diffProjections(before, target), before, target, (id) =>
    sceneNodeToJSX(id, graph)
  )
}

export const diffCreate = defineTool({
  name: 'diff_create',
  description:
    'Patch that turns one node tree into another, as JSX attribute changes per node plus moved, added, and removed children. Children are matched by name. Apply it to the first tree with diff_apply.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({
    ...nodeComparisonInput.entries,
    depth: v.optional(
      toolNumber(
        v.pipe(
          v.number(),
          v.integer(),
          v.minValue(0),
          v.description(`Max tree depth (default: ${DEFAULT_DIFF_DEPTH})`)
        )
      )
    )
  }),
  execute: (figma, args) => {
    if (!figma.graph.getNode(args.from)) return { error: `Node "${args.from}" not found` }
    if (!figma.graph.getNode(args.to)) return { error: `Node "${args.to}" not found` }
    const operations = treeOperations(figma.graph, args.from, args.to, {
      match: 'path',
      depth: args.depth ?? DEFAULT_DIFF_DEPTH
    })
    return operations.length === 0
      ? { diff: null, message: 'No differences found' }
      : { diff: formatOperations(operations) }
  }
})

export const diffShow = defineTool({
  name: 'diff_show',
  description:
    'Preview setting JSX attributes on a node, without changing it. Returns the patch, which diff_apply applies.',
  execution: { kind: 'sync', mutation: 'none' },
  input: v.strictObject({
    id: nodeIdInput,
    attributes: v.pipe(
      v.string(),
      v.description(
        'JSX attributes to set, named as the JSX export writes them. Example: w={200} bg="#FF0000" opacity={0.5}'
      )
    )
  }),
  execute: (figma, args) => {
    const node = figma.graph.getNode(args.id)
    if (!node) return { error: `Node "${args.id}" not found` }
    const current = sceneNodeAttributes(node.id, figma.graph)
    if (!current) return { error: `${node.type} nodes have no JSX attributes` }
    let proposed
    try {
      proposed = normalizeJSXAttributeSources(parseJSXAttributes(args.attributes))
    } catch (error) {
      return { error: errorMessage(error) }
    }
    const sources = new Map(current.map(({ name, source }) => [name, source]))
    const changed = proposed.filter(({ name, source }) => sources.get(name) !== source)
    if (changed.length === 0) return { diff: null, message: 'No changes' }
    const operation: DiffOperation = {
      kind: 'update',
      path: `/${node.name}`,
      id: node.id,
      removed: changed.flatMap(({ name }) => sources.get(name) ?? []),
      added: changed.map(({ source }) => source)
    }
    // Check the change the way diff_apply would, so invalid values surface here.
    const [plan] = planOperations(figma.graph, [operation], false)
    if (plan.result.error) return { error: plan.result.error }
    return { diff: formatOperations([operation]) }
  }
})

const diffApplyInput = v.strictObject({
  patch: v.optional(
    v.pipe(v.string(), v.description('Patch text from diff_create, diff_show, or diff_changes'))
  ),
  operations: v.optional(bulkOperationsInput),
  page_ids: v.optional(
    v.pipe(
      v.array(nodeIdInput),
      v.minLength(1),
      v.maxLength(100),
      v.description(
        'Explicit pages whose nodes may be directly edited; defaults to the current page. Component dependencies outside these pages are preserved by Undo.'
      )
    )
  ),
  dryRun: v.optional(
    v.pipe(v.boolean(), v.description('Check and report changes without applying')),
    false
  ),
  force: v.optional(
    v.pipe(v.boolean(), v.description('Apply even when current values differ from the patch')),
    false
  )
})

export const diffApply = defineTool({
  name: 'diff_apply',
  description:
    'Edit many related parts in one grouped request: provide a patch OR structured operations (update JSX attributes, add JSX subtrees, remove, move). Include page_ids for edits across pages of this document; otherwise only the current page is directly editable. Linked components propagate normally. Preflights every edit; use dryRun to inspect and expected attributes for stale guards. MCP uses one Undo/Redo and rolls back the whole group on failure. Up to 500 edits and 1 MiB payload.',
  execution: { kind: 'async', mutation: 'document' },
  input: diffApplyInput,
  execute: async (figma, args) => (await prepareDiffApply(figma, args)).execute()
})

/** Resolve artwork before history, then commit only prepared graph operations. */
export async function prepareDiffApply(
  figma: FigmaAPI,
  raw: Record<string, unknown>
): Promise<{
  changes: boolean
  execute: () => Promise<Record<string, unknown>>
}> {
  const noChange = (result: Record<string, unknown>) => ({
    changes: false,
    execute: async () => result
  })
  try {
    const args = v.parse(diffApplyInput, raw)
    if ((args.patch !== undefined) === (args.operations !== undefined))
      return noChange({ error: 'Provide exactly one of patch or operations' })
    const payload = args.patch ?? JSON.stringify(args.operations)
    if (new TextEncoder().encode(payload).byteLength > MAX_DIFF_PAYLOAD)
      return noChange({ error: 'Diff payload exceeds 1 MiB; split into coherent groups' })
    const operations = args.operations
      ? bulkOperations(figma.graph, args.operations, args.force)
      : parseOperations(args.patch!)
    if (!operations.length) return noChange({ error: 'No hunks found' })
    if (operations.length > MAX_DIFF_OPERATIONS)
      return noChange({ error: 'Diff exceeds 500 operations; split into coherent groups' })
    const pageIds = args.page_ids ?? [figma.currentPageId]
    checkOperationScope(figma.graph, operations, pageIds)
    const additions = await prepareAdditions(figma, operations, !args.dryRun)
    if (args.operations) checkBulkExpected(figma.graph, args.operations, args.force)
    checkOperationScope(figma.graph, operations, pageIds)
    const plans = planOperations(figma.graph, operations, args.force, additions)
    const summarize = (results: ReturnType<typeof planOperations>[number]['result'][]) => {
      const count = (...statuses: ApplyStatus[]) =>
        results.filter((result) => statuses.includes(result.status)).length
      const failed = count('failed')
      if (failed && !args.dryRun)
        return { error: 'Patch does not apply', results: results.filter((result) => result.error) }
      return {
        dryRun: args.dryRun,
        applied: count('applied', 'removed', 'moved', 'added'),
        failed,
        results
      }
    }
    if (args.dryRun || plans.some((plan) => plan.result.status === 'failed'))
      return noChange(summarize(plans.map((plan) => plan.result)))
    return {
      changes: plans.some((plan) => plan.result.status !== 'unchanged'),
      execute: async () => {
        if (args.operations) checkBulkExpected(figma.graph, args.operations, args.force)
        checkOperationScope(figma.graph, operations, pageIds)
        return summarize(
          await applyOperations(figma, operations, { dryRun: false, force: args.force, additions })
        )
      }
    }
  } catch (error) {
    return noChange({ error: errorMessage(error) })
  }
}
