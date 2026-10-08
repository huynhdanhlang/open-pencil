import type { SceneGraph } from '@open-pencil/scene-graph'

/** One allocation lane for FIG builds and bounded canvas commands in a document. */
export function createFigBuildQueue(getGraph: () => SceneGraph) {
  let tail: Promise<unknown> = Promise.resolve()
  let disposed = false
  const pending = new Set<(reason: unknown) => void>()
  return {
    run<T>(build: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (disposed) return Promise.reject(new Error('Document changed before FIG build'))
      const graph = getGraph()
      // Only this slot retains the payload. Cancelling pending work clears it immediately,
      // even while an earlier allocation is still running. Started work owns its commit.
      let execute: (() => Promise<T>) | null = build
      let settle!: (value: T | PromiseLike<T>) => void
      let fail!: (reason: unknown) => void
      const result = new Promise<T>((resolve, reject) => {
        settle = resolve
        fail = reject
      })
      const rejectPending = (reason: unknown) => {
        execute = null
        pending.delete(rejectPending)
        signal?.removeEventListener('abort', cancel)
        fail(reason)
      }
      const cancel = () =>
        rejectPending(signal?.reason ?? new Error('Request cancelled before FIG build'))
      pending.add(rejectPending)
      if (signal?.aborted) cancel()
      else signal?.addEventListener('abort', cancel, { once: true })
      const start = async () => {
        pending.delete(rejectPending)
        signal?.removeEventListener('abort', cancel)
        const run = execute
        execute = null
        if (!run) return
        try {
          if (disposed || getGraph() !== graph) throw new Error('Document changed before FIG build')
          settle(await run())
        } catch (error) {
          fail(error)
        }
      }
      tail = tail.then(start, start)
      return result
    },
    dispose() {
      disposed = true
      for (const reject of pending) reject(new Error('Document changed before FIG build'))
    }
  }
}
