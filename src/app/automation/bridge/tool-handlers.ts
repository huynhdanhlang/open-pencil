import {
  finishRenderPlacement,
  renderTreeRoots,
  resolveRenderPlacement,
  type RenderPlacementInput
} from '@open-pencil/core/design-jsx'
import type { FigmaAPI } from '@open-pencil/core/figma-api'
import {
  ALL_TOOLS,
  registerComponentCatalog,
  isAtomicTool,
  isToolExposed,
  parseToolArgs,
  toolChangesDocument
} from '@open-pencil/core/tools'
import { decodeTreeFromTransport } from '@open-pencil/design-jsx'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  agentFinished,
  agentStarted,
  readAgentSession,
  touchedNodeIds
} from '@/app/automation/agents'
import {
  queueRender,
  markRenderStep,
  readRenderStatus,
  startRender,
  type AutomationRequestContext
} from '@/app/automation/bridge/render-admission'
import { limitToSelection } from '@/app/automation/bridge/selection-scope'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import {
  AUTOMATION_UNDO_LABEL,
  automationUndoLabel,
  executeAtomicEditorTool,
  executeWithPageUndo
} from '@/app/automation/execution/editor'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { useLibraryService } from '@/app/libraries'

type FigmaFactory = (store: AutomationTarget['store'], pageId?: string) => FigmaAPI

/** View tools let switchPage prepare fonts/layout exactly once before showing their target. */
export function toolPreparesShownPage(args: Record<string, unknown>): boolean {
  return ALL_TOOLS.some(
    (tool) =>
      tool.name === args.name && isToolExposed(tool, 'mcp') && tool.execution.mutation === 'view'
  )
}

