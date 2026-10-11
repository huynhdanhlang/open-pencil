import type { SceneGraph } from '@open-pencil/scene-graph'
import { tryParseColor } from '@open-pencil/scene-graph/color'

import { colorSchema, solid } from './paints'
import { effectivePropSource } from './props-overrides'
import { prepareScalarBindings } from './scalar-bindings'
import { DESIGN_JSX_STYLE_KEYS } from './schema'
import { parseScriptInput } from './validation'
import { isVariable, resolveVariableId, variableFallback } from './vars'

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

function resolveStructuredPaintColor(
  graph: SceneGraph,
  value: Record<string, unknown>,
  bindings: Record<string, string>,
  key: 'fills' | 'strokes',
  field: string
) {
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
  return { token, paint }
}

function prepareStructuredPaint(
  graph: SceneGraph,
  value: Record<string, unknown>,
  bindings: Record<string, string>,
  key: 'fills' | 'strokes',
  field: string
) {
  const { token, paint } = resolveStructuredPaintColor(graph, value, bindings, key, field)
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
    // Resolve branded variables before cloning the structured paint.
    if (isVariable(value)) {
      const id = resolveVariableId(graph, value)
      if (id) bindings[field] = id
      return variableFallback(graph, value) ?? value
    }
    if (!isObjectRecord(value) || !(key === 'strokes' ? 'color' in value : 'type' in value))
      return value
    return prepareStructuredPaint(graph, value, bindings, key, field)
  })
}

function recordPaintBindingSources(
  props: Record<string, unknown>,
  bindingSources: Record<string, string>,
  fillSource: string | undefined,
  strokeSource: string | undefined
): void {
  // Match propsToOverrides precedence; unused aliases must not rebind a literal.
  if (fillSource) bindingSources.fills = fillSource
  else delete bindingSources.fills
  if (strokeSource) bindingSources.strokes = strokeSource
  else delete bindingSources.strokes
  const strokeWeightSource = Array.isArray(props.strokes)
    ? 'strokes'
    : (effectivePropSource(props, 'strokeWidth') ??
      (props.borderWidth !== undefined ? 'borderWidth' : undefined))
  if (strokeWeightSource) bindingSources.strokeWeight = strokeWeightSource
}

function prepareExplicitBindings(
  graph: SceneGraph,
  props: Record<string, unknown>,
  bindings: Record<string, string>
): void {
  if (!isObjectRecord(props.bind)) return
  for (const [field, value] of Object.entries(props.bind)) {
    if (isVariable(value)) {
      const variableId = resolveVariableId(graph, value)
      if (variableId) bindings[field] = variableId
    } else if (typeof value === 'string') {
      bindings[field] = value
    }
  }
}

function prepareStylePaintBindings(
  graph: SceneGraph,
  props: Record<string, unknown>,
  bindings: Record<string, string>,
  textColorSource: string | undefined,
  fillSource: string | undefined,
  strokeSource: string | undefined
): void {
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
}

export function preparePropsForRender(
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

  prepareStylePaintBindings(graph, props, bindings, textColorSource, fillSource, strokeSource)

  prepareScalarBindings(graph, props, bindings, isText, parentId, bindingSources)

  recordPaintBindingSources(props, bindingSources, fillSource, strokeSource)
  prepareExplicitBindings(graph, props, bindings)

  return { props, bindings, bindingSources }
}
