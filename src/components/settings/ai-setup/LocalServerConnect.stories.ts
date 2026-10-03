import type { Meta, StoryObj } from '@storybook/vue3-vite'

import LocalServerConnect from './LocalServerConnect.vue'
interface Args {
  initialState: 'idle' | 'unreachable' | 'discovered' | 'manual'
  proxy: boolean
}
const meta = {
  title: 'Settings/AI Setup/Local and proxy',
  component: LocalServerConnect,
  args: { initialState: 'idle', proxy: false },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'No requests are sent. Model inventory is fixture data, not a statement about installed models or verified tool support.'
      }
    }
  },
  render: (args) => ({
    components: { LocalServerConnect },
    setup: () => ({ args }),
    template: '<LocalServerConnect v-bind="args" />'
  })
} satisfies Meta<Args>
export default meta
type Story = StoryObj<typeof meta>
export const Ollama: Story = {}
export const ServerUnreachable: Story = { args: { initialState: 'unreachable' } }
export const ModelsDiscovered: Story = { args: { initialState: 'discovered' } }
export const ProxyManualModel: Story = { args: { initialState: 'manual', proxy: true } }
