import { tool } from 'ai'
import { isPlainObject } from 'es-toolkit'

import { graphFromPageSnapshot, isEmptyDocumentChange } from '@open-pencil/core/editor'
import type { FigmaAPI } from '@open-pencil/core/figma-api'
import {
  registerComponentCatalog,
  isAtomicTool,
  toolChangesDocument,
  toolsToAI,
  type ToolDef
} from '@open-pencil/core/tools'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import {
  executeAtomicEditorTool,
  extractToolNodeIds,
  structuralFontRoots
} from '@/app/automation/execution/editor'
import { recordToolCompleted, type AIDiagnosticContext } from '@/app/diagnostics/events/ai'
import type { EditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { useLibraryService } from '@/app/libraries'

import { aiToolDefinitions } from './catalog'
import { recordToolChange } from './changes/capture'
import { createMutex } from './mutex'
import {
  aiUndoLabel,
  currentRun,
  markRunChange,
  moveRunToPage,
  recordRunBaseline,
  recordRunUndoEntry,
  runBaseline,
  runPageId,
  stepBudget,
  takeRunUndoNote,
  type Run
} from './run'

export {
  currentRun,
  didHitStepLimit,
  endRun,
  markRunPreview,
  recordStep,
  runAgentId,
  runPageId,
  runUndoEntries,
  startRun
} from './run'

/**
 * A result with the run's note about edits the user undid meanwhile, so the model does not
 * build on them; other results stay as they are.
 */
function withUndoNote(result: unknown, note: string): unknown {
  if (!note) return result
  return isPlainObject(result) ? { ...result, undoNote: note } : { result, undoNote: note }
}

export function createAITools(store: EditorStore, diagnosticContext?: AIDiagnosticContext) {
  const acquireMutation = createMutex()
  const libraryService = useLibraryService()
  libraryService.bindEditor(store)
  registerComponentCatalog(store.graph, libraryService)

  async function runTool(
    def: ToolDef,
    figma: FigmaAPI,
    args: Record<string, unknown>,
    pageId: string
  ): Promise<unknown> {
    if (isAtomicTool(def)) {
      return executeAtomicEditorTool(store, figma, def, args, { label: 'AI' })
    }
    return store.runMutationWithLayout(
      () => def.execute(figma, args),
      pageId,
      async (result, impact) => {
        const pageNode = store.graph.getNode(pageId)
        const nodeIds =
          structuralFontRoots(store.graph, def.name, impact) ??
          (def.name === 'batch_update' ? extractToolNodeIds(result) : pageNode?.childIds)
        if (nodeIds) await ensureGraphFonts(store.graph, nodeIds, store.renderer)
      }
    )
  }
  /** Runs one call; an edit is snapshotted, recorded for undo, and shown where it happened. */
  async function executeCall(
    def: ToolDef,
    figma: FigmaAPI,
    args: Record<string, unknown>,
    { toolCallId, run }: { toolCallId: string; run: Run }
  ): Promise<unknown> {
    const pageId = figma.currentPageId
    if (
      def.name === 'diff_apply' &&
      Array.isArray(args.page_ids) &&
      args.page_ids.some((id) => id !== pageId)
    )
      throw new Error(
        'Grouped multi-page edits require MCP; this AI turn owns only its current page'
      )
    if (!def.mutates) return def.execute(figma, args)
    // The call belongs to the reply that made it, even if a later one starts meanwhile.
    // A step's calls may run concurrently; whole-page snapshots must not interleave.
    const release = await acquireMutation()
    // Stopped while waiting for its turn: the reply is over, so nothing more is edited.
    if (!run.active) {
      release()
      return { error: 'Stopped before this call ran; nothing was changed.' }
    }
    if (!toolChangesDocument(def)) {
      try {
        if (run.pageId && run.pageId !== pageId)
          throw new Error(
            'The agent page changed while this view command was queued. Retry on the current page.'
          )
        if (store.state.currentPageId !== pageId) await store.switchPage(pageId)
        const result = await def.execute(figma, args)
        if (figma.currentPageId !== pageId) {
          if (store.state.currentPageId !== pageId)
            throw new Error('The viewed page changed during the agent command.')
          await moveRunToPage(store, run, figma.currentPageId)
        }
        return result
      } finally {
        release()
      }
    }
    run.beginTool()
    const undoBefore = store.undo.peekUndo()
    let finishChange: ReturnType<EditorStore['captureDocumentChange']> | undefined
    try {
      // Only the first edit keeps the baseline; preparation failures still release the queue.
      if (!run.baselines.has(pageId)) recordRunBaseline(run, store.snapshotPage(pageId))
      finishChange = store.captureDocumentChange(pageId)
      return await runTool(def, figma, args, pageId)
    } finally {
      try {
        if (finishChange) {
          const change = finishChange()
          if (!isEmptyDocumentChange(change)) run.changedCalls.add(toolCallId)
          if (!isAtomicTool(def) && !isEmptyDocumentChange(change)) {
            store.pushUndoStep({
              label: aiUndoLabel(def.name),
              forward: () => store.restoreDocumentChange(change, 'after'),
              inverse: () => store.restoreDocumentChange(change, 'before')
            })
          }
          recordRunUndoEntry(store, run, { tool: def.name, toolCallId }, undoBefore)
          try {
            recordToolChange(store, toolCallId, change)
          } catch (error) {
            console.warn('Could not record AI tool change', error)
          }
          if (run.active && currentRun(store) === run) markRunChange(store, change)
        }
        if (figma.currentPageId !== pageId) await moveRunToPage(store, run, figma.currentPageId)
      } finally {
        release()
        run.endTool()
      }
    }
  }

  return toolsToAI(
    aiToolDefinitions,
    {
      getFigma: () => {
        const figma = makeFigmaFromStore(store, runPageId(store))
        figma.changeBaseline = (pageId) => {
          const baseline = runBaseline(store, pageId)
          return baseline ? graphFromPageSnapshot(store.graph, baseline) : null
        }
        return figma
      },
      executeTool: async (def, figma, args, options) => {
        const run = currentRun(store)
        return withUndoNote(
          await executeCall(def, figma, args, { ...options, run }),
          takeRunUndoNote(store, run)
        )
      },
      onAfterExecute: (def) => {
        if (def.mutates && !isAtomicTool(def)) store.requestRender()
      },
      onFlashNodes: (nodeIds) => {
        store.renderer?.aiClearActive()
        if (nodeIds.length > 0) {
          store.aiFlashDone(nodeIds)
        }
      },
      onToolLog: (entry) => {
        recordToolCompleted(
          {
            tool: entry.tool,
            durationMs: entry.durationMs,
            mutates: entry.mutates,
            failed: Boolean(entry.error)
          },
          diagnosticContext,
          entry.cause
        )
      },
      getStepBudget: () => stepBudget(store)
    },
    { tool }
  )
}

export type AITools = ReturnType<typeof createAITools>
