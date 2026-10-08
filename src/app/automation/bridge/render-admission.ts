import type { SceneGraph } from '@open-pencil/scene-graph'

/** Transport metadata only: never put JSX, design content or credentials in this context. */
export interface AutomationRequestContext {
  id: string
  deadlineAt?: number
  signal?: AbortSignal
}

type RenderPhase = 'preparing' | 'queued' | 'running' | 'completed' | 'expired' | 'failed'
interface RenderStatus {
  requestId: string | null
  phase: RenderPhase
  receivedAt: number
  startedAt: number | null
  finishedAt: number | null
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
    finishedAt: null
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
    status.finishedAt = Date.now()
  }
}

export function queueRender(graph: SceneGraph): void {
  const status = renders.get(graph)
  if (status) status.phase = 'queued'
}

/** Mutation cutoff: after this point cancellation cannot roll back unrelated manual edits. */
export function startRender(graph: SceneGraph, context?: AutomationRequestContext): void {
  assertRenderRequestLive(context)
  const status = renders.get(graph)
  if (status) {
    status.phase = 'running'
    status.startedAt = Date.now()
  }
}

export function readRenderStatus(graph: SceneGraph) {
  const status = renders.get(graph)
  return status
    ? {
        scope: 'document-automation-render' as const,
        ...status,
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
