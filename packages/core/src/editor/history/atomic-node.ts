import { isEqual } from 'es-toolkit'

import type { SceneNode } from '@open-pencil/scene-graph'
import { variableBindingOwner } from '@open-pencil/scene-graph/variables'

import type { FigmaAPI } from '#core/figma-api'
import { parseToolArgs, type ToolDef } from '#core/tools/schema'
import { bindVariable } from '#core/tools/variables/bindings'
import { unbindVariable } from '#core/tools/variables/unbind'

import type { MutationEditor } from './atomic-tool'

type SavedNode = {
  node: SceneNode
  values: Partial<SceneNode>
  absent: Set<keyof SceneNode>
  editedFields: string[]
}
type NodeChange = {
  node: SceneNode
  before: Partial<SceneNode>
  after: Partial<SceneNode>
  absent: Record<'before' | 'after', (keyof SceneNode)[]>
  editedFields: Record<'before' | 'after', string[]>
}
const IDENTITY_FIELDS = new Set(['id', 'type', 'parentId', 'childIds', 'componentId', 'source'])

/** Canonical single-node property tools and layout use the synchronous mutation observer. */
export function executeAtomicNodeTool(
  editor: MutationEditor,
  figma: FigmaAPI,
  def: ToolDef,
  args: Record<string, unknown>,
  maximumNodes: number,
  label = 'Agent'
): unknown {
  const parsed = parseToolArgs(def.name, def.input, args)
  const bindingTool = def === bindVariable || def === unbindVariable
  const id = bindingTool ? parsed.node_id : parsed.id
  if (typeof id !== 'string') throw new Error('Missing node ID')
  const graph = figma.graph
  const saved = new Map<string, SavedNode>()
  const created: string[] = []
  const remember = (node: SceneNode, keys: Iterable<keyof SceneNode>) => {
    let entry = saved.get(node.id)
    if (!entry) {
      if (saved.size >= maximumNodes)
        throw new Error(`Property edit affects too many nodes (maximum ${maximumNodes})`)
      entry = { node, values: {}, absent: new Set(), editedFields: [...node.source.editedFields] }
      saved.set(node.id, entry)
    }
    for (const key of keys) {
      if (Object.hasOwn(entry.values, key) || entry.absent.has(key)) continue
      // Canonical setters/layout replace these fields. Freeze them together at commit
      // so invalidated glyph views retain one shared, owned backing buffer.
      if (Object.hasOwn(node, key)) Reflect.set(entry.values, key, node[key])
      else entry.absent.add(key)
    }
  }
  const restore = () =>
    graph.preserveSourceMetadataDuring(() => {
      for (const createdId of created.reverse()) graph.deleteNode(createdId)
      const entries = [...saved.values()]
      const values = structuredClone(entries.map((entry) => entry.values))
      for (const [index, entry] of entries.entries()) {
        graph.restoreNodeProperties(entry.node.id, values[index], [...entry.absent])
        entry.node.source.editedFields = [...entry.editedFields]
      }
    })
  const replay = (entries: NodeChange[], direction: 'before' | 'after') => {
    if (
      editor.graph !== graph ||
      entries.some((entry) => graph.getNode(entry.node.id) !== entry.node)
    )
      throw new Error('The target document or edited node has been replaced')
    graph.withBufferedEvents(() => {
      const values = structuredClone(entries.map((entry) => entry[direction]))
      graph.preserveSourceMetadataDuring(() => {
        for (const [index, entry] of entries.entries()) {
          graph.restoreNodeProperties(entry.node.id, values[index], entry.absent[direction])
          const changedMarkers = new Set(
            [...entry.editedFields.before, ...entry.editedFields.after].filter(
              (field) =>
                entry.editedFields.before.includes(field) !==
                entry.editedFields.after.includes(field)
            )
          )
          entry.node.source.editedFields = [
            ...entry.node.source.editedFields.filter((field) => !changedMarkers.has(field)),
            ...entry.editedFields[direction].filter((field) => changedMarkers.has(field))
          ]
        }
      })
      editor.runLayoutForNode(id)
      editor.requestRender()
    })
  }

  try {
    return graph.withBufferedEvents(() => {
      try {
        // Proxy setters can change this override Map before graph.updateNode observes it.
        const node = graph.getNode(id)
        if (bindingTool && node) remember(node, ['boundVariables', 'variableBindingScales'])
        const nearest = graph.closest(id, (node) => node.type === 'INSTANCE')
        const bindingOwner = bindingTool && node ? variableBindingOwner(graph, node) : undefined
        const instances = new Set(
          [nearest, bindingOwner].filter((owner) => owner?.type === 'INSTANCE')
        )
        for (const instance of instances) {
          if (!instance) continue
          remember(instance, ['instanceOverrides'])
          const owner = saved.get(instance.id)
          if (owner) owner.values.instanceOverrides = structuredClone(instance.instanceOverrides)
        }
        const result = graph.observeNodeMutationsDuring(
          () => {
            const result = def.execute(figma, parsed)
            if (result instanceof Promise)
              throw new Error('Atomic tools must execute synchronously')
            if (result && typeof result === 'object' && 'error' in result)
              throw new Error(String(result.error))
            editor.runLayoutForNode(id)
            return result
          },
          {
            updated: (node, values, absent) => {
              const keys = new Set([...(Object.keys(values) as (keyof SceneNode)[]), ...absent])
              if ([...keys].some((key) => IDENTITY_FIELDS.has(key)))
                throw new Error('Scoped property edits must preserve hierarchy and source identity')
              remember(node, keys)
            },
            created: (node) => {
              created.push(node.id)
              throw new Error('Scoped property edits must not create nodes')
            }
          }
        )
        const entries: NodeChange[] = []
        for (const entry of saved.values()) {
          const before: Partial<SceneNode> = {},
            after: Partial<SceneNode> = {}
          const absent: NodeChange['absent'] = { before: [], after: [] }
          for (const key of new Set([
            ...(Object.keys(entry.values) as (keyof SceneNode)[]),
            ...entry.absent
          ])) {
            const existed = !entry.absent.has(key),
              exists = Object.hasOwn(entry.node, key)
            if (existed === exists && isEqual(entry.values[key], entry.node[key])) continue
            Reflect.set(before, key, entry.values[key])
            Reflect.set(after, key, entry.node[key])
            if (!existed) absent.before.push(key)
            if (!exists) absent.after.push(key)
          }
          entries.push({
            node: entry.node,
            before,
            after,
            absent,
            editedFields: {
              before: entry.editedFields,
              after: [...entry.node.source.editedFields]
            }
          })
        }
        if (entries.some((entry) => Object.keys(entry.after).length > 0)) {
          const owned = structuredClone(
            entries.map((entry) => ({ before: entry.before, after: entry.after }))
          )
          for (const [index, entry] of entries.entries()) {
            entry.before = owned[index].before
            entry.after = owned[index].after
          }
          editor.pushUndoEntry({
            label: `${label}: ${def.name}`,
            inverse: () => replay(entries, 'before'),
            forward: () => replay(entries, 'after')
          })
        } else restore()
        return result
      } catch (error) {
        restore()
        throw error
      }
    })
  } finally {
    editor.requestRender()
  }
}
