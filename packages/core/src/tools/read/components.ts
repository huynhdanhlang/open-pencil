import * as v from 'valibot'

import { getComponentCatalog } from '#core/tools/component-catalog'
import { toolNumber } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'

interface DocumentComponentResult {
  id: string
  name: string
  type: string
  page: string
  source: 'document'
}

interface LibraryComponentResult {
  libraryId: string
  libraryName: string
  revisionId: string
  assetKey: string
  name: string
  type: string
  description: string
  source: 'library'
  enabled: boolean
  priority: number
}

export const getComponents = defineTool({
  name: 'get_components',
  description:
    'List reusable components from the document and enabled component libraries, optionally filtered by name.',
  execution: { kind: 'async', mutation: 'none' },
  input: v.strictObject({
    name: v.optional(
      v.pipe(v.string(), v.description('Filter by name (case-insensitive substring)'))
    ),
    source: v.optional(
      v.pipe(v.picklist(['all', 'document', 'libraries']), v.description('Component source')),
      'all'
    ),
    library_id: v.optional(
      v.pipe(v.string(), v.description('Filter library components by library ID'))
    ),
    limit: v.optional(
      toolNumber(
        v.pipe(v.number(), v.integer(), v.minValue(0), v.description('Max results (default: 50)'))
      )
    )
  }),
  execute: async (figma, args) => {
    const limit = args.limit ?? 50
    if (limit === 0) return { count: 0, components: [] }
    const source = args.source
    const nameFilter = args.name?.toLowerCase()
    const documentComponents: DocumentComponentResult[] = []

    if (source !== 'libraries') {
      for (const page of figma.graph.getPages(true)) {
        if (documentComponents.length >= limit) break
        // Preserve findAll's preorder without wrapping every unrelated descendant.
        const pending = [...page.childIds].reverse()
        while (pending.length && documentComponents.length < limit) {
          const node = figma.graph.getNode(pending.pop()!)
          if (!node) continue
          if (
            (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
            (!nameFilter || node.name.toLowerCase().includes(nameFilter))
          ) {
            documentComponents.push({
              id: node.id,
              name: node.name,
              type: node.type,
              page: page.name,
              source: 'document'
            })
          }
          if (documentComponents.length >= limit) break
          for (let i = node.childIds.length - 1; i >= 0; i--) pending.push(node.childIds[i])
        }
      }
    }

    const catalog = getComponentCatalog(figma.graph)
    const libraryComponents: LibraryComponentResult[] = []
    if (source !== 'document' && catalog) {
      const assets = await catalog.listComponents({
        name: args.name,
        libraryId: args.library_id,
        enabledOnly: true
      })
      libraryComponents.push(
        ...assets.map(({ libraryId, libraryName, revisionId, enabled, priority, asset }) => ({
          libraryId,
          libraryName,
          revisionId,
          assetKey: asset.key,
          name: asset.name,
          type: asset.type,
          description: asset.description,
          source: 'library' as const,
          enabled,
          priority
        }))
      )
    }

    const components = [...libraryComponents, ...documentComponents]
      .sort((left, right) => {
        const leftPriority = 'priority' in left ? left.priority : -1
        const rightPriority = 'priority' in right ? right.priority : -1
        return rightPriority - leftPriority || left.name.localeCompare(right.name)
      })
      .slice(0, limit)
    return { count: components.length, components }
  }
})
