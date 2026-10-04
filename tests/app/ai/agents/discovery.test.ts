import { describe, expect, test, mock } from 'bun:test'

import { createAgentDiscovery, detectedAgents } from '@/app/ai/agents/discovery'
import type { AgentLookup } from '@/app/ai/agents/native'
import { createDeferred } from '@/app/runtime/deferred'

function lookup(...commands: string[]): AgentLookup {
  return {
    searchPath: '/test/bin',
    executables: Object.fromEntries(commands.map((command) => [command, `/test/bin/${command}`]))
  }
}

describe('local agent discovery', () => {
  test('installs the canvas companion once, discovers it, and restarts the bridge', async () => {
    let installed = false
    const pending = createDeferred<undefined>()
    const installBridge = mock(async () => {
      await pending.promise
      installed = true
    })
    const restartBridge = mock(async () => undefined)
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: async () => lookup('gemini', 'npm', ...(installed ? ['openpencil-mcp-http'] : [])),
      install: async () => undefined,
      installBridge,
      restartBridge
    })
    await discovery.refresh()
    expect(installBridge).not.toHaveBeenCalled()
    const setup = discovery.setupCanvasBridge()
    await discovery.setupCanvasBridge()
    expect(installBridge).toHaveBeenCalledTimes(1)
    pending.resolve(undefined)
    await setup
    expect(discovery.canvasBridgeAvailable.value).toBe(true)
    expect(restartBridge).toHaveBeenCalledTimes(1)
    expect(discovery.error.value).toBeNull()
  })

  test('retries bridge startup without reinstalling a successfully installed companion', async () => {
    const installBridge = mock(async () => undefined)
    const restartBridge = mock(async () => {
      throw new Error('Cannot start')
    })
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: async () => lookup('gemini', 'openpencil-mcp-http'),
      install: async () => undefined,
      installBridge,
      restartBridge
    })
    await discovery.refresh()
    await discovery.setupCanvasBridge()
    expect(discovery.error.value).toBe('canvas-start')
    restartBridge.mockImplementation(async () => undefined)
    await discovery.setupCanvasBridge()
    expect(installBridge).not.toHaveBeenCalled()
    expect(discovery.error.value).toBeNull()
  })
  test('distinguishes native CLIs, adapters, and absent agents without starting them', () => {
    const agents = detectedAgents(lookup('claude', 'codex-acp'))
    expect(agents.map((agent) => [agent.definition.id, agent.status])).toEqual([
      ['claude-code', 'needs-adapter'],
      ['codex', 'available'],
      ['gemini-cli', 'not-installed']
    ])
  })

  test('browser discovery performs no native operations', async () => {
    const scan = mock(async () => lookup('gemini'))
    const install = mock(async () => undefined)
    const discovery = createAgentDiscovery({ enabled: false, lookup: scan, install })
    await discovery.refresh()
    await discovery.install('claude-code')
    expect(scan).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    expect(discovery.agents.value).toEqual([])
  })

  test('deduplicates concurrent scans and notices removals on refresh', async () => {
    const pending = createDeferred<AgentLookup>()
    const scan = mock(() => pending.promise)
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: scan,
      install: async () => undefined
    })
    const first = discovery.refresh()
    const second = discovery.refresh()
    expect(scan).toHaveBeenCalledTimes(1)
    pending.resolve(lookup('gemini', 'codex-acp'))
    await Promise.all([first, second])
    expect(discovery.availableAgents.value).toHaveLength(2)
    scan.mockImplementation(async () => lookup())
    await discovery.refresh()
    expect(discovery.availableAgents.value).toHaveLength(0)
  })

  test('installs only on request, blocks duplicate installs, and rescans afterward', async () => {
    let installed = false
    const pending = createDeferred<undefined>()
    const install = mock(async () => {
      await pending.promise
      installed = true
    })
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: async () => lookup('claude', 'npm', ...(installed ? ['claude-agent-acp'] : [])),
      install
    })
    await discovery.refresh()
    expect(install).not.toHaveBeenCalled()
    const operation = discovery.install('claude-code')
    await discovery.install('claude-code')
    expect(install).toHaveBeenCalledTimes(1)
    expect(install.mock.calls[0]).toEqual([
      expect.objectContaining({ adapterPackage: '@agentclientprotocol/claude-agent-acp' }),
      '/test/bin'
    ])
    pending.resolve(undefined)
    await operation
    expect(discovery.availableAgents.value[0]?.definition.id).toBe('claude-code')
    expect(discovery.installing.value).toBeNull()
    expect(discovery.error.value).toBeNull()
  })

  test('failed installation remains retryable and does not publish raw errors', async () => {
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: async () => lookup('codex', 'npm'),
      install: async () => {
        throw new Error('private npm backend error')
      }
    })
    await discovery.refresh()
    await discovery.install('codex')
    expect(discovery.error.value).toBe('install')
    expect(discovery.installing.value).toBeNull()
    expect(discovery.availableAgents.value).toEqual([])
  })

  test('requires npm for adapter setup but not for native ACP agents', async () => {
    const install = mock(async () => undefined)
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: async () => lookup('claude', 'gemini'),
      install
    })
    await discovery.refresh()
    await discovery.install('claude-code')
    expect(discovery.error.value).toBe('npm')
    expect(install).not.toHaveBeenCalled()
    expect(discovery.availableAgents.value[0]?.definition.id).toBe('gemini-cli')
  })

  test('a failed scan preserves the last successful discovery and allows retry', async () => {
    const scan = mock(async () => lookup('gemini'))
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: scan,
      install: async () => undefined
    })
    await discovery.refresh()
    scan.mockImplementation(async () => {
      throw new Error('unavailable')
    })
    await discovery.refresh()
    expect(discovery.error.value).toBe('lookup')
    expect(discovery.scanning.value).toBe(false)
    expect(discovery.availableAgents.value[0]?.definition.id).toBe('gemini-cli')
    scan.mockImplementation(async () => lookup('gemini', 'codex-acp'))
    await discovery.refresh()
    expect(discovery.error.value).toBeNull()
    expect(discovery.availableAgents.value).toHaveLength(2)
  })
})
