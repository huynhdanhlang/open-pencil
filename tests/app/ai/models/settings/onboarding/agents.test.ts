import { describe, expect, mock, test } from 'bun:test'

import { createAgentDiscovery } from '@/app/ai/agents/discovery'
import type { AgentLookup } from '@/app/ai/agents/native'
import { useOnboardingAgents } from '@/app/ai/models/settings/onboarding/agents'

function lookup(...commands: string[]): AgentLookup {
  return {
    searchPath: '/test/bin',
    versions: {},
    executables: Object.fromEntries(commands.map((command) => [command, `/test/bin/${command}`]))
  }
}

const noPi = async () => null

describe('useOnboardingAgents', () => {
  test('describes a coding agent and the MCP server from discovery', async () => {
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: async () => lookup('claude', 'npm'),
      install: async () => undefined
    })
    const agents = useOnboardingAgents(discovery, noPi)
    await agents.refreshAgents()
    expect(agents.agentSetup('acp:claude-code')).toMatchObject({
      supported: true,
      bridge: false,
      npm: true,
      error: null,
      detected: { status: 'needs-adapter' }
    })
    expect(agents.agentSetup('openrouter').detected).toBeNull()
  })

  test('installs the adapter of the agent being connected', async () => {
    let installed = false
    const install = mock(async () => {
      installed = true
    })
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: async () => lookup('codex', 'npm', ...(installed ? ['codex-acp'] : [])),
      install
    })
    const agents = useOnboardingAgents(discovery, noPi)
    await agents.refreshAgents()
    await agents.installAgent('acp:codex')
    expect(install).toHaveBeenCalledTimes(1)
    expect(agents.agentSetup('acp:codex').detected?.status).toBe('available')
  })

  test('reports no native support outside the desktop app', () => {
    const discovery = createAgentDiscovery({
      enabled: false,
      lookup: async () => lookup(),
      install: async () => undefined
    })
    expect(useOnboardingAgents(discovery, noPi).agentSetup('acp:codex')).toMatchObject({
      supported: false,
      detected: null
    })
  })

  test('installs the Harness companion for Pi and reads Pi’s default model', async () => {
    let installed = false
    const installHarness = mock(async () => {
      installed = true
    })
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: async () => lookup('npm', ...(installed ? ['openpencil-harness'] : [])),
      install: async () => undefined,
      installHarness
    })
    const agents = useOnboardingAgents(discovery, async () => ({
      agentDir: '/home/test/.pi/agent',
      defaultModel: 'openai-codex/gpt-5.6'
    }))
    await agents.refreshAgents()
    expect(agents.piSetup('harness:pi')).toMatchObject({
      companion: false,
      npm: true,
      defaultModel: 'openai-codex/gpt-5.6'
    })
    await agents.installAgent('harness:pi')
    expect(installHarness).toHaveBeenCalledTimes(1)
    expect(agents.piSetup('harness:pi')?.companion).toBe(true)
    expect(agents.piSetup('acp:codex')).toBeUndefined()
  })
})
