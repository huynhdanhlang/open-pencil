import { describe, expect, mock, test } from 'bun:test'

import { createAgentDiscovery } from '@/app/ai/agents/discovery'
import type { AgentLookup } from '@/app/ai/agents/native'
import { useOnboardingAgents } from '@/app/ai/models/settings/onboarding/agents'

function lookup(...commands: string[]): AgentLookup {
  return {
    searchPath: '/test/bin',
    executables: Object.fromEntries(commands.map((command) => [command, `/test/bin/${command}`]))
  }
}

describe('useOnboardingAgents', () => {
  test('describes a coding agent and the MCP server from discovery', async () => {
    const discovery = createAgentDiscovery({
      enabled: true,
      lookup: async () => lookup('claude', 'npm'),
      install: async () => undefined
    })
    const agents = useOnboardingAgents(discovery)
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
    const agents = useOnboardingAgents(discovery)
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
    expect(useOnboardingAgents(discovery).agentSetup('acp:codex')).toMatchObject({
      supported: false,
      detected: null
    })
  })
})
