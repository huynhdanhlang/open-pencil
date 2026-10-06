import type { SceneGraph } from '@open-pencil/scene-graph'

/** One allocation lane for FIG builds and bounded canvas commands in a document. */
export function createFigBuildQueue(getGraph: () => SceneGraph) {
  let tail: Promise<unknown> = Promise.resolve()
  let disposed = false
  return {
    run<T>(build: () => Promise<T>): Promise<T> {
      const graph = getGraph()
      const start = () => {
        if (disposed || getGraph() !== graph) throw new Error('Document changed before FIG build')
        return build()
      }
      const result = tail.then(start, start)
      tail = result.then(
        () => undefined,
        () => undefined
      )
      return result
    },
    dispose() {
      disposed = true
    }
  }
}
