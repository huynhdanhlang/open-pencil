import { describe, expect, test } from 'bun:test'

import { ACP_AGENTS } from '@open-pencil/core/constants'

import { MCP_INSTALL_COMMAND } from '@/app/ai/acp/install'
import { codingAgentGuideURL, codingAgentSetupPrompt } from '@/app/ai/acp/setup-prompt'

describe('codingAgentSetupPrompt', () => {
  for (const agent of ACP_AGENTS) {
    test(`asks ${agent.name} to install itself and the MCP server`, () => {
      const prompt = codingAgentSetupPrompt(agent.id)
      expect(prompt).not.toMatch(/\{\{\w+\}\}/)
      expect(prompt).toContain(agent.name)
      expect(prompt).toContain(`\`${agent.command}\``)
      if (agent.installCommand) expect(prompt).toContain(agent.installCommand)
      expect(prompt).toContain(MCP_INSTALL_COMMAND)
      expect(prompt).toContain(codingAgentGuideURL(agent.id))
    })
  }

  test('links to the agent section of the guide', () => {
    expect(codingAgentGuideURL('codex')).toBe(
      'https://openpencil.dev/programmable/coding-agents#codex'
    )
  })
})
