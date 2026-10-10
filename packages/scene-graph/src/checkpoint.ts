import { isEqual } from 'es-toolkit'

import type { SceneGraph } from './index'
import type { SceneNode } from './types'

/** Replay page history; caller equality is read-only and only used before graph mutation. */
export function restorePageCheckpoint(
  graph: SceneGraph,
  snapshot: ReadonlyMap<string, SceneNode>,
  dependentRoots: ReadonlyMap<string, { parentId: string; index: number }> = new Map(),
  areNodesEqual: (live: SceneNode | undefined, saved: SceneNode) => boolean = isEqual
) {
  const page = snapshot.values().next().value
  const livePage = page && graph.nodes.get(page.id)
  if (!page || !livePage) return new Set<string>()
  if (page.type !== 'CANVAS' || livePage.type !== 'CANVAS' || page.parentId !== livePage.parentId)
    throw new Error('Page history must preserve its canvas root')
  const targetIds = new Set<string>()
  const visit = (id: string, parentId: string | null) => {
    const node = snapshot.get(id)
    if (
      !node ||
      id === graph.rootId ||
      node.id !== id ||
      targetIds.has(id) ||
      node.parentId !== parentId
    )
      throw new Error('Invalid page history hierarchy')
    targetIds.add(id)
    for (const childId of node.childIds) visit(childId, id)
  }
  visit(page.id, page.parentId)
  for (const [id, root] of dependentRoots) {
    const node = snapshot.get(id)
    if (!node) continue
    if (
      node.type === 'CANVAS' ||
      id === graph.rootId ||
      node.parentId !== root.parentId ||
      (!graph.nodes.has(root.parentId) && !snapshot.has(root.parentId))
    )
      throw new Error('Invalid dependent history root')
    if (targetIds.has(id) || snapshot.has(root.parentId)) continue
    visit(id, root.parentId)
  }
  if (targetIds.size !== snapshot.size) throw new Error('Disconnected page history nodes')

  const current = new Map<string, SceneNode>()
  const walk = (id: string) => {
    const node = graph.nodes.get(id)
    if (!node || current.has(id)) return
    current.set(id, node)
    for (const childId of node.childIds) walk(childId)
  }
  walk(page.id)
  for (const id of dependentRoots.keys()) walk(id)
  const removed = [...current.values()].filter((node) => !snapshot.has(node.id))
  const changed = [...snapshot.values()].filter(
    (node) => !areNodesEqual(graph.nodes.get(node.id), node)
  )
  // Clone before changing the graph; one batch preserves shared imported payloads.
  const copies = structuredClone(changed)
  const updates: Array<{ node: SceneNode; changes: Partial<SceneNode>; created: boolean }> = []
  const externalParents = new Set<SceneNode>()
  const moved: Array<{ id: string; oldParentId: string | null; newParentId: string }> = []
  const removeIndex = (node: SceneNode) => {
    if (node.type === 'INSTANCE' && node.componentId)
      graph.instanceIndex.get(node.componentId)?.delete(node.id)
  }
  graph.withBufferedEvents(() =>
    graph.preserveSourceMetadataDuring(() => {
      for (const node of removed) {
        removeIndex(node)
        if (node.parentId && !current.has(node.parentId)) {
          const parent = graph.nodes.get(node.parentId)
          if (parent) {
            parent.childIds = parent.childIds.filter((id) => id !== node.id)
            externalParents.add(parent)
          }
        }
        // Delete membership only: retained descendants may move out of a removed ancestor.
        graph.nodes.delete(node.id)
      }
      for (const saved of copies) {
        const live = graph.nodes.get(saved.id)
        const changes: Partial<SceneNode> = { ...saved }
        if (live) {
          removeIndex(live)
          if (saved.parentId && live.parentId !== saved.parentId)
            moved.push({ id: live.id, oldParentId: live.parentId, newParentId: saved.parentId })
          if (live.parentId && live.parentId !== saved.parentId && !snapshot.has(live.parentId)) {
            const parent = graph.nodes.get(live.parentId)
            if (parent) {
              parent.childIds = parent.childIds.filter((id) => id !== live.id)
              externalParents.add(parent)
            }
          }
          for (const key of Object.keys(live) as (keyof SceneNode)[]) {
            if (!Object.hasOwn(saved, key)) {
              Reflect.deleteProperty(live, key)
              Reflect.set(changes, key, undefined)
            }
          }
          Object.assign(live, saved)
        } else graph.nodes.set(saved.id, saved)
        const node = live ?? saved
        if (node.type === 'INSTANCE' && node.componentId) {
          let ids = graph.instanceIndex.get(node.componentId)
          if (!ids) graph.instanceIndex.set(node.componentId, (ids = new Set()))
          ids.add(node.id)
        }
        updates.push({ node, changes, created: !live })
      }
      for (const [id, root] of dependentRoots) {
        const node = graph.nodes.get(id)
        const saved = snapshot.get(id)
        if (!saved || !node || (saved.parentId && targetIds.has(saved.parentId))) continue
        const parent = graph.nodes.get(root.parentId)
        if (parent && !parent.childIds.includes(id)) {
          graph.insertChildAt(id, parent.id, root.index)
          externalParents.add(parent)
        }
      }
      graph.clearAbsPosCache()
      // Consumers observe complete parent links, exact sibling arrays and component indexes.
      for (const node of removed) graph.emitter.emit('node:deleted', node.id, node.parentId)
      for (const parent of externalParents)
        graph.emitter.emit('node:updated', parent.id, { childIds: parent.childIds })
      for (const { node, changes, created } of updates) {
        if (created) graph.emitter.emit('node:created', node)
        else graph.emitter.emit('node:updated', node.id, changes)
      }
      for (const { id, oldParentId, newParentId } of moved)
        graph.emitter.emit('node:reparented', id, oldParentId, newParentId)
    })
  )
  const layoutPages = new Set([page.id])
  for (const id of dependentRoots.keys()) {
    const ancestor = graph.closest(id, (node) => node.type === 'CANVAS')
    if (ancestor) layoutPages.add(ancestor.id)
  }
  for (const parent of externalParents) {
    const ancestor = graph.closest(parent.id, (node) => node.type === 'CANVAS')
    if (ancestor) layoutPages.add(ancestor.id)
  }
  return layoutPages
}

