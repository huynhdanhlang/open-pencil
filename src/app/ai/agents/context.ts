import { uniq } from 'es-toolkit/array'

import { HELPER_LIMITS, utf8Bytes } from '@open-pencil/core/rpc'
import { sceneNodeToJSX } from '@open-pencil/design-jsx'
import type { SceneGraph } from '@open-pencil/scene-graph'

import type { HelperSnapshot } from './types'

export async function captureHelperSnapshot(
  graph: SceneGraph,
  target: { document_id: string; page_id: string },
  nodeIds: string[],
  profile: { provider: string; requested_model: string | null; requested_effort?: string | null }
): Promise<HelperSnapshot> {
  const roots = uniq(nodeIds)
  const visited = new Set<string>()
  for (const id of roots) {
    let ancestor = graph.getNode(id)
    const ancestors = new Set<string>()
    while (ancestor && ancestor.id !== target.page_id) {
      if (ancestors.has(ancestor.id)) throw new Error('invalid_target: cyclic ancestry')
      ancestors.add(ancestor.id)
      ancestor = ancestor.parentId ? graph.getNode(ancestor.parentId) : undefined
    }
    if (!ancestor || id === target.page_id)
      throw new Error('invalid_target: selected node is missing or belongs to another page')
    const pending = [id]
    while (pending.length) {
      const current = pending.pop()
      if (current === undefined) break
      if (visited.has(current)) continue
      visited.add(current)
      if (visited.size > HELPER_LIMITS.nodes)
        throw new Error('context_too_large: select a subtree with at most 200 nodes')
      const node = graph.getNode(current)
      if (!node) throw new Error('invalid_target: selected subtree changed')
      pending.push(...node.childIds)
    }
  }
  const context = roots.map((id) => sceneNodeToJSX(id, graph)).join('\n\n')
  if (utf8Bytes(context) > HELPER_LIMITS.contextBytes)
    throw new Error('context_too_large: split the selected design scope')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context))
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return { version: 1, ...target, node_ids: roots, sha256, context, ...profile }
}
