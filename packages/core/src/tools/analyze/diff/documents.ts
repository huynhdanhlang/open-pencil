import { sceneNodeToJSX } from '@open-pencil/design-jsx'
import type { SceneGraph } from '@open-pencil/scene-graph'

import type { TreeArgs } from '#core/rpc'

import { formatOperations } from './format'
import { deltaOperations } from './operations'
import { diffProjections, projectTree, type ProjectedNode } from './projection'

/** `page` limits the diff to one page by name; `depth` bounds each page tree (default: unlimited). */
export type DocumentDiffOptions = TreeArgs

export interface DocumentDiff {
  pages: {
    name: string
    status: 'added' | 'removed' | 'changed' | 'unchanged'
    diff: string | null
  }[]
  /** All page patches joined, or `null` when the documents match. */
  diff: string | null
}

type PageStatus = DocumentDiff['pages'][number]['status']

function pageStatus(before: boolean, after: boolean, diff: string | null): PageStatus {
  if (!before) return 'added'
  if (!after) return 'removed'
  return diff ? 'changed' : 'unchanged'
}

/** A page with no children, standing in for one only the other document has. */
function emptyPage(page: ProjectedNode): ProjectedNode {
  return { ...page, attributes: {}, children: [] }
}

function pageDiff(
  before: ProjectedNode | null,
  after: ProjectedNode | null,
  afterGraph: SceneGraph
): string | null {
  const from = before ?? (after ? emptyPage(after) : null)
  const to = after ?? (before ? emptyPage(before) : null)
  if (!from || !to) return null
  const operations = deltaOperations(diffProjections(from, to), from, to, (id) =>
    sceneNodeToJSX(id, afterGraph)
  )
  return operations.length > 0 ? formatOperations(operations) : null
}

/**
 * Structural diff of two documents, page by page. Pages match by name and nodes by name path,
 * so two versions of a file compare even though their node IDs differ. Each page's patch
 * applies to the first document.
 */
export function diffDocuments(
  before: SceneGraph,
  after: SceneGraph,
  options: DocumentDiffOptions = {}
): DocumentDiff {
  const project = { match: 'path' as const, depth: options.depth }
  const beforePages = new Map(before.getPages().map((page) => [page.name, page]))
  const afterPages = new Map(after.getPages().map((page) => [page.name, page]))
  const names = [...new Set([...beforePages.keys(), ...afterPages.keys()])].filter(
    (name) => options.page === undefined || name === options.page
  )

  const pages = names.map((name) => {
    const beforePage = beforePages.get(name)
    const afterPage = afterPages.get(name)
    const diff = pageDiff(
      beforePage ? projectTree(before, beforePage.id, project) : null,
      afterPage ? projectTree(after, afterPage.id, project) : null,
      after
    )
    return { name, status: pageStatus(Boolean(beforePage), Boolean(afterPage), diff), diff }
  })

  const patches = pages.flatMap((page) => (page.diff ? [page.diff] : []))
  return { pages, diff: patches.length > 0 ? patches.join('\n') : null }
}
