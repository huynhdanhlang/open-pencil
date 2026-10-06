import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/** Creation ownership is local to this invocation, never a listener spanning an await. */
export class RenderCreationJournal {
  private readonly created = new Set<string>()
  private readonly layoutChanges = new Map<
    string,
    {
      node: SceneNode
      values: Partial<SceneNode>
      absent: Set<keyof SceneNode>
      editedFields?: string[]
    }
  >()

  constructor(private readonly graph: SceneGraph) {}

  capture(create: () => SceneNode): SceneNode {
    return this.graph.observeNodeMutationsDuring(
      () => {
        const node = create()
        this.recordTree(node.id)
        return node
      },
      { created: (node) => this.created.add(node.id) }
    )
  }

  layout(run: () => void): void {
    this.recordUpdates(run, false)
  }

  /** Record bounded semantic completion, including its source-marker side effects. */
  semantic(run: () => void): void {
    this.recordUpdates(run, true)
  }

  private recordUpdates(run: () => void, semantic: boolean): void {
    this.graph.observeNodeMutationsDuring(run, {
      updated: (node, changes, absent) => {
        if (this.created.has(node.id)) return
        let saved = this.layoutChanges.get(node.id)
        if (!saved) {
          saved = { node, values: {}, absent: new Set() }
          this.layoutChanges.set(node.id, saved)
        }
        if (semantic && !saved.editedFields) saved.editedFields = [...node.source.editedFields]
        const keys = new Set([...(Object.keys(changes) as (keyof SceneNode)[]), ...absent])
        for (const key of keys) {
          if (Object.hasOwn(saved.values, key) || saved.absent.has(key)) continue
          if (Object.hasOwn(node, key)) Reflect.set(saved.values, key, structuredClone(node[key]))
          else saved.absent.add(key)
        }
      }
    })
  }

  private recordTree(id: string): void {
    const node = this.graph.getNode(id)
    if (!node) return
    this.created.add(id)
    for (const childId of node.childIds) this.recordTree(childId)
  }

  rollback(error: unknown): never {
    const retained: string[] = []
    const failures: unknown[] = []
    for (const id of [...this.created].reverse()) {
      const node = this.graph.getNode(id)
      if (!node) continue
      // A user or another render may attach content while this invocation awaits artwork.
      // Deletion is recursive, so preserve that content and its containing owned ancestors.
      if (node.childIds.some((childId) => this.graph.getNode(childId))) {
        retained.push(id)
        continue
      }
      try {
        this.graph.deleteNode(id)
      } catch (failure) {
        failures.push(failure)
      }
    }
    this.graph.withLayoutMutations(() => {
      for (const [id, saved] of this.layoutChanges) {
        const node = this.graph.getNode(id)
        if (!node) continue
        if (node !== saved.node) {
          retained.push(id)
          continue
        }
        try {
          this.graph.restoreNodeProperties(id, saved.values, [...saved.absent])
        } catch (failure) {
          failures.push(failure)
        } finally {
          if (saved.editedFields) node.source.editedFields = saved.editedFields
        }
      }
    })
    if (retained.length) {
      throw new AggregateError(
        [error, ...failures],
        `Render rollback conflict: preserved nodes ${retained.join(', ')}`
      )
    }
    if (failures.length)
      throw new AggregateError([error, ...failures], 'Render rollback cleanup failed')
    throw error
  }
}
