import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'

import OpenRouterConnect from './OpenRouterConnect.vue'
interface Args {
  initialState: 'disconnected' | 'waiting' | 'cancelled' | 'expired' | 'connected'
}
const meta = {
  title: 'Settings/AI Setup/OpenRouter',
  component: OpenRouterConnect,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'UI-only contract study. Authorization opens an external browser in production; fixtures supply callback outcomes. No real account data or network calls. Based on OpenRouter OAuth PKCE documentation.'
      }
    }
  },
  args: { initialState: 'disconnected' },
  render: (args) => ({
    components: { OpenRouterConnect },
    setup: () => ({ args }),
    template: '<OpenRouterConnect v-bind="args" />'
  })
} satisfies Meta<Args>
export default meta
type Story = StoryObj<typeof meta>
export const Connect: Story = {}
export const AwaitingAuthorization: Story = { args: { initialState: 'waiting' } }
export const AuthorizationCancelled: Story = { args: { initialState: 'cancelled' } }
export const AuthorizationExpired: Story = { args: { initialState: 'expired' } }
export const Connected: Story = { args: { initialState: 'connected' } }
export const ConnectionDoesNotAssignTasks: Story = {
  args: { initialState: 'connected' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Use for design' })).not.toBeInTheDocument()
  }
}
export const StartAuthorization: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Connect with OpenRouter' }))
    await expect(canvas.getByText('Waiting for OpenRouter…')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    await expect(canvas.getByRole('button', { name: 'Connect with OpenRouter' })).toBeVisible()
  }
}
