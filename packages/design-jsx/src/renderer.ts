import {
  createComponentPropertyId,
  setInstanceOverride,
  type NodeType,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'
import { tryParseColor } from '@open-pencil/scene-graph/color'
import { refreshComponentSetVariants } from '@open-pencil/scene-graph/variant-properties'

import type { RekaScope } from './behaviours'
import { renderRekaNode } from './behaviours/render'
import {
  assignComponentProperties,
  componentMetadata,
  assignNamedProperties,
  componentPropertyScope
} from './component-properties'
import { colorSchema, solid } from './paints'
import { effectivePropSource, propsToOverrides } from './props-overrides'
import { renderArtworkNode } from './render-artwork'
import { RenderCreationJournal } from './render-creation'
import { prepareScalarBindings } from './scalar-bindings'
import { DESIGN_JSX_STYLE_KEYS } from './schema'
import type { DesignJSXServices } from './services'
import { FRAGMENT, isTreeNode } from './tree'
import type { TreeNode } from './tree'
import type { RenderOptions } from './types'
import { parseScriptInput } from './validation'
import { isVariable, resolveVariableId, variableFallback } from './vars'

const TYPE_MAP: Partial<Record<string, NodeType>> = {
  frame: 'FRAME',
  view: 'FRAME',
  rectangle: 'RECTANGLE',
  rect: 'RECTANGLE',
  ellipse: 'ELLIPSE',
  text: 'TEXT',
  line: 'LINE',
  star: 'STAR',
  polygon: 'POLYGON',
  vector: 'VECTOR',
  group: 'GROUP',
  section: 'SECTION',
  component: 'COMPONENT',
  'component-set': 'COMPONENT_SET',
  componentset: 'COMPONENT_SET',
  div: 'FRAME',
  main: 'FRAME',
  header: 'FRAME',
  footer: 'FRAME',
  nav: 'FRAME',
  article: 'FRAME',
  aside: 'FRAME',
  span: 'TEXT',
  p: 'TEXT',
  h1: 'TEXT',
  h2: 'TEXT',
  h3: 'TEXT',
  h4: 'TEXT',
  h5: 'TEXT',
  h6: 'TEXT'
}

export interface RenderResult {
  id: string
  name: string
  type: NodeType
  childIds: string[]
  warnings?: string[]
}

/** The nodes a tree renders as: a fragment's children, or the tree itself. */
function treeRoots(tree: TreeNode): TreeNode[] {
  return tree.type === FRAGMENT ? tree.children.filter(isTreeNode) : [tree]
}

/** Render every root of `tree` into the parent and lay out once. */
export async function renderRoots<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  options: RenderOptions = {}
): Promise<RenderResult[]> {
  const roots = treeRoots(tree)
  if (roots.length === 0) throw new Error('JSX must return a Figma element (Frame, Text, etc)')
  const parentId = options.parentId ?? graph.getPages()[0].id

  const journal = new RenderCreationJournal(graph)
  try {
    const nodes: SceneNode[] = []
    const position: Pick<RenderOptions, 'x' | 'y'> = {}
    if (options.x !== undefined) position.x = options.x
    if (options.y !== undefined) position.y = options.y
    for (const root of roots) {
      // Creation observers can clone component children before the async render completes.
      const node = await renderNode(
        services,
        graph,
        root,
        journal,
        parentId,
        options.onNode,
        undefined,
        position
      )
      if (options.x !== undefined) graph.updateNode(node.id, { x: options.x })
      if (options.y !== undefined) graph.updateNode(node.id, { y: options.y })
      nodes.push(node)
    }

    if (!options.deferLayout)
      journal.layout(() =>
        services.layout(
          graph,
          nodes.map((node) => node.id)
        )
      )
    journal.semantic(() =>
      refreshComponentSetVariants(
        graph,
        parentId,
        createComponentPropertyId,
        nodes.map((node) => node.id)
      )
    )

    return nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      childIds: node.childIds
    }))
  } catch (error) {
    return journal.rollback(error)
  }
}

