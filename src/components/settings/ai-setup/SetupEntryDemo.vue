<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'
import { ref } from 'vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

import AgentConnect from './AgentConnect.vue'
import AIConnectionsPanel from './AIConnectionsPanel.vue'
import AISetupWizard from './AISetupWizard.vue'
import GatewayConnect from './GatewayConnect.vue'
import LocalServerConnect from './LocalServerConnect.vue'
import OpenRouterConnect from './OpenRouterConnect.vue'
import type { SetupAnswers } from './recommendations'
import SetupScreen from './SetupScreen.vue'
import WelcomeScreen from './WelcomeScreen.vue'

const { returning = false, authenticationOutcome = 'success' } = defineProps<{
  returning?: boolean
  authenticationOutcome?: 'success' | 'cancelled' | 'expired'
}>()
const screen = ref(returning ? 'settings' : 'welcome')
const assignments = ref<Record<string, string>>(
  returning ? { 'Create and edit designs': 'codex-agent' } : {}
)
const savedAnswers = ref<SetupAnswers>(
  returning
    ? { accounts: ['codex', 'openrouter'], goals: ['editing', 'vision'], spending: 'metered' }
    : { accounts: [], goals: ['editing'], spending: 'existing' }
)
const editingExisting = ref(returning)
const wizardOpen = ref(false)
const connected = ref<string[]>(returning ? ['Codex', 'OpenRouter'] : [])
const provider = ref('OpenRouter')
const routerState = ref<'disconnected' | 'waiting' | 'connected' | 'cancelled' | 'expired'>(
  'disconnected'
)
const agentState = ref<'missing' | 'sign-in' | 'starting' | 'ready'>('missing')
const localState = ref<'idle' | 'discovered' | 'manual'>('idle')
const revision = ref(0)
const manual = ref(false)

function openWizard() {
  manual.value = false
  wizardOpen.value = true
  screen.value = 'wizard'
}

function cancelWizard() {
  stopAuthorization()
  wizardOpen.value = false
  screen.value = editingExisting.value ? 'settings' : 'welcome'
}

function apply(next: Record<string, string>, answers: SetupAnswers) {
  assignments.value = next
  savedAnswers.value = answers
  editingExisting.value = true
  wizardOpen.value = false
  screen.value = 'settings'
}
function startConnection(name: string) {
  stopAuthorization()
  provider.value = name
  routerState.value = 'disconnected'
  agentState.value = 'missing'
  localState.value = 'idle'
  revision.value++
  screen.value = 'connect'
}
function finishConnection() {
  if (!connected.value.includes(provider.value)) connected.value.push(provider.value)
  screen.value = manual.value ? 'settings' : 'wizard'
}
const { start: startAuthorization, stop: stopAuthorization } = useTimeoutFn(
  () => {
    routerState.value = authenticationOutcome === 'success' ? 'connected' : authenticationOutcome
    revision.value++
  },
  1200,
  { immediate: false }
)

function authorize() {
  routerState.value = 'waiting'
  revision.value++
  startAuthorization()
}

function cancelAuthorization() {
  stopAuthorization()
  routerState.value = 'disconnected'
  revision.value++
}

function backToSetup() {
  cancelAuthorization()
  screen.value = manual.value ? 'manual' : 'wizard'
}
function nextAgent() {
  const next = {
    missing: 'sign-in',
    'sign-in': 'starting',
    starting: 'ready',
    ready: 'ready'
  } as const
  agentState.value = next[agentState.value]
  revision.value++
}
function discover() {
  localState.value = manual.value ? 'manual' : 'discovered'
  revision.value++
}
function leaveManual() {
  manual.value = false
  screen.value = 'wizard'
}
function manageConnection(name: string) {
  manual.value = true
  startConnection(name)
}

function openManual() {
  manual.value = true
  screen.value = 'manual'
}
</script>
<template>
  <WelcomeScreen v-if="screen === 'welcome'" @setup="openWizard" @skip="screen = 'editor'" />
  <div v-show="screen === 'wizard'" v-if="wizardOpen">
    <AISetupWizard
      :mode="editingExisting ? 'adjust' : 'initial'"
      :initial-answers="savedAnswers"
      :existing-assignments="assignments"
      :verified-connections="connected"
      @manual="openManual"
      @connect="startConnection"
      @cancel="cancelWizard"
      @applied="apply"
    />
  </div>
  <div v-if="screen === 'connect'" class="flex flex-col gap-3">
    <OpenRouterConnect
      v-if="provider === 'OpenRouter'"
      :key="revision"
      :initial-state="routerState"
      @authorize="authorize"
      @cancel="cancelAuthorization"
      @connect-key="authorize"
      @done="finishConnection"
    />
    <GatewayConnect
      v-else-if="provider === 'Vercel AI Gateway'"
      @connected="finishConnection"
      @back="screen = 'wizard'"
    />
    <LocalServerConnect
      v-else-if="provider === 'Your server'"
      :key="revision"
      :initial-state="localState"
      :proxy="manual"
      @check="discover"
      @connect="finishConnection"
    />
    <AgentConnect
      v-else
      :key="revision"
      :agent="provider"
      :initial-state="agentState"
      @install="nextAgent"
      @sign-in="nextAgent"
      @start="agentState === 'ready' ? finishConnection() : nextAgent()"
    />
    <div class="mx-auto flex w-full max-w-xl justify-between">
      <AppButton @click="backToSetup">Back to setup</AppButton
      ><AppButton v-if="agentState === 'starting'" @click="nextAgent">Check agent status</AppButton>
    </div>
  </div>
  <SetupScreen
    v-if="screen === 'manual'"
    heading="Manual configuration"
    description="Connect access first, then assign models to tasks."
  >
    <AppSelect
      v-model="provider"
      label="Connection type"
      :options="
        ['OpenRouter', 'Vercel AI Gateway', 'Your server', 'Codex', 'Claude Code'].map((value) => ({
          value,
          label: value
        }))
      "
    />
    <template #footer
      ><AppButton @click="leaveManual">Back</AppButton
      ><AppButton color="primary" variant="solid" @click="startConnection(provider)"
        >Configure connection</AppButton
      ></template
    >
  </SetupScreen>
  <AIConnectionsPanel
    v-if="screen === 'settings'"
    :connected="connected"
    :assignments="assignments"
    @review="openWizard"
    @add="openManual"
    @manage="manageConnection"
    @save="assignments = $event"
  />
  <SetupScreen
    v-if="screen === 'editor'"
    heading="Start designing"
    description="The editor opens without configuring AI. You can return to AI setup from Settings."
  />
</template>
