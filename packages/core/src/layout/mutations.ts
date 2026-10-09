import {
  collectSceneMutation,
  mutationLayoutScopeIds,
  type SceneGraph,
  type SceneMutationImpact
} from '@open-pencil/scene-graph'

import { computeAllLayouts, computeLayout } from '#core/layout'

export function createLayoutRunner(getGraph: () => SceneGraph) {
  function runLayoutForNode(id: string) {
    const graph = getGraph()
    const node = graph.getNode(id)
    if (!node) return

    computeAllLayouts(graph, id)
    // Initial import keeps baked instance geometry. An explicit size edit must
    // reflow that instance's auto-layout instead of retaining the imported box.
    if (
      node.type === 'INSTANCE' &&
      node.source.format === 'fig' &&
      node.layoutMode !== 'NONE' &&
      node.source.editedFields.some((field) => field === 'width' || field === 'height')
    )
      computeLayout(graph, id)

    let parent = node.parentId ? graph.getNode(node.parentId) : undefined
    while (parent) {
      if (parent.layoutMode !== 'NONE') {
        computeLayout(graph, parent.id)
      }
      parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
    }
  }

  function compactLayoutScope(impact: SceneMutationImpact): string[] {
    const graph = getGraph()
    // A free page only owns root ordering; it cannot resize or position its children.
    // Keeping it in the candidates masks every actual changed subtree below it.
    const candidates = new Set(
      mutationLayoutScopeIds(impact).filter((id) => {
        const node = graph.getNode(id)
        return node && !(node.type === 'CANVAS' && node.layoutMode === 'NONE')
      })
    )
    return [...candidates].filter((id) => {
      let parentId = graph.getNode(id)?.parentId ?? null
      while (parentId) {
        if (candidates.has(parentId)) return false
        parentId = graph.getNode(parentId)?.parentId ?? null
      }
      return true
    })
  }

  async function runMutationWithLayout<T>(
    operation: () => T | Promise<T>,
    fallbackId?: string,
    beforeLayout?: (result: T, impact: SceneMutationImpact) => Promise<void> | void
  ): Promise<T> {
    const graph = getGraph()
    const { result, impact } = await collectSceneMutation(graph, operation)
    await beforeLayout?.(result, impact)
    if (!runLayoutForImpact(impact) && fallbackId) computeAllLayouts(graph, fallbackId)
    return result
  }

  /** Lays out what an edit touched; returns whether there was anything to lay out. */
  function runLayoutForImpact(impact: SceneMutationImpact): boolean {
    const scopeIds = compactLayoutScope(impact)
    for (const id of scopeIds) runLayoutForNode(id)
    // Deleting the last root only touches the surviving free page: handled, no reflow.
    return (
      scopeIds.length > 0 ||
      mutationLayoutScopeIds(impact).some((id) => {
        const node = getGraph().getNode(id)
        return node?.type === 'CANVAS' && node.layoutMode === 'NONE'
      })
    )
  }

  return { runLayoutForNode, runLayoutForImpact, runMutationWithLayout }
}
