import type { FigmaAPI } from '@open-pencil/core/figma-api'

import { endAgentSession } from '@/app/automation/agents'
import { handleAgentCommand } from '@/app/automation/bridge/agent-handlers'
import {
  handleActivateDocument,
  handleGetSettings,
  handleRedo,
  handleUndo,
  handleUpdateSettings
} from '@/app/automation/bridge/app-handlers'
import {
  runDesignOperation,
  getDesignOperation,
  cancelDesignOperation
} from '@/app/automation/bridge/design-operations'
import { createAutomationEvalHandler } from '@/app/automation/bridge/eval-handler'
import { handleExport, handleExportJSX } from '@/app/automation/bridge/export-handlers'
import {
  handleCloseFile,
  handleNewDocument,
  handleOpenFile,
  handleSaveFile
} from '@/app/automation/bridge/file-handlers'
import {
  admitRender,
  assertRenderRequestLive,
  awaitRenderPreparation,
  isRenderCommand,
  type AutomationRequestContext
} from '@/app/automation/bridge/render-admission'
import { handleRPCFallback } from '@/app/automation/bridge/rpc-handler'
import { handleSelection } from '@/app/automation/bridge/selection-handler'
import {
  isUnknownRecord,
  listAutomationDocuments,
  resolveAutomationTarget,
  responseWithTarget,
  stripAutomationTargetArgs,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import {
  createAutomationToolHandler,
  toolPreparesShownPage
} from '@/app/automation/bridge/tool-handlers'
import type { EditorStore } from '@/app/editor/active-store'

type FigmaFactory = (store: EditorStore, pageId?: string) => FigmaAPI

type CommandHandler = (
  target: AutomationTarget,
  args: unknown,
  context?: AutomationRequestContext
) => Promise<unknown>

export function createAutomationCommandHandlers(makeFigma: FigmaFactory) {
  const handleEval = createAutomationEvalHandler(makeFigma)
  const handleTool = createAutomationToolHandler(makeFigma)

  const commandHandlers: Partial<Record<string, CommandHandler>> = {
    eval: handleEval,
    tool: handleTool,
    export: handleExport,
    export_jsx: handleExportJSX,
    selection: handleSelection,
    save_file: handleSaveFile,
    close_file: handleCloseFile,
    new_document: handleNewDocument,
    open_file: handleOpenFile,
    activate_document: handleActivateDocument,
    undo: handleUndo,
    redo: handleRedo
  }

  /** Runs a command on a resolved document page, loading the page first if it was never shown. */
  async function handleTargetCommand(
    target: AutomationTarget,
    command: string,
    args: UnknownRecord,
    context?: AutomationRequestContext
  ): Promise<unknown> {
    const admittedGraph = target.store.graph
    const prepareAndRun = async () => {
      if (isRenderCommand(command, args)) assertRenderRequestLive(context)
      const viewTool = command === 'tool' && toolPreparesShownPage(args)
      // Runtime counters describe already-materialized content; inspection must not import a page.
      const runtimeRead = command === 'tool' && args.name === 'get_runtime_status'
      // Save owns whole-file preparation and its shown-page preview. Importing an
      // RPC-selected offscreen page first only duplicates work and delays admission.
      const fileSave = command === 'save_file'
      if (
        target.store.graph.getNode(target.pageId)?.type !== 'CANVAS' ||
        (!viewTool &&
          !runtimeRead &&
          !fileSave &&
          !(await (isRenderCommand(command, args)
            ? awaitRenderPreparation(target.store.preparePageNodes(target.pageId), context)
            : target.store.preparePageNodes(target.pageId))))
      ) {
        throw new Error(`Page "${target.pageId}" was closed before it finished loading`)
      }
      if ((isRenderCommand(command, args) || fileSave) && target.store.graph !== admittedGraph)
        throw new Error(`Document changed before ${fileSave ? 'Save' : 'render'} started`)
      const handler = commandHandlers[command]
      const run = () =>
        command === 'tool'
          ? handleTool(target, args, context)
          : handler
            ? handler(target, args, context)
            : handleRPCFallback(target, command, args)
      // File lifecycle handlers already own their FIG queue; do not nest that queue.
      const result = ['undo', 'redo', 'export'].includes(command)
        ? await target.store.runDocumentOperation(run)
        : await run()
      return responseWithTarget(result, target)
    }
    const run = () =>
      isRenderCommand(command, args)
        ? admitRender(admittedGraph, context, prepareAndRun)
        : prepareAndRun()
    return context && (isRenderCommand(command, args) || command === 'save_file')
      ? runDesignOperation(
          admittedGraph,
          {
            ...context,
            onAccepted: () =>
              context.onAccepted?.({ document_id: target.documentId, page_id: target.pageId })
          },
          run
        )
      : run()
  }

  async function handleRequest(
    store: EditorStore,
    command: string,
    args: unknown,
    context?: AutomationRequestContext
  ): Promise<unknown> {
    if (command === 'agent_dispatch' || command === 'agent_status' || command === 'agent_cancel')
      return handleAgentCommand(store, command, args)
    if (command === 'list_documents') {
      return { ok: true, result: { documents: listAutomationDocuments(store) } }
    }
    if (command === 'agent_session_closed') {
      const session = isUnknownRecord(args) ? args.session : undefined
      if (typeof session === 'string') endAgentSession(session)
      return { ok: true, result: null }
    }
    if (command === 'get_settings') return handleGetSettings()
    if (command === 'update_settings') return handleUpdateSettings(args)

    if (command === 'open_file' || command === 'new_document') {
      const handler = commandHandlers[command]
      if (handler) return handler(resolveAutomationTarget(store, undefined), args)
    }

    const rawArgs = isUnknownRecord(args) ? args : {}
    const target = resolveAutomationTarget(store, rawArgs)
    if (command === 'get_operation_status' || command === 'cancel_operation') {
      if (typeof rawArgs.document_id !== 'string' || typeof rawArgs.operation_id !== 'string')
        throw new Error('Operation queries require exact document_id and operation_id')
      const result =
        command === 'get_operation_status'
          ? getDesignOperation(target.store.graph, rawArgs.operation_id)
          : cancelDesignOperation(target.store.graph, rawArgs.operation_id)
      return responseWithTarget({ ok: true, result }, target)
    }
    return handleTargetCommand(target, command, stripAutomationTargetArgs(rawArgs), context)
  }

  return { handleRequest, handleTargetCommand }
}
