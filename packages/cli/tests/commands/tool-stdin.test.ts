import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CLI_ENTRY } from '#cli-tests/helpers/paths'

import { SceneGraph } from '@open-pencil/scene-graph'

import { writeFigDocument } from '#cli/headless'

test('tool call reads separate and equals stdin flags, including large piped JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-pencil-stdin-'))
  try {
    const graph = new SceneGraph()
    graph.addPage('Main')
    const file = join(dir, 'input.fig')
    await writeFigDocument(graph, file)
    for (const flags of [['--args-file', '-'], ['--args-file=-']]) {
      const proc = Bun.spawn(
        [process.execPath, CLI_ENTRY, 'tool', 'call', 'create_page', file, ...flags, '--json'],
        {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe'
        }
      )
      proc.stdin.write(JSON.stringify({ name: 'Piped page', padding: 'x'.repeat(2_200_000) }))
      await proc.stdin.end()
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
      ])
      expect(stderr).toBe('')
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toMatchObject({ name: 'Piped page' })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