/** Render `tree` and return its first root; a fragment's other roots are rendered too. */
export async function renderTree<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const [first] = await renderRoots(services, graph, tree, options)
  return first
}

interface PreparedProps {
  props: Record<string, unknown>
  bindings: Record<string, string>
  bindingSources: Record<string, string>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bindVariableProp(
  graph: SceneGraph,
  props: Record<string, unknown>,
  bindings: Record<string, string>,
  key: string,
  field: string
): void {
  const value = props[key]
  if (!isVariable(value)) return
  const variableId = resolveVariableId(graph, value)
  if (variableId) bindings[field] = variableId
  const fallback = variableFallback(graph, value)
  if (fallback !== undefined) props[key] = fallback
}

function bindStyleVariableProp(
  graph: SceneGraph,
  style: Record<string, unknown>,
  bindings: Record<string, string>,
  key: string,
  field: string
): void {
  const value = style[key]
  if (!isVariable(value)) return
  const variableId = resolveVariableId(graph, value)
  if (variableId) bindings[field] = variableId
  const fallback = variableFallback(graph, value)
  if (fallback !== undefined) style[key] = fallback
}

function preparePaintArray(
  graph: SceneGraph,
  props: Record<string, unknown>,
  bindings: Record<string, string>,
  key: 'fills' | 'strokes'
): void {
  const paints = props[key]
  if (!Array.isArray(paints)) return
  props[key] = paints.map((value, index) => {
    const field = `${key}/${index}/color`
    // Keep the shorthand array owner; structured paints require resolving their
    // nested color before cloning, which would otherwise strip variable branding.
    if (isVariable(value)) {
      const id = resolveVariableId(graph, value)
      if (id) bindings[field] = id
      return variableFallback(graph, value) ?? value
    }
    if (!isObjectRecord(value) || !(key === 'strokes' ? 'color' in value : 'type' in value))
      return value
    const token = isVariable(value.color) ? value.color : undefined
    let colorInput = value.color
    if (token) {
      const id = resolveVariableId(graph, token)
      if (
        !id ||
        graph.variables.get(id)?.type !== 'COLOR' ||
        (value.type !== 'SOLID' && !(key === 'strokes' && value.type === undefined))
      )
        throw new Error(`Expected a SOLID paint with a COLOR variable for ${field}: ${token.name}`)
      bindings[field] = id
      colorInput = variableFallback(graph, token)
    }
    if (typeof colorInput === 'string') {
      const color = tryParseColor(colorInput)
      if (!color) throw new Error(`Invalid ${field}: unrecognized color "${colorInput}"`)
      colorInput = color
    }
    const paint = solid(parseScriptInput(`Invalid ${field}`, colorSchema, colorInput))
    if (Object.values(paint.color).some((channel) => !Number.isFinite(channel)))
      throw new Error(`Invalid ${field}: color channels must be finite`)
    if (
      token &&
      value.opacity !== undefined &&
      (typeof value.opacity !== 'number' ||
        !Number.isFinite(value.opacity) ||
        Math.abs(value.opacity - paint.opacity) > 0.000001)
    )
      throw new Error(
        `${field}: variable alpha owns paint opacity. Use a separate background layer with node opacity for independent transparency.`
      )
    return {
      ...value,
      color: token ? { ...paint.color, a: 1 } : paint.color,
      opacity: value.opacity ?? (value.type && value.type !== 'SOLID' ? 1 : paint.opacity),
      visible: value.visible ?? true
    }
  })
}

function preparePropsForRender(
  graph: SceneGraph,
  source: Record<string, unknown>,
  isText: boolean,
  parentId: string
): PreparedProps {
  const props = { ...source }
  const bindings: Record<string, string> = {}
  const bindingSources: Record<string, string> = {}

  const textColorSource = isText ? effectivePropSource(props, 'color') : undefined
  const fillSource =
    textColorSource ?? (Array.isArray(props.fills) ? 'fills' : effectivePropSource(props, 'bg'))
  const strokeSource = Array.isArray(props.strokes)
    ? 'strokes'
    : effectivePropSource(props, 'stroke')
  if (fillSource === 'fills') preparePaintArray(graph, props, bindings, 'fills')
  else if (fillSource && fillSource !== 'style')
    bindVariableProp(graph, props, bindings, fillSource, 'fills/0/color')
  if (strokeSource === 'strokes') preparePaintArray(graph, props, bindings, 'strokes')
  else if (strokeSource && strokeSource !== 'style')
    bindVariableProp(graph, props, bindings, strokeSource, 'strokes/0/color')

  if (isObjectRecord(props.style)) {
    const style = { ...props.style }
    if (fillSource === 'style') {
      const name = textColorSource ? 'color' : 'bg'
      const key = DESIGN_JSX_STYLE_KEYS[name]?.find(({ key }) => style[key] !== undefined)?.key
      if (key) bindStyleVariableProp(graph, style, bindings, key, 'fills/0/color')
    }
    if (strokeSource === 'style') {
      const key = DESIGN_JSX_STYLE_KEYS.stroke?.find(({ key }) => style[key] !== undefined)?.key
      if (key) bindStyleVariableProp(graph, style, bindings, key, 'strokes/0/color')
    }
    props.style = style
  }

  prepareScalarBindings(graph, props, bindings, isText, parentId, bindingSources)

  // Bind only the same paint source that propsToOverrides consumes. Explicit bind
  // remains the final override below; unused aliases must not rebind a literal.
  if (fillSource) bindingSources.fills = fillSource
  else delete bindingSources.fills
  if (strokeSource) bindingSources.strokes = strokeSource
  else delete bindingSources.strokes
  const strokeWeightSource = Array.isArray(props.strokes)
    ? 'strokes'
    : (effectivePropSource(props, 'strokeWidth') ??
      (props.borderWidth !== undefined ? 'borderWidth' : undefined))
  if (strokeWeightSource) bindingSources.strokeWeight = strokeWeightSource

  if (isObjectRecord(props.bind)) {
    for (const [field, value] of Object.entries(props.bind)) {
      if (isVariable(value)) {
        const variableId = resolveVariableId(graph, value)
        if (variableId) bindings[field] = variableId
      } else if (typeof value === 'string') {
        bindings[field] = value
      }
    }
  }

  return { props, bindings, bindingSources }
}

function applyBindings(graph: SceneGraph, nodeId: string, bindings: Record<string, string>): void {
  for (const [field, variableId] of Object.entries(bindings)) {
    graph.bindVariable(nodeId, field, variableId)
  }
}

function findComponentByName(graph: SceneGraph, name: string): SceneNode | undefined {
  for (const node of graph.getAllNodes()) {
    if (node.type === 'COMPONENT' && node.name === name) return node
  }
  return undefined
}

function findVariantInSet(
  graph: SceneGraph,
  componentSet: SceneNode,
  props: Record<string, unknown>
) {
  const requested = Object.fromEntries(
    Object.entries(props)
      .filter(([key]) =>
        componentSet.componentPropertyDefinitions.some(
          (definition) => definition.type === 'VARIANT' && definition.name === key
        )
      )
      .map(([key, value]) => [key, String(value)])
  )
  const variants = graph.getChildren(componentSet.id).filter((node) => node.type === 'COMPONENT')
  return (
    variants.find((variant) =>
      Object.entries(requested).every(
        ([key, value]) => variant.componentPropertyValues[key] === value
      )
    ) ?? variants[0]
  )
}

/** The component or component set an element names by id or name. */
function namedComponent(graph: SceneGraph, props: Record<string, unknown>): SceneNode | undefined {
  const ref = props.component ?? props.componentId ?? props.of
  if (typeof ref !== 'string') return undefined

  const byId = graph.getNode(ref)
  if (byId?.type === 'COMPONENT' || byId?.type === 'COMPONENT_SET') return byId

  const byName = findComponentByName(graph, ref)
  if (byName) return byName

  for (const node of graph.getAllNodes()) {
    if (node.type === 'COMPONENT_SET' && node.name === ref) return node
  }
  return undefined
}

function resolveComponent(
  graph: SceneGraph,
  props: Record<string, unknown>
): SceneNode | undefined {
  const named = namedComponent(graph, props)
  return named?.type === 'COMPONENT_SET' ? findVariantInSet(graph, named, props) : named
}

/** The component properties an element sets by name, such as `State` or `Title`. */
export function componentPropNames(graph: SceneGraph, props: Record<string, unknown>): string[] {
  const component = resolveComponent(graph, props)
  if (!component) return []
  return (componentPropertyScope(graph, component.id) ?? []).map((definition) => definition.name)
}

async function renderInstanceNode(
  graph: SceneGraph,
  tree: TreeNode,
  journal: RenderCreationJournal,
  parentId: string,
  position: Pick<RenderOptions, 'x' | 'y'> = {}
): Promise<SceneNode> {
  const parent = graph.getNode(parentId)
  const parentLayout = parent?.layoutMode ?? 'NONE'
  const { props, bindings } = preparePropsForRender(graph, tree.props, false, parentId)
  const component = resolveComponent(graph, props)
  if (!component) {
    const ref = props.component ?? props.componentId ?? props.of
    const label = typeof ref === 'string' || typeof ref === 'number' ? String(ref) : ''
    throw new Error(`<Instance> component not found: ${label}`)
  }
  const overrides: Partial<SceneNode> = {
    ...propsToOverrides(props, false, parentLayout),
    ...componentMetadata(props, 'INSTANCE', componentPropertyScope(graph, parentId)),
    ...position
  }
  // Instances inherit their container layout, but explicitly authored dimensions
  // must also replace the inherited sizing mode on that axis.
  const layout = overrides.layoutMode ?? component.layoutMode
  if (layout !== 'NONE') {
    const axes =
      layout === 'HORIZONTAL'
        ? (['primaryAxisSizing', 'counterAxisSizing'] as const)
        : (['counterAxisSizing', 'primaryAxisSizing'] as const)
    for (const [dimension, field] of [
      ['w', axes[0]],
      ['h', axes[1]]
    ] as const) {
      const value = props[dimension]
      if (typeof value === 'number') overrides[field] = 'FIXED'
      else if (value === 'hug' || value === 'fill') overrides[field] = 'HUG'
    }
  }
  const instance = journal.capture(
    () =>
      graph.createInstance(component.id, parentId, overrides) ?? graph.createNode('FRAME', parentId)
  )
  try {
    for (const [field, value] of Object.entries(overrides)) {
      setInstanceOverride(instance.instanceOverrides, instance.id, instance.id, field, value)
    }
    graph.updateNode(instance.id, { instanceOverrides: instance.instanceOverrides })
    applyBindings(graph, instance.id, bindings)
    applyInstanceOverrides(graph, instance, tree.props.overrides)
    assignNamedProperties(graph, instance, props)
    assignComponentProperties(graph, instance, props.properties)
    return instance
  } catch (error) {
    graph.deleteNode(instance.id)
    throw error
  }
}

/**
 * Apply child overrides to a freshly created instance. Keys are
 * `childName:prop` (e.g. 'label:text', 'icon:fills'); the child is resolved by
 * name among the instance's descendants, and the value is applied to both the
 * child node and the instance's overrides record so component sync keeps it.
 */
function applyInstanceOverrides(
  graph: SceneGraph,
  instance: SceneNode,
  overridesProp: unknown
): void {
  if (!overridesProp || typeof overridesProp !== 'object') return
  if (Array.isArray(overridesProp)) return
  const entries = Object.entries(overridesProp)
  if (entries.length === 0) return

  const descendants: SceneNode[] = []
  const walk = (id: string) => {
    const node = graph.getNode(id)
    if (!node) return
    descendants.push(node)
    for (const cid of node.childIds) walk(cid)
  }
  walk(instance.id)

  let mutated = false
  for (const [key, value] of entries) {
    const sep = key.indexOf(':')
    if (sep === -1) continue
    const childName = key.slice(0, sep)
    const prop = key.slice(sep + 1)
    const child = descendants.find((n) => n.name === childName)
    if (!child || !(prop in child)) continue
    graph.updateNode(child.id, { [prop]: value } as Partial<SceneNode>)
    setInstanceOverride(instance.instanceOverrides, instance.id, child.id, prop, value)
    mutated = true
  }
  if (mutated) {
    graph.updateNode(instance.id, { instanceOverrides: instance.instanceOverrides })
  }
}

export interface ElementOverrides {
  overrides: Partial<SceneNode>
  /** Variable IDs by bound field, such as `fills/0/color`. */
  bindings: Record<string, string>
  /** Effective prop owner for each bindable field, before explicit bind precedence. */
  bindingSources: Record<string, string>
}

/** The fields and variable bindings an element's props set on a `nodeType` node under `parentId`. */
export function elementOverrides(
  graph: SceneGraph,
  nodeType: NodeType,
  tree: TreeNode,
  parentId: string
): ElementOverrides {
  const parentLayout = graph.getNode(parentId)?.layoutMode ?? 'NONE'
  const isText = nodeType === 'TEXT'
  const { props, bindings, bindingSources } = preparePropsForRender(
    graph,
    tree.props,
    isText,
    parentId
  )
  const overrides = {
    ...propsToOverrides(props, isText, parentLayout),
    ...componentMetadata(props, nodeType, componentPropertyScope(graph, parentId))
  }

  if (isText) {
    const childText = tree.children.filter((c): c is string => typeof c === 'string').join('')
    const propText =
      props.text ?? props.characters ?? props.content ?? props.label ?? props.value ?? props.title
    if (childText) overrides.text = childText
    else if (typeof propText === 'string') overrides.text = propText
  }
  return { overrides, bindings, bindingSources }
}

async function renderNode<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  journal: RenderCreationJournal,
  parentId: string,
  onNode?: RenderOptions['onNode'],
  scope?: RekaScope,
  position: Pick<RenderOptions, 'x' | 'y'> = {}
): Promise<SceneNode> {
  const node = await renderNodeContent(
    services,
    graph,
    tree,
    journal,
    parentId,
    onNode,
    scope,
    position
  )
  onNode?.(tree, node)
  return node
}

