import type { SceneGraph } from '@open-pencil/scene-graph'

import type { AutomationRequestContext } from './render-admission'

type Receipt = {
  operation_id: string
  status: 'pending' | 'completed' | 'failed'
  response?: unknown
  result_unavailable?: string
  error?: string
}
type Entry = Receipt & {
  cancel?: () => void
  finishedAt?: number
  timer?: ReturnType<typeof setTimeout>
}
const operations = new WeakMap<SceneGraph, Map<string, Entry>>()
const RESULT_LIFETIME_MS = 30 * 60_000
const COMPLETED_LIMIT = 4
const RESULT_MAX_BYTES = 512 * 1024

function remove(entries: Map<string, Entry>, id: string) {
  clearTimeout(entries.get(id)?.timer)
  entries.delete(id)
}

function scheduleExpiry(entries: Map<string, Entry>, id: string) {
  return setTimeout(() => {
    remove(entries, id)
  }, RESULT_LIFETIME_MS)
}

function prune(entries: Map<string, Entry>) {
  const completed = [...entries.values()].filter((entry) => entry.status !== 'pending')
  for (const entry of completed) {
    if (Date.now() - entry.finishedAt! >= RESULT_LIFETIME_MS) remove(entries, entry.operation_id)
  }
  for (const entry of completed.slice(0, Math.max(0, completed.length - COMPLETED_LIMIT)))
    remove(entries, entry.operation_id)
}

export async function runDesignOperation<T>(
  graph: SceneGraph,
  context: AutomationRequestContext,
  run: () => Promise<T>
): Promise<T> {
  let entries = operations.get(graph)
  if (!entries) operations.set(graph, (entries = new Map()))
  prune(entries)
  if ([...entries.values()].some((entry) => entry.status === 'pending'))
    throw new Error(
      'A design operation is still running; inspect get_operation_status before retrying'
    )
  const entry: Entry = { operation_id: context.id, status: 'pending', cancel: context.cancel }
  const id = context.id
  entries.set(context.id, entry)
  try {
    await context.onAccepted?.()
    const response = await run()
    entry.status = 'completed'
    // Tool results can borrow child arrays from the live graph. Retain an owned,
    // byte-bounded answer, never a reference that later design edits can change.
    try {
      const json = JSON.stringify(response)
      if (json !== undefined && new TextEncoder().encode(json).byteLength <= RESULT_MAX_BYTES)
        entry.response = JSON.parse(json)
      else
        entry.result_unavailable =
          'Operation completed; result exceeds the 512 KiB receipt limit. Inspect the document.'
    } catch {
      entry.result_unavailable =
        'Operation completed; result could not be retained. Inspect the document.'
    }
    return response
  } catch (error) {
    entry.status = 'failed'
    entry.error = (error instanceof Error ? error.message : String(error)).slice(0, 4096)
    throw error
  } finally {
    entry.cancel = undefined
    entry.finishedAt = Date.now()
    prune(entries)
    // This timer captures the small receipt map, not the document graph or JSX.
    entry.timer = scheduleExpiry(entries, id)
  }
}

export function getDesignOperation(graph: SceneGraph, id: string): Receipt {
  const entries = operations.get(graph)
  if (entries) prune(entries)
  const entry = entries?.get(id)
  if (!entry) throw new Error('Design operation not found in this document or its result expired')
  const { cancel: _cancel, finishedAt: _finishedAt, timer: _timer, ...receipt } = entry
  return receipt
}

export function cancelDesignOperation(graph: SceneGraph, id: string): Receipt {
  const receipt = getDesignOperation(graph, id)
  operations.get(graph)?.get(id)?.cancel?.()
  return receipt
}
