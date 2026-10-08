import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createRafScheduler } from '#vue/shared/input/raf-scheduler'

/** Coalesce the displayed projection, while graph mutations and Undo stay synchronous. */
export function createLayerTreeEvents(
  editor: Editor,
  rebuild: () => void,
  patch: (id: string, changes: Partial<SceneNode>) => void,
  selectionChanged: (ids: string[]) => void,
  shouldDeferStructuralUpdates?: () => boolean
) {
  let pending = false
  let disposed = false
  const frame = createRafScheduler(() => {
    if (disposed || !pending) return
    if (shouldDeferStructuralUpdates?.()) frame.schedule()
    else flush()
  })

  function flush() {
    frame.cancel()
    if (disposed || !pending) return
    pending = false
    rebuild()
  }

  function schedule() {
    if (disposed || pending) return
    pending = true
    frame.schedule()
  }

  function reset() {
    frame.cancel()
    pending = false
    if (!disposed) rebuild()
  }

  const unsubscribe = [
    editor.onEditorEvent('graph:replaced', reset),
    editor.onEditorEvent('page:changed', reset),
    editor.onEditorEvent('node:created', schedule),
    editor.onEditorEvent('node:deleted', schedule),
    editor.onEditorEvent('node:reparented', schedule),
    editor.onEditorEvent('node:reordered', schedule),
    editor.onEditorEvent('node:updated', (id, changes) => {
      if ('childIds' in changes || 'parentId' in changes) schedule()
      else patch(id, changes)
    }),
    editor.onEditorEvent('selection:changed', (ids) => {
      // Reveal/range selection must see newly created rows before the next frame.
      flush()
      selectionChanged(ids)
    })
  ]

  return {
    flush,
    dispose() {
      disposed = true
      pending = false
      frame.cancel()
      for (const stop of unsubscribe) stop()
    }
  }
}
