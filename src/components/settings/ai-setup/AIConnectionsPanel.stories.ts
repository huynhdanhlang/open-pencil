import type { Meta, StoryObj } from '@storybook/vue3-vite'

import AIConnectionsPanel from './AIConnectionsPanel.vue'
const meta = {
  title: 'Settings/AI Setup/Connections',
  component: AIConnectionsPanel,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Example with Codex and OpenRouter connected. Task assignments are local story state; management actions are integration boundaries, not live operations.'
      }
    }
  }
} satisfies Meta<typeof AIConnectionsPanel>
export default meta
export const SubscriptionWithPaidVision: StoryObj<typeof meta> = {}
