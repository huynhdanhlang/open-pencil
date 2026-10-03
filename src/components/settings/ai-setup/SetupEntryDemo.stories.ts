import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'

import SetupEntryDemo from './SetupEntryDemo.vue'
interface Args {
  returning: boolean
  authenticationOutcome: 'success' | 'cancelled' | 'expired'
}
const meta = {
  title: 'Settings/AI Setup/Entry points',
  component: SetupEntryDemo,
  args: { returning: false, authenticationOutcome: 'success' },
  render: (args: Args) => ({
    components: { SetupEntryDemo },
    setup: () => ({ args }),
    template: '<SetupEntryDemo v-bind="args" />'
  }),
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Skippable guided onboarding over the same settings that power users edit directly; Advanced settings and the AI models screen stand in for the real ModelsPanel. UI-only adapter fixtures. OAuth callbacks arrive after a short simulated wait. Agent checks and model inventories are fixture outcomes, not live device/account inspection. Use dummy values in credential fields.'
      }
    }
  }
} satisfies Meta<Args>
export default meta
type Story = StoryObj<typeof meta>
export const FirstLaunch: Story = {}
export const ReturningUser: Story = { args: { returning: true } }

async function reachConnection(canvasElement: HTMLElement, account: string, vectors = false) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: 'Set up AI' }))
  if (vectors)
    await userEvent.click(canvas.getByRole('checkbox', { name: /Generate vector artwork/ }))
  await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
  await userEvent.click(canvas.getByRole('checkbox', { name: account }))
  await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
  await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
  return canvas
}
async function finish(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: 'Review assignments' }))
  await userEvent.click(canvas.getByRole('button', { name: 'Finish setup' }))
  await expect(canvas.getByRole('button', { name: 'Run guided setup' })).toBeVisible()
}
export const OpenRouterJourney: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await beginAuthorization(canvasElement)
    await expect(canvas.getByText('Waiting for OpenRouter…')).toBeVisible()
    await userEvent.click(await canvas.findByRole('button', { name: 'Done' }, { timeout: 5000 }))
    await finish(canvasElement)
    await expect(canvas.getByText('Claude Sonnet 5 — OpenRouter', { exact: true })).toBeVisible()
  }
}
export const AuthorizationExpired: Story = {
  args: { authenticationOutcome: 'expired' },
  play: async ({ canvasElement }) => {
    const canvas = await beginAuthorization(canvasElement)
    await expect(
      await canvas.findByText(
        'The sign-in link expired. Connect again to continue.',
        {},
        { timeout: 5000 }
      )
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Back to setup' }))
    await expect(canvas.getByRole('button', { name: 'Review assignments' })).toBeDisabled()
  }
}
export const LocalJourney: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await reachConnection(canvasElement, 'Local model or company server')
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Your server' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Check server' }))
    await expect(canvas.getByText('Server connected · 2 models available')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Test model and continue' }))
    await finish(canvasElement)
  }
}
export const GatewayVectorJourney: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await reachConnection(canvasElement, 'Vercel AI Gateway', true)
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Vercel AI Gateway' }))
    await userEvent.type(canvas.getByLabelText('AI Gateway API key'), 'storybook-fixture')
    await userEvent.click(canvas.getByRole('button', { name: 'Connect gateway' }))
    await finish(canvasElement)
    await expect(canvas.getByText('QuiverAI — Vercel AI Gateway', { exact: true })).toBeVisible()
  }
}
export const CodexJourney: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await reachConnection(canvasElement, 'ChatGPT or Codex')
    await userEvent.click(canvas.getByRole('button', { name: 'Connect Codex' }))
    await userEvent.click(canvas.getByRole('button', { name: 'View installation instructions' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in to Codex' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Check agent status' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Done' }))
    await finish(canvasElement)
  }
}
export const CancelChanges: Story = {
  args: { returning: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Run guided setup' }))
    await userEvent.click(canvas.getByRole('checkbox', { name: /Generate vector artwork/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }))
    await expect(canvas.getByText('Codex — agent-managed model', { exact: true })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Run guided setup' }))
    await expect(
      canvas.getByRole('checkbox', { name: /Generate vector artwork/ })
    ).not.toBeChecked()
  }
}
export const ApplyAndReopen: Story = {
  args: { returning: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Run guided setup' }))
    for (let i = 0; i < 3; i++)
      await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Review assignments' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Apply changes' }))
    await expect(canvas.getByText('Codex — agent-managed model', { exact: true })).toBeVisible()
    await expect(canvas.getByText('Claude Sonnet 5 — OpenRouter', { exact: true })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Run guided setup' }))
    await expect(canvas.getByRole('checkbox', { name: /Get design feedback/ })).toBeChecked()
  }
}

async function beginAuthorization(canvasElement: HTMLElement) {
  const canvas = await reachConnection(canvasElement, 'OpenRouter')
  await userEvent.click(canvas.getByRole('button', { name: 'Connect OpenRouter' }))
  await userEvent.click(canvas.getByRole('button', { name: 'Connect with OpenRouter' }))
  return canvas
}

export const CancelAuthorization: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await beginAuthorization(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    await expect(canvas.getByRole('button', { name: 'Connect with OpenRouter' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Back to setup' }))
    await expect(canvas.getByRole('button', { name: 'Review assignments' })).toBeDisabled()
  }
}

export const AdvancedSettingsExit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Set up AI' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Advanced settings' }))
    await expect(canvas.getByRole('heading', { name: 'AI models' })).toBeVisible()
    await expect(canvas.getAllByText('Not configured')).toHaveLength(3)
    await userEvent.click(canvas.getByRole('button', { name: 'Run guided setup' }))
    await expect(canvas.getByText('What would you like AI to do?')).toBeVisible()
  }
}
