import { uniq } from 'es-toolkit/array'
import { isEqual } from 'es-toolkit/predicate'

import type { SceneGraph } from './index'
import type { ComponentPropertyDefinition, SceneNode } from './types'
import { buildVariantName, parseVariantName } from './variant-name'

/** Refresh an existing definition's choices without replacing its identity or metadata. */
export function reconcileVariantDefinitions(
  definitions: readonly ComponentPropertyDefinition[],
  values: readonly Record<string, string>[]
): ComponentPropertyDefinition[] {
  return definitions.map((definition) => {
    if (definition.type !== 'VARIANT') return definition
    const present = new Set(
      values
        .map((variant) => variant[definition.name])
        .filter((value) => typeof value === 'string' && value.length > 0)
    )
    const options = [
      ...(definition.variantOptions ?? []).filter((value) => present.has(value)),
      ...[...present].filter((value) => !definition.variantOptions?.includes(value))
    ]
    return {
      ...definition,
      defaultValue: options.includes(definition.defaultValue)
        ? definition.defaultValue
        : (options[0] ?? ''),
      variantOptions: options
    }
  })
}

/** Explicit authoring completion; import, layout and graph replay never call this owner. */
export function refreshComponentSetVariants(
  graph: SceneGraph,
  setId: string,
  createPropertyId?: () => string,
  authoredIds?: readonly string[]
): void {
  const set = graph.getNode(setId)
  if (set?.type !== 'COMPONENT_SET') return
  const variants = graph.getChildren(setId).filter((node) => node.type === 'COMPONENT')
  if (
    variants.length === 0 ||
    (authoredIds && !variants.some((node) => authoredIds.includes(node.id)))
  )
    return
  const definitions = [...set.componentPropertyDefinitions]
  const names = new Set(
    definitions.filter((item) => item.type === 'VARIANT').map((item) => item.name)
  )
  const parsed = variants.map((variant) => parseVariantName(variant.name))
  const authored = authoredIds ? new Set(authoredIds) : new Set(variants.map((node) => node.id))
  if (createPropertyId) {
    for (const [index, values] of parsed.entries()) {
      if (!authored.has(variants[index].id)) continue
      for (const name of Object.keys(values)) {
        if (!name || !values[name].trim() || names.has(name)) continue
        names.add(name)
        definitions.push({
          id: createPropertyId(),
          name,
          type: 'VARIANT',
          defaultValue: values[name]
        })
      }
    }
  }
  const values = variants.map((variant, index) =>
    authored.has(variant.id)
      ? {
          ...variant.componentPropertyValues,
          ...Object.fromEntries(
            Object.entries(parsed[index]).filter(
              ([name, value]) => names.has(name) && value.trim().length > 0
            )
          )
        }
      : variant.componentPropertyValues
  )
  for (const [index, variant] of variants.entries()) {
    if (!isEqual(variant.componentPropertyValues, values[index]))
      graph.updateNode(variant.id, { componentPropertyValues: values[index] })
  }
  const refreshed = reconcileVariantDefinitions(definitions, values)
  if (!isEqual(set.componentPropertyDefinitions, refreshed))
    graph.updateNode(setId, { componentPropertyDefinitions: refreshed })
}

/** A label rename only changes semantics when it names a known variant dimension. */
export function refreshRenamedVariant(graph: SceneGraph, nodeId: string): void {
  const node = graph.getNode(nodeId)
  if (node?.type !== 'COMPONENT' || !node.parentId) return
  const parent = graph.getNode(node.parentId)
  if (parent?.type !== 'COMPONENT_SET') return
  const parsed = parseVariantName(node.name)
  if (
    !parent.componentPropertyDefinitions.some(
      (item) =>
        item.type === 'VARIANT' &&
        Object.hasOwn(parsed, item.name) &&
        parsed[item.name].trim().length > 0
    )
  )
    return
  refreshComponentSetVariants(graph, parent.id, undefined, [node.id])
}

export interface DerivedVariantProperties {
  definitions: ComponentPropertyDefinition[]
  variants: Map<string, Pick<SceneNode, 'componentPropertyValues' | 'name'>>
}

export function deriveSlashVariantProperties(
  components: ReadonlyArray<Pick<SceneNode, 'id' | 'name'>>,
  createPropertyId: () => string
): DerivedVariantProperties | null {
  const slashCounts = components.map((component) => (component.name.match(/\//g) ?? []).length)
  const slashCount = slashCounts[0] ?? 0
  if (slashCount === 0 || !slashCounts.every((count) => count === slashCount)) return null

  const definitions: ComponentPropertyDefinition[] = Array.from(
    { length: slashCount },
    (_, index) => ({
      id: createPropertyId(),
      name: index === 0 ? 'Variant' : `Property ${index + 1}`,
      type: 'VARIANT',
      defaultValue: ''
    })
  )
  const options = new Map(definitions.map((definition) => [definition.name, new Set<string>()]))
  const variants = new Map<string, Pick<SceneNode, 'componentPropertyValues' | 'name'>>()

  for (const component of components) {
    const parts = component.name.split('/').slice(1)
    const componentPropertyValues: Record<string, string> = {}
    for (const [index, definition] of definitions.entries()) {
      const value = parts[index]?.trim() ?? ''
      componentPropertyValues[definition.name] = value
      options.get(definition.name)?.add(value)
    }
    variants.set(component.id, {
      componentPropertyValues,
      name: Object.values(componentPropertyValues).join(', ')
    })
  }

  for (const definition of definitions) {
    definition.variantOptions = [...(options.get(definition.name) ?? [])]
    definition.defaultValue = definition.variantOptions[0] ?? ''
  }

  return { definitions, variants }
}

/**
 * Variant properties from names written as `Property=Value` pairs, as Figma names variants:
 * `State=On, Size=Large` gives State and Size. Every component must name at least one pair;
 * a property a component leaves out takes an empty value.
 */
export function deriveNamedVariantProperties(
  components: ReadonlyArray<Pick<SceneNode, 'id' | 'name'>>,
  createPropertyId: () => string
): DerivedVariantProperties | null {
  const parsed = components.map((component) => parseVariantName(component.name))
  if (parsed.some((values) => Object.keys(values).length === 0)) return null
  const names = uniq(parsed.flatMap((values) => Object.keys(values)))
  const definitions: ComponentPropertyDefinition[] = names.map((name) => {
    const options = uniq(parsed.map((values) => values[name] ?? ''))
    return {
      id: createPropertyId(),
      name,
      type: 'VARIANT',
      defaultValue: options[0] ?? '',
      variantOptions: options
    }
  })
  const variants = new Map(
    components.map((component, index) => {
      const componentPropertyValues = Object.fromEntries(
        names.map((name) => [name, parsed[index][name] ?? ''])
      )
      return [
        component.id,
        { componentPropertyValues, name: buildVariantName(componentPropertyValues) }
      ]
    })
  )
  return { definitions, variants }
}

/** Variant properties from component names: slash paths first, else `Property=Value` pairs. */
export function deriveVariantProperties(
  components: ReadonlyArray<Pick<SceneNode, 'id' | 'name'>>,
  createPropertyId: () => string
): DerivedVariantProperties | null {
  return (
    deriveSlashVariantProperties(components, createPropertyId) ??
    deriveNamedVariantProperties(components, createPropertyId)
  )
}
