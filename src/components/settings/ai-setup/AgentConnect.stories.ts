import type { Meta, StoryObj } from '@storybook/vue3-vite'

import AgentConnect from './AgentConnect.vue'
interface Args {
  initialState: 'missing' | 'sign-in' | 'starting' | 'ready' | 'disconnected' | 'browser'
  agent: 'Codex' | 'Pi'
}
const meta = {
  title: 'Settings/AI Setup/Agent',
  component: AgentConnect,
  args: { initialState: 'sign-in', agent: 'Codex' },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Proposed adapter states, not currently implemented capabilities. Existing ACP initializes an agent session; the Harness companion launches a separate process. Installation, account authentication, and session readiness must be reported independently. Subscription eligibility must be verified for the specific adapter; agent identity alone does not establish billing.'
      }
    }
  },
  render: (args) => ({
    components: { AgentConnect },
    setup: () => ({ args }),
    template: '<AgentConnect v-bind="args" />'
  })
} satisfies Meta<Args>
export default meta
type Story = StoryObj<typeof meta>
export const SignInRequired: Story = {}
export const NotInstalled: Story = { args: { initialState: 'missing' } }
export const Starting: Story = { args: { initialState: 'starting' } }
export const Ready: Story = { args: { initialState: 'ready' } }
export const Disconnected: Story = { args: { initialState: 'disconnected' } }
export const DesktopRequired: Story = { args: { initialState: 'browser' } }
export const PiCompanionMissing: Story = { args: { agent: 'Pi', initialState: 'missing' } }
