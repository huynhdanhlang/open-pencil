import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'

import AISetupWizard from './AISetupWizard.vue'
import type { SetupAnswers } from './recommendations'
interface Args {
  initialAnswers: SetupAnswers
  initialStep: number
  verifiedConnections: string[]
}
const meta = {
  title: 'Settings/AI Setup/Guided setup',
  component: AISetupWizard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Recommendation UX study. Account answers do not prove entitlement. Connection events are adapter boundaries; verifiedConnections supplies independently verified fixture outcomes. No live billing or authentication.'
      }
    }
  },
  args: {
    initialAnswers: { accounts: [], goals: ['editing'], spending: 'existing' },
    initialStep: 0,
    verifiedConnections: []
  },
  render: (args) => ({
    components: { AISetupWizard },
    setup: () => ({ args }),
    template: '<AISetupWizard v-bind="args" />'
  })
} satisfies Meta<Args>
export default meta
type Story = StoryObj<typeof meta>
export const Goals: Story = {}
export const ClaudeCodeNoExtraSpending: Story = {
  args: {
    initialStep: 3,
    initialAnswers: { accounts: ['claude'], goals: ['editing'], spending: 'existing' }
  }
}
export const SubscriptionWithVisualReview: Story = {
  args: {
    initialStep: 3,
    initialAnswers: { accounts: ['codex'], goals: ['editing', 'vision'], spending: 'metered' }
  }
}
export const FirstAIAccount: Story = {
  args: {
    initialStep: 3,
    initialAnswers: { accounts: [], goals: ['editing', 'vision'], spending: 'metered' }
  }
}
export const GatewayWithVectors: Story = {
  args: {
    initialStep: 3,
    initialAnswers: { accounts: ['gateway'], goals: ['editing', 'vectors'], spending: 'existing' }
  }
}
export const LocalOnly: Story = {
  args: {
    initialStep: 3,
    initialAnswers: { accounts: ['local'], goals: ['editing', 'vision'], spending: 'existing' }
  }
}
export const ReviewAssignments: Story = {
  args: {
    initialStep: 4,
    initialAnswers: { accounts: ['codex'], goals: ['editing', 'vision'], spending: 'metered' },
    verifiedConnections: ['Codex', 'OpenRouter']
  }
}
export const BillingPreference: Story = {
  args: {
    initialStep: 2,
    initialAnswers: { accounts: [], goals: ['editing'], spending: 'existing' }
  }
}
export const WalkThroughGoals: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(canvas.getByText('What do you already use?')).toBeVisible()
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Claude or Claude Code' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }))
    await expect(canvas.getByText('Claude Code', { exact: true })).toBeVisible()
    await expect(canvas.queryByText('Why OpenRouter?')).not.toBeInTheDocument()
  }
}
