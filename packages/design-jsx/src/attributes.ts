import { parser } from '@lezer/javascript'

import type { JSXAttributeSource } from './export'
import { DESIGN_JSX_PROPERTY_ALIASES } from './schema'

const elementParser = parser.configure({
  dialect: 'jsx',
  top: 'SingleExpression'
})
const canonicalNames = new Map(
  Object.entries(DESIGN_JSX_PROPERTY_ALIASES).flatMap(([name, aliases]) =>
    aliases.map((alias) => [alias, name] as const)
  )
)

/** Attribute identity for comparisons and patches; parsing/rendering retain their own precedence. */
export function normalizeJSXAttributeSources(
  attributes: readonly JSXAttributeSource[]
): JSXAttributeSource[] {
  const normalized = new Map<string, JSXAttributeSource>()
  for (const attribute of attributes) {
    const name = canonicalNames.get(attribute.name) ?? attribute.name
    const source = name + attribute.source.slice(attribute.name.length)
    const existing = normalized.get(name)
    if (existing && existing.source !== source) {
      throw new Error(`Conflicting attributes for "${name}": ${existing.source}, ${source}`)
    }
    normalized.set(name, { name, source })
  }
  return [...normalized.values()]
}

/**
 * Split JSX attributes, such as `w={200} bg="#FF0000"`, into each attribute as written.
 * Throws on a syntax error or a spread, whose props cannot be named.
 */
export function parseJSXAttributes(source: string): JSXAttributeSource[] {
  const element = `<Frame ${source} />`
  const tree = elementParser.parse(element)
  const attributes: JSXAttributeSource[] = []
  const invalid = () => new SyntaxError(`Invalid JSX attributes: ${source}`)
  tree.iterate({
    enter(node) {
      if (node.type.isError || node.name === 'JSXSpreadAttribute') throw invalid()
      if (node.name !== 'JSXAttribute') return undefined
      const key = node.node.firstChild
      if (key?.name !== 'JSXIdentifier') throw invalid()
      attributes.push({
        name: element.slice(key.from, key.to),
        source: element.slice(node.from, node.to)
      })
      return false
    }
  })
  return attributes
}
