import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { componentMetadata, componentPropertyScope } from './component-properties'
import { colorSchema, solid } from './paints'
import { applySizeOverrides } from './props-overrides'
import type { RenderCreationJournal } from './render-creation'
import { designJSXProp } from './schema'
import type { DesignJSXServices } from './services'
import { isTreeNode, type TreeNode } from './tree'
import type { RenderOptions } from './types'
import { parseScriptInput } from './validation'
import { isVariable, resolveVariableId, variableFallback } from './vars'

function applyIconSize(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>,
  parentLayout: SceneNode['layoutMode'],
  size: number
): void {
  const { w, h } = applySizeOverrides(props, overrides, parentLayout)
  if (typeof w !== 'number') overrides.width = size
  if (typeof h !== 'number') overrides.height = size
}

async function renderIconNode<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  journal: RenderCreationJournal,
  parentId: string,
  position: Pick<RenderOptions, 'x' | 'y'> = {}
): Promise<SceneNode> {
  const props = tree.props
  const iconName = props.name as string | undefined
  if (!iconName) throw new Error('<Icon> requires a name prop (e.g. name="lucide:heart")')

  const size = (props.size as number | undefined) ?? 24
  const artwork = await services.icon(iconName, size)
  if (!artwork) throw new Error(`Icon "${iconName}" not found`)
  return placeArtwork(services, graph, artwork, props, size, journal, parentId, position)
}

function placeArtwork<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  artwork: Artwork,
  props: Record<string, unknown>,
  size: number,
  journal: RenderCreationJournal,
  parentId: string,
  position: Pick<RenderOptions, 'x' | 'y'>
): SceneNode {
  const parentLayout = graph.getNode(parentId)?.layoutMode ?? 'NONE'
  const overrides: Partial<SceneNode> = {}
  if (props.label) overrides.name = props.label as string
  applyIconSize(props, overrides, parentLayout, size)
  Object.assign(overrides, position)
  const colorVariableId = isVariable(props.color)
    ? resolveVariableId(graph, props.color)
    : undefined
  if (
    isVariable(props.color) &&
    (!colorVariableId || graph.variables.get(colorVariableId)?.type !== 'COLOR')
  )
    throw new Error(`Artwork color variable "${props.color.name}" is missing or is not COLOR`)
  const colorInput = isVariable(props.color) ? variableFallback(graph, props.color) : props.color
  if (isVariable(props.color) && colorInput === undefined)
    throw new Error(
      `Artwork color variable "${props.color.name}" has no resolved color or fallback`
    )
  const color = solid(
    parseScriptInput('Invalid artwork color', colorSchema, colorInput ?? '#000000')
  ).color
  return journal.capture(() =>
    services.createArtwork(graph, artwork, { parentId, size, color, colorVariableId, overrides })
  )
}

function renderSVGNode<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  journal: RenderCreationJournal,
  parentId: string,
  position: Pick<RenderOptions, 'x' | 'y'>
): SceneNode {
  const props = tree.props
  const w = designJSXProp(props, 'w')
  const h = designJSXProp(props, 'h')
  const explicitW = typeof w === 'number' ? w : 0
  const explicitH = typeof h === 'number' ? h : 0
  const size =
    explicitW > 0 || explicitH > 0
      ? Math.max(explicitW, explicitH)
      : ((props.size as number | undefined) ?? 24)
  const body =
    (typeof props.body === 'string' && props.body) ||
    tree.children.filter((c): c is string => typeof c === 'string').join('')
  const artwork = services.svg({ body, elements: tree.children.filter(isTreeNode), props }, size)
  if (!artwork) {
    throw new Error('<svg> requires SVG markup, a body prop, or supported SVG shape children')
  }
  return placeArtwork(services, graph, artwork, props, size, journal, parentId, position)
}

export async function renderArtworkNode<Artwork>(
  services: DesignJSXServices<Artwork>,
  graph: SceneGraph,
  tree: TreeNode,
  journal: RenderCreationJournal,
  parentId: string,
  position: Pick<RenderOptions, 'x' | 'y'>
): Promise<SceneNode> {
  const metadata = componentMetadata(tree.props, 'VECTOR', componentPropertyScope(graph, parentId))
  const node =
    tree.type === 'icon'
      ? await renderIconNode(services, graph, tree, journal, parentId, position)
      : renderSVGNode(services, graph, tree, journal, parentId, position)
  if (Object.keys(metadata).length > 0) graph.updateNode(node.id, metadata)
  return node
}
