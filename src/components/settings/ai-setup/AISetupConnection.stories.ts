import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'

import { ACP_AGENTS, type ACPAgentID } from '@open-pencil/core/constants'

import type { DetectedAgent } from '@/app/ai/agents/discovery'
import type { AgentSetupState } from '@/app/ai/models/settings/onboarding/agents'

import AISetupConnection from './AISetupConnection.vue'

interface Args {
  providerID: 'openrouter' | 'anthropic' | 'openai-compatible' | 'acp:claude-code' | 'acp:codex'
  signInStatus: 'idle' | 'waiting' | 'verifying' | 'blocked' | 'cancelled' | 'expired' | 'failed'
  account: { label: string; freeTier: boolean } | null
  agentSetup?: AgentSetupState
  hasSavedKey: boolean
  recommended: boolean
}

function detected(id: ACPAgentID, status: DetectedAgent['status']): DetectedAgent {
  const definition = ACP_AGENTS.find((agent) => agent.id === id) ?? ACP_AGENTS[0]
  return { definition, cliPath: null, adapterPath: null, status }
}

function agentSetup(overrides: Partial<AgentSetupState>): AgentSetupState {
  return {
    supported: true,
    scanning: false,
    detected: null,
    bridge: false,
    npm: true,
    installingAgent: false,
    installingBridge: false,
    error: null,
    ...overrides
  }
}

const meta = {
  title: 'Settings/AI Setup/Connection',
  args: {
    providerID: 'openrouter',
    signInStatus: 'idle',
    hasSavedKey: false,
    recommended: true,
    account: null
  },
  render: (args) => ({
    components: { AISetupConnection },
    setup: () => ({
      args,
      state: {
        apiKey: args.account ? 'sk-or-story' : '',
        customBaseURL: '',
        customModelID: '',
        test: 'idle',
        reason: null,
        account: args.account
      }
    }),
    template:
      '<div class="w-[30rem] max-w-full"><AISetupConnection v-bind="args" :state="state" /></div>'
  })
} satisfies Meta<Args>

export default meta
type Story = StoryObj<typeof meta>

export const OpenRouterSignIn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Sign in with OpenRouter' })).toBeVisible()
    await expect(canvas.getByText('Or paste an API key')).toBeVisible()
  }
}
export const OpenRouterWaiting: Story = {
  args: { signInStatus: 'waiting' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Finish signing in to OpenRouter in your browser.'
    )
    await expect(canvas.queryByRole('button', { name: 'Sign in with OpenRouter' })).toBeNull()
  }
}
export const OpenRouterVerifying: Story = { args: { signInStatus: 'verifying' } }
export const OpenRouterSignedIn: Story = {
  args: { account: { label: 'OpenPencil', freeTier: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Signed in to OpenRouter')
    await expect(canvas.queryByLabelText('API Key')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Test connection' })).toBeNull()
  }
}
export const OpenRouterSignedInWithoutCredits: Story = {
  args: { account: { label: 'OpenPencil', freeTier: true } }
}
export const OpenRouterPopupBlocked: Story = { args: { signInStatus: 'blocked' } }
export const OpenRouterFailed: Story = { args: { signInStatus: 'failed' } }
export const OpenRouterExpired: Story = { args: { signInStatus: 'expired' } }
export const SavedAPIKey: Story = {
  args: { providerID: 'anthropic', hasSavedKey: true, recommended: false }
}
export const LocalServer: Story = { args: { providerID: 'openai-compatible', recommended: false } }
export const CodingAgentInBrowser: Story = {
  args: {
    providerID: 'acp:claude-code',
    recommended: false,
    agentSetup: agentSetup({ supported: false })
  }
}
export const CodingAgentChecking: Story = {
  args: { providerID: 'acp:codex', recommended: false, agentSetup: agentSetup({ scanning: true }) }
}
export const CodingAgentInstalled: Story = {
  args: {
    providerID: 'acp:claude-code',
    recommended: false,
    agentSetup: agentSetup({ detected: detected('claude-code', 'available'), bridge: true })
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Install adapter' })).toBeNull()
    await expect(canvas.queryByText(/npm i -g/)).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Check again' })).toBeVisible()
  }
}
export const CodingAgentNeedsAdapter: Story = {
  args: {
    providerID: 'acp:codex',
    recommended: false,
    agentSetup: agentSetup({ detected: detected('codex', 'needs-adapter') })
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Install adapter' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Install MCP server' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Setup guide/ })).toHaveAttribute(
      'href',
      'https://openpencil.dev/programmable/coding-agents#codex'
    )
  }
}
export const CodingAgentNeedsNpm: Story = {
  args: {
    providerID: 'acp:claude-code',
    recommended: false,
    agentSetup: agentSetup({ detected: detected('claude-code', 'needs-adapter'), npm: false })
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('npm i -g @agentclientprotocol/claude-agent-acp')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Install adapter' })).toBeNull()
    await expect(canvas.getByText(/npm i -g @open-pencil\/mcp@/)).toBeVisible()
  }
}
