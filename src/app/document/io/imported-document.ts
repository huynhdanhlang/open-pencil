import { createEditor, type Editor } from '@open-pencil/core/editor'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { loadFont } from '@/app/editor/fonts'
import type { EditorPreparationHandle as DocumentLoadSession } from '@/app/editor/preparation/types'

export async function applyImportedDocument(
  editor: Editor,
  imported: SceneGraph,
  load?: DocumentLoadSession,
  requestedPageId?: string
) {
  const firstPage = imported.getPages()[0] as SceneNode | undefined
  const requestedPage = requestedPageId ? imported.getNode(requestedPageId) : undefined
  const page = requestedPage?.type === 'CANVAS' ? requestedPage : firstPage
  const pageId = page?.id ?? imported.rootId
  const stagingEditor = createEditor({
    graph: imported,
    loadFont,
    skipInitialGraphSetup: true
  })
  try {
    load?.update({ phase: 'populating-page', detail: page?.name ?? null })
    const prepared = await stagingEditor.preparePage(pageId, {
      signal: load?.signal,
      onProgress: (progress) => load?.update(progress)
    })
    load?.signal.throwIfAborted()
    if (!prepared) throw new Error('Imported page preparation was superseded')

    editor.replaceGraph(imported)
    editor.undo.clear()
    editor.clearSelection()
    // The live editor owns page generations and publishes page:changed to views.
    // A prepared staging page alone does not switch the replacement's first page.
    const livePage = await editor.preparePage(pageId, { signal: load?.signal })
    if (!livePage || !editor.commitPageSwitch(livePage)) {
      throw new Error('Imported page switch was superseded')
    }
  } finally {
    stagingEditor.dispose()
  }
}
