import { strict as assert } from 'node:assert'

import { invokeNative } from '#tests/helpers/tauri/invoke'

interface AgentLookup {
  executables: Record<string, string | null>
  versions: Record<string, string | null>
  searchPath: string
}

describe('native agent discovery', () => {
  it('reports every known agent program without starting any of them', async () => {
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(window.openPencil?.getStore?.())),
      { timeout: 30_000, timeoutMsg: 'OpenPencil editor did not initialize' }
    )
    const lookup = await invokeNative<AgentLookup>('agent_lookup')
    assert.deepEqual(Object.keys(lookup.executables).sort(), [
      'claude',
      'claude-agent-acp',
      'codex',
      'codex-acp',
      'gemini',
      'npm',
      'openpencil-harness',
      'openpencil-mcp-http'
    ])
    assert.deepEqual(Object.keys(lookup.versions).sort(), [
      '@open-pencil/harness',
      '@open-pencil/mcp'
    ])
    for (const path of Object.values(lookup.executables)) {
      assert.ok(path === null || path.length > 0)
    }
    assert.ok(lookup.searchPath.length > 0)
  })
})
