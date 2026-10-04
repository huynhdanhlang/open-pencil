import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'

import AISetupConnection from './AISetupConnection.vue'

interface Args {
  providerID: 'openrouter' | 'anthropic' | 'openai-compatible' | 'acp:claude-code'
  signInStatus: 'idle' | 'waiting' | 'blocked' | 'cancelled' | 'expired' | 'failed'
  hasSavedKey: boolean
  recommended: boolean
}

const meta = {
  title: 'Settings/AI Setup/Connection',
  args: { providerID: 'openrouter', signInStatus: 'idle', hasSavedKey: false, recommended: true },
  render: (args) => ({
    components: { AISetupConnection },
    setup: () => ({
      args,
      state: { apiKey: '', customBaseURL: '', customModelID: '', test: 'idle', reason: null }
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
export const OpenRouterPopupBlocked: Story = { args: { signInStatus: 'blocked' } }
export const OpenRouterFailed: Story = { args: { signInStatus: 'failed' } }
export const OpenRouterExpired: Story = { args: { signInStatus: 'expired' } }
export const SavedAPIKey: Story = {
  args: { providerID: 'anthropic', hasSavedKey: true, recommended: false }
}
export const LocalServer: Story = { args: { providerID: 'openai-compatible', recommended: false } }
export const CodingAgent: Story = { args: { providerID: 'acp:claude-code', recommended: false } }