async function renderNodeContent<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  journal: RenderCreationJournal,
  parentId: string,
  onNode?: RenderOptions['onNode'],
  scope?: RekaScope,
  position: Pick<RenderOptions, 'x' | 'y'> = {}
): Promise<SceneNode> {
  if (tree.type === 'icon' || tree.type === 'svg')
    return renderArtworkNode(services, graph, tree, journal, parentId, position)
  if (tree.type === 'instance') return renderInstanceNode(graph, tree, journal, parentId, position)
  const reka = await renderRekaNode(graph, tree, parentId, scope, {
    render: (child, childParentId, childScope) =>
      renderNode(services, graph, child, journal, childParentId, onNode, childScope),
    create: (nodeType, element, elementParentId) => {
      const { overrides, bindings } = elementOverrides(graph, nodeType, element, elementParentId)
      const created = journal.capture(() =>
        graph.createNode(nodeType, elementParentId, {
          ...overrides,
          ...(elementParentId === parentId ? position : {})
        })
      )
      applyBindings(graph, created.id, bindings)
      return created
    },
    instance: (element, elementParentId) =>
      renderInstanceNode(
        graph,
        element,
        journal,
        elementParentId,
        elementParentId === parentId ? position : {}
      ),
    finishSet: (setId) => refreshComponentSetVariants(graph, setId, createComponentPropertyId)
  })
  if (reka) return reka

  const nodeType = TYPE_MAP[tree.type]
  if (!nodeType) throw new Error(`Unknown element: <${tree.type}>`)

  const { overrides, bindings } = elementOverrides(graph, nodeType, tree, parentId)
  const node = journal.capture(() =>
    graph.createNode(nodeType, parentId, { ...overrides, ...position })
  )
  applyBindings(graph, node.id, bindings)

  for (const child of tree.children) {
    if (typeof child === 'string') continue
    if (isTreeNode(child)) {
      await renderNode(services, graph, child, journal, node.id, onNode, scope)
    }
  }

  if (node.type === 'COMPONENT_SET')
    refreshComponentSetVariants(graph, node.id, createComponentPropertyId)

  return node
}