export function createAutomationToolHandler(makeFigma: FigmaFactory) {
  async function handleToolRender(
    target: AutomationTarget,
    toolArgs: Record<string, unknown>,
    placementInput: RenderPlacementInput
  ): Promise<unknown> {
    const store = target.store
    const tree = decodeTreeFromTransport(toolArgs.tree)
    const placement = resolveRenderPlacement(store.graph, placementInput, target.pageId)
    const results = await executeWithPageUndo(
      store,
      placement.pageId,
      automationUndoLabel('render'),
      () =>
        store.runMutationWithLayout(
          async () => {
            const rendered = await renderTreeRoots(store.graph, tree, placement)
            finishRenderPlacement(store.graph, rendered, placement)
            return rendered
          },
          placement.pageId,
          async (nodes) => {
            markRenderStep(store.graph, 'fonts')
            await ensureGraphFonts(
              store.graph,
              nodes.map((node) => node.id),
              store.renderer
            )
            markRenderStep(store.graph, 'layout-sync')
          }
        ),
      (phase) => markRenderStep(store.graph, phase)
    )
    store.requestRender()
    store.flashNodes(results.map((node) => node.id))
    const result = results[0]
    return {
      id: result.id,
      name: result.name,
      type: result.type,
      children: result.childIds,
      ...(results.length > 1
        ? {
            siblings: results
              .slice(1)
              .map((node) => ({ id: node.id, name: node.name, type: node.type }))
          }
        : {})
    }
  }

  return async function handleTool(
    target: AutomationTarget,
    args: unknown,
    context?: AutomationRequestContext
  ): Promise<unknown> {
    const toolName = (args as { name?: string }).name
    const requestedArgs = (args as { args?: Record<string, unknown> }).args ?? {}
    if (!toolName) throw new Error('Missing "name" in args')
    // An MCP server that shares only the selection marks its calls, and they stay inside it.
    const toolArgs =
      (args as { scope?: unknown }).scope === 'selection'
        ? limitToSelection(target.store, toolName, requestedArgs)
        : requestedArgs

    // A call from an MCP session shows as that session's agent, working where the call works.
    const session = readAgentSession((args as { agent?: unknown }).agent)
    if (session) agentStarted(target.store, session, target.pageId)
    const response = await runTool(target, toolName, toolArgs, context)
    if (session) {
      agentFinished(target.store, session, {
        pageId: target.pageId,
        nodeIds: touchedNodeIds(target.store, toolArgs, response.result),
        edited: response.edited
      })
    }
    return { ok: true, result: response.result }
  }

  async function runTool(
    target: AutomationTarget,
    toolName: string,
    toolArgs: Record<string, unknown>,
    context?: AutomationRequestContext
  ): Promise<{ result: unknown; edited: boolean }> {
    const def = ALL_TOOLS.find((t) => t.name === toolName && isToolExposed(t, 'mcp'))
    if (!def) throw new Error(`Unknown tool: ${toolName}`)
    const run = async () => {
      if (toolName === 'render') {
        if (target.store.graph.getNode(target.pageId)?.type !== 'CANVAS')
          throw new Error('Page closed before render started')
        startRender(target.store.graph, context)
      }
      if (toolName === 'render' && toolArgs.tree) {
        const placementInput = parseToolArgs(def.name, def.input, {
          ...toolArgs,
          jsx: ''
        }) as RenderPlacementInput
        return { result: await handleToolRender(target, toolArgs, placementInput), edited: true }
      }
      const store = target.store
      const libraryService = useLibraryService()
      libraryService.bindEditor(store)
      registerComponentCatalog(store.graph, libraryService)
      if (def.execution.mutation === 'view' && store.state.currentPageId !== target.pageId) {
        await store.switchPage(target.pageId)
      }
      const figma = makeFigma(store, target.pageId)
      let result: unknown
      if (def.execution.mutation === 'view') {
        const initialPageId = figma.currentPageId
        result = await def.execute(figma, toolArgs)
        if (figma.currentPageId !== initialPageId) {
          if (store.state.currentPageId !== initialPageId) {
            throw new Error('The shown page changed while the automation view command was running')
          }
          await store.switchPage(figma.currentPageId)
        }
      } else if (isAtomicTool(def)) {
        result = await executeAtomicEditorTool(store, figma, def, toolArgs, {
          label: AUTOMATION_UNDO_LABEL
        })
      } else if (def.mutates) {
        const pageId = figma.currentPageId
        const mutate = () =>
          store.runMutationWithLayout(
            () => def.execute(figma, toolArgs),
            figma.currentPageId,
            async (rendered) => {
              const pageNode = store.graph.getNode(figma.currentPageId)
              const nodeIds = toolName === 'render' ? extractNodeIds(rendered) : pageNode?.childIds
              if (toolName === 'render') markRenderStep(store.graph, 'fonts')
              if (nodeIds) await ensureGraphFonts(store.graph, nodeIds, store.renderer)
              if (toolName === 'render') markRenderStep(store.graph, 'layout-sync')
            }
          )
        // View tools (selection, viewport, pages) leave the document and its history alone.
        result = toolChangesDocument(def)
          ? await executeWithPageUndo(
              store,
              pageId,
              automationUndoLabel(def.name),
              mutate,
              toolName === 'render' ? (phase) => markRenderStep(store.graph, phase) : undefined
            )
          : await mutate()
      } else {
        result = await def.execute(figma, toolArgs)
      }

      if (def.mutates && def.execution.mutation !== 'view') {
        store.requestRender()
        store.flashNodes(extractNodeIds(result))
      }
      if (toolName === 'get_runtime_status' && result && typeof result === 'object')
        result = { ...result, automationRender: readRenderStatus(store.graph) }
      return { result, edited: def.mutates }
    }
    // Raster exports share the renderer and must not overlap a full FIG build.
    if (toolName === 'render') queueRender(target.store.graph)
    return def.execution.mutation === 'none' && def.name !== 'export_image'
      ? run()
      : target.store.runDocumentOperation(run, toolName === 'render' ? context?.signal : undefined)
  }
}

function extractNodeIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const obj = result as JSONObject
  if (typeof obj.deleted === 'string') return []
  const ids: string[] = []
  if (typeof obj.id === 'string') ids.push(obj.id)
  if (Array.isArray(obj.siblings)) {
    for (const sibling of obj.siblings) {
      if (sibling && typeof sibling === 'object' && typeof (sibling as JSONObject).id === 'string')
        ids.push((sibling as JSONObject).id as string)
    }
  }
  if (Array.isArray(obj.results)) {
    for (const item of obj.results) {
      if (item && typeof item === 'object' && typeof (item as JSONObject).id === 'string')
        ids.push((item as JSONObject).id as string)
    }
  }
  return ids
}
