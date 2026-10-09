import { computed, onScopeDispose, ref } from 'vue'

import { computeAllLayouts } from '@open-pencil/core/layout'
import { documentFontStatus, fontManager, fontResolver } from '@open-pencil/core/text'
import { useEditorEvent } from '@open-pencil/vue'

import { isRenderConstruction, measureRenderWork } from '@/app/automation/bridge/render-admission'
import { useEditorStore } from '@/app/editor/active-store'
import { loadFont, requestLocalFontAccess } from '@/app/editor/fonts'
import { createFontStatusRefresh } from '@/app/editor/fonts/status-refresh'

export function useDocumentFontStatus() {
  const editor = useEditorStore()
  const revision = ref(0)
  const retrying = ref(false)

  const updates = createFontStatusRefresh(
    () => revision.value++,
    () => isRenderConstruction(editor.graph, editor.state.currentPageId)
  )
  const refresh = updates.immediate
  onScopeDispose(updates.dispose)

  useEditorEvent('font:resolution-changed', updates.mutated)
  useEditorEvent('graph:replaced', refresh)
  useEditorEvent('page:changed', refresh)
  useEditorEvent('node:created', updates.mutated)
  useEditorEvent('node:updated', updates.mutated)
  useEditorEvent('node:deleted', updates.mutated)

  const status = computed(() => {
    void revision.value
    return measureRenderWork(editor.graph, 'font-status', () =>
      documentFontStatus(editor.graph, editor.state.currentPageId)
    )
  })

  async function retry() {
    if (retrying.value) return
    retrying.value = true
    const preparation = editor.preparationController.begin({ kind: 'font-retry' })
    let succeeded = false
    try {
      if (fontManager.localAccessState() === 'prompt') {
        await requestLocalFontAccess().catch(() => [])
      }
      refresh()
      const issues = status.value.issues
      await Promise.all(
        issues.map(async ({ family, style }) => {
          fontManager.resetWebFontFailures(family, style)
          fontResolver.reset(
            `face:${family.trim().toLocaleLowerCase()}:${style.toLocaleLowerCase()}`
          )
          await loadFont(family, style, '', preparation.signal)
        })
      )
      editor.renderer?.invalidateAllPictures()
      computeAllLayouts(editor.graph, editor.state.currentPageId)
      preparation.update({ phase: 'preparing-render' })
      editor.requestRender()
      if (editor.renderer) {
        await editor.preparationController.waitForPresentation(
          preparation.id,
          editor.state.sceneVersion
        )
      }
      refresh()
      succeeded = true
    } catch (error) {
      if (!preparation.signal.aborted) {
        preparation.fail({
          code: 'font-failed',
          message: error instanceof Error ? error.message : String(error),
          retryable: true
        })
      }
    } finally {
      if (succeeded) preparation.complete()
      retrying.value = false
    }
  }

  function selectAffectedNodes() {
    refresh()
    editor.select(status.value.issues.flatMap((issue) => issue.nodeIds))
  }

  return { status, retrying, retry, selectAffectedNodes }
}