/** Capture rollback state without changing graph or surviving object identities. */
export function captureGraphCheckpoint(graph: SceneGraph) {
  const nodeRefs = new Map(graph.nodes)
  const variableRefs = new Map(graph.variables)
  const collectionRefs = new Map(graph.variableCollections)
  const snapshot = structuredClone({
    nodes: graph.nodes,
    variables: graph.variables,
    variableCollections: graph.variableCollections,
    activeMode: graph.activeMode,
    instanceIndex: graph.instanceIndex,
    enabledLibraries: graph.enabledLibraries,
    rootId: graph.rootId,
    figKiwiVersion: graph.figKiwiVersion,
    figSchemaDeflated: graph.figSchemaDeflated,
    documentColorSpace: graph.documentColorSpace
  })
  // Atomic property tools cannot edit assets. Retain existing buffers, not copies of every bitmap.
  const images = new Map(graph.images)

  function assertPropertiesOnly() {
    if (
      snapshot.nodes.size !== graph.nodes.size ||
      snapshot.variables.size !== graph.variables.size
    )
      throw new Error('Atomic tools must not create or remove nodes or variables')
    for (const [id, before] of snapshot.nodes) {
      const after = graph.nodes.get(id)
      if (
        !after ||
        after !== nodeRefs.get(id) ||
        before.id !== after.id ||
        before.type !== after.type ||
        before.parentId !== after.parentId ||
        before.componentId !== after.componentId ||
        !isEqual(before.childIds, after.childIds)
      ) {
        throw new Error('Atomic tools must not change node hierarchy or identity')
      }
    }
    for (const [id, before] of snapshot.variables) {
      const after = graph.variables.get(id)
      if (
        !after ||
        after !== variableRefs.get(id) ||
        before.id !== after.id ||
        before.collectionId !== after.collectionId ||
        before.type !== after.type
      )
        throw new Error('Atomic tools must not change variable identity')
    }
    assertDocumentUnchanged()
  }

  function assertDocumentUnchanged() {
    if (
      !isEqual(snapshot.variableCollections, graph.variableCollections) ||
      !isEqual(snapshot.activeMode, graph.activeMode) ||
      !isEqual(snapshot.instanceIndex, graph.instanceIndex) ||
      !isEqual(snapshot.enabledLibraries, graph.enabledLibraries) ||
      images.size !== graph.images.size ||
      [...images].some(([id, bytes]) => graph.images.get(id) !== bytes) ||
      graph.rootId !== snapshot.rootId ||
      graph.documentColorSpace !== snapshot.documentColorSpace ||
      graph.figKiwiVersion !== snapshot.figKiwiVersion ||
      !isEqual(graph.figSchemaDeflated, snapshot.figSchemaDeflated)
    ) {
      throw new Error('Atomic tools must not change collections, assets or document metadata')
    }
  }

  function restore() {
    const failedNodes = new Map(graph.nodes)
    restoreObjects(graph.nodes, snapshot.nodes, nodeRefs)
    restoreObjects(graph.variables, snapshot.variables, variableRefs)
    restoreObjects(graph.variableCollections, snapshot.variableCollections, collectionRefs)
    restoreMap(graph.activeMode, structuredClone(snapshot.activeMode))
    restoreMap(graph.instanceIndex, structuredClone(snapshot.instanceIndex))
    restoreMap(graph.enabledLibraries, structuredClone(snapshot.enabledLibraries))
    restoreMap(graph.images, images)
    graph.rootId = snapshot.rootId
    graph.figKiwiVersion = snapshot.figKiwiVersion
    graph.figSchemaDeflated = structuredClone(snapshot.figSchemaDeflated)
    graph.documentColorSpace = snapshot.documentColorSpace
    graph.clearAbsPosCache()
    // Notify consumers only after the complete hierarchy and indexes have been restored.
    for (const [id, node] of failedNodes) {
      if (!graph.nodes.has(id)) graph.emitter.emit('node:deleted', id, node.parentId)
    }
    for (const [id, node] of graph.nodes) {
      if (failedNodes.has(id)) graph.emitter.emit('node:updated', id, node)
      else graph.emitter.emit('node:created', node)
    }
  }

  return { nodes: snapshot.nodes, variables: snapshot.variables, assertPropertiesOnly, restore }
}

function restoreObjects<T extends object>(
  target: Map<string, T>,
  snapshot: Map<string, T>,
  refs: Map<string, T>
) {
  target.clear()
  for (const [id, saved] of snapshot) {
    const original = refs.get(id)
    if (!original) throw new Error(`Missing checkpoint reference: ${id}`)
    for (const key of Object.keys(original) as (keyof T)[]) {
      if (!(key in saved)) Reflect.deleteProperty(original, key)
    }
    Object.assign(original, structuredClone(saved))
    target.set(id, original)
  }
}

function restoreMap<K, V>(target: Map<K, V>, saved: Map<K, V>) {
  target.clear()
  for (const [key, value] of saved) target.set(key, value)
}
