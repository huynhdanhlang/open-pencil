import { describe, expect, test } from 'bun:test'

// Exercise the built XPath export used by the Node CLI, without LFS fixtures.
const QUERY = `
  import { SceneGraph } from '@open-pencil/scene-graph'
  import { queryByXPath } from '@open-pencil/core/xpath'
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.createNode('FRAME', page.id, { name: 'Card', width: 200 })
  graph.createNode('RECTANGLE', page.id, { name: 'Background', width: 200 })
  const nodes = await queryByXPath(graph, '//FRAME[@width = 200]', { limit: 1 })
  console.log(JSON.stringify(nodes.map(({ name, type }) => ({ name, type }))))
`

describe('query CLI runtime compatibility', () => {
  for (const runtime of ['node', process.execPath]) {
    test(`queries a document with ${runtime === 'node' ? 'Node' : 'Bun'}`, async () => {
      const proc = Bun.spawn(
        [runtime, '--input-type=module', '--eval', QUERY],
        { stdout: 'pipe', stderr: 'pipe' }
      )
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
      ])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      const nodes = JSON.parse(stdout)
      expect(nodes).toHaveLength(1)
      expect(nodes[0]).toMatchObject({ name: 'Card', type: 'FRAME' })
    })
  }
})
