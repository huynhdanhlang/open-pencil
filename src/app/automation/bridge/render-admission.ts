import type { SceneGraph } from '@open-pencil/scene-graph'

/** Transport metadata only: never put JSX, design content or credentials in this context. */
export interface AutomationRequestContext {
  id: string
  deadlineAt?: number
  signal?: AbortSignal
}

type RenderPhase = 'preparing' | 'queued' | 'running' | 'completed' | 'expired' | 'failed'
export type RenderStep =
  | 'snapshot-before'
  | 'construction'
  | 'fonts'
  | 'layout-sync'
  | 'snapshot-after'
  | 'undo-commit'
interface RenderStatus {
  requestId: string | null
  phase: RenderPhase
  receivedAt: number
  startedAt: number | null
  finishedAt: number | null
  step: RenderStep | null
  stepStartedAt: number | null
  stepMs: Partial<Record<RenderStep, number>>
  pageId: string | null
  paintDeferrals: Partial<Record<PaintLayer, number>>
  layerTreeDeferrals: number
  paintMs: Partial<Record<RenderStep, Partial<Record<PaintLayer, PaintTiming>>>>
}
type PaintLayer = 'scene' | 'overlays' | 'full'
interface PaintTiming {
  count: number
  totalMs: number
  maxMs: number
}
const renders = new WeakMap<SceneGraph, RenderStatus>()

export function isRenderCommand(command: string, args: Record<string, unknown>): boolean {
  return command === 'tool' && args.name === 'render'
}

export function assertRenderRequestLive(context?: AutomationRequestContext): void {
  if (
    context?.signal?.aborted ||
    (context?.deadlineAt !== undefined && Date.now() >= context.deadlineAt)
  )
    throw new Error('Request expired before render started; no design mutation was started')
}

/** One admitted render per document. Retries cannot retain another large tree behind it. */
export async function admitRender<T>(
  graph: SceneGraph,
  context: AutomationRequestContext | undefined,
  run: () => Promise<T>
): Promise<T> {
  const previous = renders.get(graph)
  if (previous && ['preparing', 'queued', 'running'].includes(previous.phase))
    throw new Error(
      'A render is still running in this document; inspect get_runtime_status before retrying'
    )
  const status: RenderStatus = {
    requestId:
      context && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.id)
        ? context.id
        : null,
    phase: 'preparing',
    receivedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    step: null,
    stepStartedAt: null,
    stepMs: {},
    pageId: null,
    paintDeferrals: {},
    layerTreeDeferrals: 0,
    paintMs: {}
  }
  renders.set(graph, status)
  try {
    assertRenderRequestLive(context)
    const result = await run()
    status.phase = 'completed'
    return result
  } catch (error) {
    status.phase =
      status.startedAt === null &&
      (context?.signal?.aborted ||
        (context?.deadlineAt !== undefined && Date.now() >= context.deadlineAt))
        ? 'expired'
        : 'failed'
    throw error
  } finally {
    finishRenderStep(status)
    status.finishedAt = Date.now()
  }
}

function finishRenderStep(status: RenderStatus): void {
  if (status.step && status.stepStartedAt !== null)
    status.stepMs[status.step] =
      (status.stepMs[status.step] ?? 0) + Date.now() - status.stepStartedAt
  status.step = null
  status.stepStartedAt = null
}

/** Bounded numeric timings only, independent of recipe text and document contents. */
export function markRenderStep(graph: SceneGraph, step: RenderStep): void {
  const status = renders.get(graph)
  if (!status || status.phase !== 'running') return
  finishRenderStep(status)
  status.step = step
  status.stepStartedAt = Date.now()
}

export function queueRender(graph: SceneGraph): void {
  const status = renders.get(graph)
  if (status) status.phase = 'queued'
}

/** Mutation cutoff: after this point cancellation cannot roll back unrelated manual edits. */
export function startRender(
  graph: SceneGraph,
  context?: AutomationRequestContext,
  pageId?: string
): void {
  assertRenderRequestLive(context)
  const status = renders.get(graph)
  if (status) {
    status.phase = 'running'
    status.startedAt = Date.now()
    status.pageId = pageId ?? null
  }
}

/** Paint only the complete construction; never pause graph, layout or Undo owners. */
export function shouldDeferRenderPaint(
  graph: SceneGraph,
  pageId: string,
  layer: PaintLayer
): boolean {
  const status = renders.get(graph)
  if (!status || !isRenderConstruction(graph, pageId)) return false
  status.paintDeferrals[layer] = (status.paintDeferrals[layer] ?? 0) + 1
  return true
}

/** Presentation batching only; graph mutation/Undo owners continue unchanged. */
export function isRenderConstruction(graph: SceneGraph, pageId: string): boolean {
  const status = renders.get(graph)
  return status?.phase === 'running' && status.step === 'construction' && status.pageId === pageId
}

/** Count only the displayed tree's deferred RAF refresh checks. */
export function shouldDeferRenderLayerTree(graph: SceneGraph, pageId: string): boolean {
  const status = renders.get(graph)
  if (!status || !isRenderConstruction(graph, pageId)) return false
  status.layerTreeDeferrals++
  return true
}

/** Numeric paint timings at the actual surface boundary, including direct paints. */
export function recordRenderPaint(graph: SceneGraph, layer: PaintLayer, durationMs: number): void {
  const status = renders.get(graph)
  if (status?.phase !== 'running' || !status.step || !Number.isFinite(durationMs)) return
  const timings = (status.paintMs[status.step] ??= {})
  const timing = (timings[layer] ??= { count: 0, totalMs: 0, maxMs: 0 })
  timing.count++
  timing.totalMs += Math.max(0, durationMs)
  timing.maxMs = Math.max(timing.maxMs, durationMs)
}

export function readRenderStatus(graph: SceneGraph) {
  const status = renders.get(graph)
  return status
    ? {
        scope: 'document-automation-render' as const,
        ...status,
        stepMs: { ...status.stepMs },
        paintDeferrals: { ...status.paintDeferrals },
        paintMs: Object.fromEntries(
          Object.entries(status.paintMs).map(([step, layers]) => [
            step,
            Object.fromEntries(
              Object.entries(layers).map(([layer, timing]) => [layer, { ...timing }])
            )
          ])
        ),
        elapsedMs: (status.finishedAt ?? Date.now()) - status.receivedAt,
        queueWaitMs: status.startedAt === null ? null : status.startedAt - status.receivedAt,
        cancellation: 'before-start-only' as const
      }
    : null
}

/** Page preparation is shared work; detach this expired waiter without cancelling that owner. */
export function awaitRenderPreparation<T>(
  pending: Promise<T>,
  context?: AutomationRequestContext
): Promise<T> {
  assertRenderRequestLive(context)
  const signal = context?.signal
  if (!signal) return pending
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(new Error('Request expired before render started; no design mutation was started'))
    }
    signal.addEventListener('abort', abort, { once: true })
    pending.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
    if (signal.aborted) abort()
  })
}
