import { safeDestr } from 'destr'
import * as v from 'valibot'

import type { FigmaNodeProxy } from '#core/figma-api'
import { defineTool } from '#core/tools/schema'

const finite = v.pipe(v.number(), v.finite())
const nonnegative = v.pipe(finite, v.minValue(0))
const batchProps = v.strictObject({
  spacing: v.optional(finite),
  padding: v.optional(nonnegative),
  padding_horizontal: v.optional(nonnegative),
  padding_vertical: v.optional(nonnegative),
  counter_align: v.optional(v.picklist(['MIN', 'CENTER', 'MAX', 'STRETCH'])),
  align: v.optional(v.picklist(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'])),
  sizing_horizontal: v.optional(v.picklist(['FIXED', 'HUG', 'FILL'])),
  sizing_vertical: v.optional(v.picklist(['FIXED', 'HUG', 'FILL'])),
  grow: v.optional(nonnegative),
  name: v.optional(v.string()),
  visible: v.optional(v.boolean()),
  corner_radius: v.optional(nonnegative),
  opacity: v.optional(v.pipe(finite, v.minValue(0), v.maxValue(1))),
  auto_resize: v.optional(v.picklist(['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE'])),
  direction: v.optional(v.picklist(['NONE', 'HORIZONTAL', 'VERTICAL']))
})
const batchOperations = v.array(
  v.strictObject({
    id: v.pipe(v.string(), v.minLength(1)),
    props: batchProps
  })
)
type BatchProps = v.InferOutput<typeof batchProps>

function applyBatchProps(node: FigmaNodeProxy, props: BatchProps): string[] {
  const updated: string[] = []

  if (props.spacing !== undefined) {
    node.itemSpacing = props.spacing
    updated.push('spacing')
  }
  if (props.padding !== undefined) {
    const value = props.padding
    node.paddingTop = value
    node.paddingRight = value
    node.paddingBottom = value
    node.paddingLeft = value
    updated.push('padding')
  }
  if (props.padding_horizontal !== undefined) {
    node.paddingLeft = props.padding_horizontal
    node.paddingRight = props.padding_horizontal
    updated.push('padding_horizontal')
  }
  if (props.padding_vertical !== undefined) {
    node.paddingTop = props.padding_vertical
    node.paddingBottom = props.padding_vertical
    updated.push('padding_vertical')
  }
  if (props.counter_align !== undefined) {
    node.counterAxisAlignItems = props.counter_align
    updated.push('counter_align')
  }
  if (props.align !== undefined) {
    node.primaryAxisAlignItems = props.align
    updated.push('align')
  }
  if (props.sizing_horizontal !== undefined) {
    node.layoutSizingHorizontal = props.sizing_horizontal
    updated.push('sizing_horizontal')
  }
  if (props.sizing_vertical !== undefined) {
    node.layoutSizingVertical = props.sizing_vertical
    updated.push('sizing_vertical')
  }
  if (props.grow !== undefined) {
    node.layoutGrow = props.grow
    updated.push('grow')
  }
  if (props.name !== undefined) {
    node.name = props.name
    updated.push('name')
  }
  if (props.visible !== undefined) {
    node.visible = props.visible
    updated.push('visible')
  }
  if (props.corner_radius !== undefined) {
    node.cornerRadius = props.corner_radius
    updated.push('corner_radius')
  }
  if (props.opacity !== undefined) {
    node.opacity = props.opacity
    updated.push('opacity')
  }
  if (props.auto_resize !== undefined) {
    node.textAutoResize = props.auto_resize
    updated.push('auto_resize')
  }
  if (props.direction !== undefined) {
    node.layoutMode = props.direction
    updated.push('direction')
  }

  return updated
}

export const batchUpdate = defineTool({
  name: 'batch_update',

  description:
    'Execute multiple modifications in one call. Each operation is {id, props} where props can include: spacing, padding, padding_horizontal, padding_vertical, counter_align, align, sizing_horizontal, sizing_vertical, grow, name, visible, corner_radius, opacity, auto_resize (for text), direction. Validates the complete batch before changing any node. Runs all updates with one layout recompute. Use node_resize or update_node for geometry.',
  execution: { kind: 'sync', mutation: 'document' },
  input: v.object({
    operations: v.pipe(
      v.string(),
      v.description(
        'JSON array: [{"id":"0:5","props":{"spacing":8}},{"id":"0:6","props":{"sizing_horizontal":"FILL","grow":1}}]'
      )
    )
  }),
  execute: (figma, { operations }) => {
    let parsed: unknown
    try {
      parsed = safeDestr(String(operations))
    } catch {
      return { error: 'Invalid JSON in operations' }
    }
    const checked = v.safeParse(batchOperations, parsed)
    if (!checked.success) {
      return { error: `Invalid batch operations: ${checked.issues[0].message}` }
    }
    const targets = []
    for (const op of checked.output) {
      const node = figma.getNodeById(op.id)
      if (!node) return { error: `Node "${op.id}" not found; no changes applied` }
      targets.push({ node, op })
    }
    const results: Array<{ id: string; updated: string[] }> = []
    for (const { node, op } of targets) {
      const updated = applyBatchProps(node, op.props)
      if (updated.length > 0) results.push({ id: op.id, updated })
    }

    const out: Record<string, unknown> = { updated: results.length }
    if (results.length > 0) out.results = results
    return out
  }
})
