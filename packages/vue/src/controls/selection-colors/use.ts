import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import {
  refreshSelectionColor,
  replaceSelectionColor,
  selectionColors,
  selectionColorsShown,
  type SelectionColor
} from '@open-pencil/core/editor'
import type { UndoEntry } from '@open-pencil/scene-graph'

import { useUndoBatch } from '#vue/controls/undo-batch/use'
import { useEditor } from '#vue/editor/context'
import { useEditorEvent } from '#vue/editor/events/use'
import { useSceneComputed } from '#vue/internal/scene-computed/use'

/**
 * Figma's Selection colors for the current selection: each colour its layers and their
 * descendants fill or stroke with, and an edit that recolours every paint using it. While a row's
 * picker is open the list keeps its order, so the row under the picker stays put.
 */
export function useSelectionColors() {
  const editor = useEditor()
  const batch = useUndoBatch(editor.undo, editor.beginInteractiveEdit)
  const ids = useSceneComputed(() => [...editor.state.selectedIds])
  // A move, resize, or rotation changes no colour, so the list is not walked again mid-drag.
  let last: SelectionColor[] = []
  const live = useSceneComputed(() => {
    if (!editor.state.transforming) last = selectionColors(editor.graph, ids.value)
    return last
  })
  const frozen = shallowRef<SelectionColor[] | null>(null)
  const pickerRevision = shallowRef(0)
  let sessionEntries = new WeakSet<UndoEntry>()
  let pendingSessionEdit = false
  const colors = computed(() => {
    const current = live.value
    if (!frozen.value) return current
    const rows = frozen.value.map((entry) => refreshSelectionColor(editor.graph, entry))
    // A removed or no-longer-editable paint cannot silently retarget an open row.
    if (rows.some((entry) => entry === undefined)) return []
    return rows.filter((entry) => entry !== undefined)
  })
  const shown = useSceneComputed(
    () => live.value.length > 0 && selectionColorsShown(editor.graph, ids.value)
  )

  /** Recolours every paint using the colour in row `index`. */
  function replace(index: number, to: Pick<SelectionColor, 'color' | 'opacity'>) {
    const list = colors.value
    const from = list.at(index)
    if (!from) return
    const updates = replaceSelectionColor(editor.graph, ids.value, from, to)
    if (updates.length === 0) return
    batch.ensure(`selection-color:${index}`, 'Change selection color')
    pendingSessionEdit = true
    for (const { id, changes } of updates)
      editor.updateNodeWithUndo(id, changes, 'Change selection color')
    if (frozen.value)
      frozen.value = list.map((entry, row) => (row === index ? { ...entry, ...to } : entry))
  }

  /** Starts editing a row in its picker: the list keeps its order until `finish`. */
  function begin() {
    sessionEntries = new WeakSet<UndoEntry>()
    pendingSessionEdit = false
    frozen.value = [...live.value]
  }

  /** Ends an edit: commits it as one undo step and lets the list re-sort. */
  function finish() {
    batch.flush()
    frozen.value = null
    pendingSessionEdit = false
  }

  function invalidate() {
    if (!frozen.value) return
    finish()
    pickerRevision.value++
  }

  useEditorEvent('history:changed', () => {
    if (!pendingSessionEdit) return
    const entry = editor.undo.peekUndo()
    if (entry) sessionEntries.add(entry)
    pendingSessionEdit = false
  })
  // Our coalesced edit settles first. Other history may remove/reorder paint slots.
  const stopHistory = editor.undo.onBeforeHistory((direction) => {
    pendingSessionEdit = false
    if (!frozen.value) return
    const entry = direction === 'undo' ? editor.undo.peekUndo() : editor.undo.peekRedo()
    if (!entry || !sessionEntries.has(entry)) invalidate()
  })
  onScopeDispose(stopHistory)
  useEditorEvent('selection:changed', invalidate)
  useEditorEvent('graph:replaced', invalidate)
  watch(
    () => {
      void live.value
      return frozen.value?.some((entry) => !refreshSelectionColor(editor.graph, entry)) ?? false
    },
    (invalid) => {
      if (invalid) invalidate()
    },
    { flush: 'sync' }
  )

  return { colors, shown, replace, begin, finish, pickerRevision }
}
