import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { computeAllLayouts } from '#core/layout'

const isComponent = (node: SceneNode) => node.type === 'COMPONENT'

function componentSyncOrder(graph: SceneGraph, seeds: Set<string>): string[] {
  const dependents = new Map<string, Set<string>>()
  const discover = (id: string): void => {
    if (dependents.has(id)) return
    const parents = new Set<string>()
    dependents.set(id, parents)
    for (const instance of graph.getInstances(id)) {
      const parent = instance.parentId ? graph.closest(instance.parentId, isComponent) : undefined
      if (parent) parents.add(parent.id)
    }
    for (const parent of parents) discover(parent)
  }
  for (const id of seeds) discover(id)
  const result: string[] = []
  const active = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (active.has(id)) throw new Error('Cyclic component synchronization dependency')
    if (visited.has(id)) return
    active.add(id)
    for (const parent of dependents.get(id) ?? []) visit(parent)
    active.delete(id)
    visited.add(id)
    result.push(id)
  }
  for (const id of seeds) visit(id)
  return result.reverse()
}

type ComputeLayouts = (graph: SceneGraph, scopeId?: string) => void

/**
 * A component and its instances need layout, including ancestor containers that can resize
 * or reposition them. A free-positioned page's unrelated trees do not participate.
 */
function affectedLayoutScopeIds(
  graph: SceneGraph,
  editedIds: Iterable<string>,
  componentIds: Iterable<string>
): Set<string> {
  const scopeIds = new Set<string>()
  const addScopeOf = (nodeId: string) => {
    if (!graph.getNode(nodeId)) return
    let scopeId = nodeId
    let parentId = graph.getNode(nodeId)?.parentId
    const visited = new Set<string>([nodeId])
    while (parentId) {
      const parent = graph.closest(parentId, (node) => node.layoutMode !== 'NONE')
      if (!parent) break
      if (visited.has(parent.id)) throw new Error('Cyclic component layout ancestry')
      visited.add(parent.id)
      scopeId = parent.id
      parentId = parent.parentId
    }
    scopeIds.add(scopeId)
  }

  // Graph events include the old parent of a move and the surviving parent of a deletion.
  // Keep those scopes even when they are outside a component or on its previous page.
  for (const id of editedIds) addScopeOf(id)
  for (const componentId of componentIds) {
    addScopeOf(componentId)
    for (const instance of graph.getInstances(componentId)) addScopeOf(instance.id)
  }
  return new Set(
    [...scopeIds].filter((id) => {
      const parentId = graph.getNode(id)?.parentId
      return !parentId || !graph.closest(parentId, (node) => scopeIds.has(node.id))
    })
  )
}

export function createComponentSyncScheduler(
  getGraph: () => SceneGraph,
  requestRender: () => void,
  computeLayouts: ComputeLayouts = computeAllLayouts
) {
  let pendingComponentSync: Set<string> | null = null
  let isFlushingComponentSync = false
  let removedSourceIds = new Set<string>()

  function flushComponentSync() {
    const ids = pendingComponentSync
    if (!ids) return
    pendingComponentSync = null
    isFlushingComponentSync = true
    const removed = removedSourceIds
    removedSourceIds = new Set()
    activeRemovedSourceIds = removed
    try {
      const graph = getGraph()
      const componentIds = new Set<string>()
      for (const id of ids) {
        const component = graph.closest(id, isComponent)
        if (component) componentIds.add(component.id)
      }
      const ordered = componentSyncOrder(graph, componentIds)
      for (const compId of ordered) {
        graph.syncInstances(compId, removed)
      }
      if (componentIds.size > 0) {
        for (const scopeId of affectedLayoutScopeIds(graph, ids, ordered))
          computeLayouts(graph, scopeId)
        requestRender()
      }
    } finally {
      activeRemovedSourceIds = null
      isFlushingComponentSync = false
    }
  }

  let activeRemovedSourceIds: Set<string> | null = null

  function scheduleComponentSync(nodeId: string, removedSourceId?: string) {
    // Import/materialization has already resolved component overrides. These updates
    // are not authored component edits and must not reset instances to their defaults.
    const graph = getGraph()
    if (graph.isApplyingImportedState || graph.isApplyingLayout) return
    if (removedSourceId) (activeRemovedSourceIds ?? removedSourceIds).add(removedSourceId)
    if (isFlushingComponentSync) return
    if (!pendingComponentSync) {
      pendingComponentSync = new Set()
      queueMicrotask(flushComponentSync)
    }
    pendingComponentSync.add(nodeId)
  }

  return { scheduleComponentSync }
}
