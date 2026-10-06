import type { ComponentPropertyDefinition, SceneNode } from '@open-pencil/scene-graph'
import { CommittedGraphEventError } from '@open-pencil/scene-graph'
import { buildVariantName } from '@open-pencil/scene-graph/variant-name'
import { reconcileVariantDefinitions } from '@open-pencil/scene-graph/variant-properties'

import { assertNodeEditable } from '#core/editor/capabilities'
import type { EditorContext } from '#core/editor/types'

import { getComponentSet, getComponentSetVariants, getVariantDefinitions } from './model'

/** A component set's property definitions and its variants' values and names, for undo. */
export type VariantSnapshot = {
  definitions: ComponentPropertyDefinition[]
  variants: Map<string, Pick<SceneNode, 'componentPropertyValues' | 'name'>>
}

export function assertComponentSetEditable(ctx: EditorContext, componentSetId: string): void {
  assertNodeEditable(ctx.graph, componentSetId)
  for (const variant of getComponentSetVariants(ctx.graph, componentSetId)) {
    assertNodeEditable(ctx.graph, variant.id)
  }
}

export function captureVariantSnapshot(
  ctx: EditorContext,
  componentSetId: string
): VariantSnapshot | null {
  const componentSet = getComponentSet(ctx.graph, componentSetId)
  if (!componentSet) return null
  return {
    definitions: structuredClone(componentSet.componentPropertyDefinitions),
    variants: new Map(
      getComponentSetVariants(ctx.graph, componentSetId).map((variant) => [
        variant.id,
        {
          componentPropertyValues: structuredClone(variant.componentPropertyValues),
          name: variant.name
        }
      ])
    )
  }
}

export function restoreVariantSnapshot(
  ctx: EditorContext,
  componentSetId: string,
  snapshot: VariantSnapshot,
  options: { requestRender?: boolean } = {}
): void {
  const componentSet = getComponentSet(ctx.graph, componentSetId)
  if (!componentSet) return
  const prepared = structuredClone(snapshot)
  ctx.graph.withBufferedEvents(() => {
    ctx.graph.updateNode(componentSetId, {
      componentPropertyDefinitions: prepared.definitions
    })
    for (const [variantId, variantSnapshot] of prepared.variants) {
      if (!ctx.graph.getNode(variantId)) continue
      ctx.graph.updateNode(variantId, variantSnapshot)
    }
  })
  if (options.requestRender !== false) requestVariantRender(ctx)
}

/** Call only after the whole semantic mutation/replay has committed. */
export function requestVariantRender(ctx: EditorContext): void {
  try {
    ctx.requestRender()
  } catch (error) {
    throw new CommittedGraphEventError([error])
  }
}

export function recordSnapshotChange(
  ctx: EditorContext,
  componentSetId: string,
  label: string,
  before: VariantSnapshot,
  after: VariantSnapshot
): void {
  ctx.undo.push({
    label,
    forward: () => restoreVariantSnapshot(ctx, componentSetId, after),
    inverse: () => restoreVariantSnapshot(ctx, componentSetId, before)
  })
  requestVariantRender(ctx)
}

/** Restore a failed native name edit through the existing bounded variant snapshot owner. */
export function applyVariantRename(
  ctx: EditorContext,
  snapshots: ReadonlyMap<string, VariantSnapshot>,
  names: ReadonlyMap<string, string>,
  apply: () => void
): void {
  if (snapshots.size === 0) return apply()
  const ids = new Set(names.keys())
  for (const [id, snapshot] of snapshots) {
    ids.add(id)
    for (const variantId of snapshot.variants.keys()) ids.add(variantId)
  }
  const markers = new Map(
    [...ids].flatMap((id) => {
      const node = ctx.graph.getNode(id)
      return node ? [[id, [...node.source.editedFields]] as const] : []
    })
  )
  try {
    apply()
  } catch (error) {
    const failures: unknown[] = []
    ctx.graph.preserveSourceMetadataDuring(() => {
      for (const [id, name] of names) {
        try {
          ctx.graph.updateNode(id, { name })
        } catch (failure) {
          failures.push(failure)
        }
      }
      for (const [id, snapshot] of snapshots) {
        try {
          ctx.graph.withBufferedEvents(() => restoreVariantSnapshot(ctx, id, snapshot))
        } catch (failure) {
          failures.push(failure)
        }
      }
    })
    for (const [id, editedFields] of markers) {
      const node = ctx.graph.getNode(id)
      if (node) node.source.editedFields = [...editedFields]
    }
    if (failures.length)
      throw new AggregateError([error, ...failures], 'Variant rename rollback delivery failed')
    throw error
  }
}

export function updateVariantName(
  ctx: EditorContext,
  componentSetId: string,
  variant: SceneNode
): void {
  const values = Object.fromEntries(
    getVariantDefinitions(ctx.graph, componentSetId).map((definition) => [
      definition.name,
      variant.componentPropertyValues[definition.name] ?? ''
    ])
  )
  ctx.graph.updateNode(variant.id, { name: buildVariantName(values) })
}

export function refreshVariantOptions(ctx: EditorContext, componentSetId: string): void {
  const componentSet = getComponentSet(ctx.graph, componentSetId)
  if (!componentSet) return
  const definitions = reconcileVariantDefinitions(
    componentSet.componentPropertyDefinitions,
    getComponentSetVariants(ctx.graph, componentSetId).map(
      (variant) => variant.componentPropertyValues
    )
  )
  ctx.graph.updateNode(componentSetId, {
    componentPropertyDefinitions: definitions
  })
}

/** Set a variant's property values and rename it to match. */
export function setVariantValues(
  ctx: EditorContext,
  componentSetId: string,
  variantId: string,
  componentPropertyValues: Record<string, string>
): void {
  ctx.graph.updateNode(variantId, { componentPropertyValues })
  const updated = ctx.graph.getNode(variantId)
  if (updated) updateVariantName(ctx, componentSetId, updated)
}
