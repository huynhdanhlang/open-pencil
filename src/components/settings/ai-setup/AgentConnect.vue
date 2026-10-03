<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { computed, ref } from 'vue'

import SettingsGroup from '@/components/settings/layout/SettingsGroup.vue'
import SettingsRow from '@/components/settings/layout/SettingsRow.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import theme from '@/theme/settings/ai-setup/agent-status'

import SetupScreen from './SetupScreen.vue'
type State = 'missing' | 'sign-in' | 'starting' | 'ready' | 'disconnected' | 'browser'
const { initialState = 'sign-in', agent = 'Codex' } = defineProps<{
  initialState?: State
  agent?: 'Codex' | 'Pi' | 'Claude Code' | string
}>()
const emit = defineEmits<{ install: []; signIn: []; start: [] }>()
const state = ref(initialState)
const styles = tv(theme)()
const installation = computed(() => (state.value === 'missing' ? 'Not found' : 'Installed'))
const account = computed(() =>
  ['sign-in', 'missing'].includes(state.value) ? 'Sign-in required' : 'Signed in'
)
function start() {
  state.value = 'starting'
  emit('start')
}
</script>
<template>
  <SetupScreen
    :heading="state === 'browser' ? `Use ${agent} in OpenPencil Desktop` : `Connect ${agent}`"
    :description="
      state === 'browser'
        ? 'This connection runs an agent on your computer and isn’t available in the browser.'
        : agent !== 'Pi'
          ? `Use ${agent} through its supported agent integration. Sign in to verify access.`
          : 'Run Pi through the OpenPencil Harness companion, then choose the provider account it will use.'
    "
  >
    <template v-if="state === 'browser'">
      <div class="flex justify-end">
        <AppButton color="primary" variant="solid" @click="emit('install')"
          >Get OpenPencil Desktop</AppButton
        >
      </div>
    </template>
    <template v-else>
      <SettingsGroup>
        <SettingsRow :label="`${agent} installation`">
          <span :class="styles.value()">{{ installation }}</span>
        </SettingsRow>
        <SettingsRow :label="agent === 'Pi' ? 'Provider account' : `${agent} account`">
          <span :class="styles.value()">{{ account }}</span>
        </SettingsRow>
        <SettingsRow label="Agent connection">
          <span :class="styles.value()" :data-state="state">
            {{
              state === 'ready'
                ? 'Ready'
                : state === 'starting'
                  ? 'Starting…'
                  : state === 'disconnected'
                    ? 'Disconnected'
                    : 'Not started'
            }}
          </span>
        </SettingsRow>
      </SettingsGroup>
      <template v-if="state === 'missing'"
        ><p class="text-sm text-muted">
          {{
            agent === 'Pi'
              ? 'Install the companion before connecting. A companion installation does not include provider access.'
              : `Install ${agent}, then return here to check the installation.`
          }}
        </p>
        <AppButton class="self-start" variant="outline" @click="emit('install')"
          >View installation instructions</AppButton
        ><AppButton class="self-start" variant="outline" @click="emit('start')"
          >Check again</AppButton
        ></template
      >
      <template v-else-if="state === 'sign-in'">
        <p class="text-sm text-muted">Sign in with {{ agent }} to continue, then return here.</p>
        <AppButton class="self-end" color="primary" variant="solid" @click="emit('signIn')">{{
          agent === 'Pi' ? 'Choose provider account' : `Sign in to ${agent}`
        }}</AppButton>
      </template>
      <template v-else-if="state === 'starting'"
        ><AppAlert heading="Starting the agent and connecting OpenPencil tools…" />
        <AppButton class="self-start" variant="outline" @click="state = 'disconnected'"
          >Cancel</AppButton
        ></template
      >
      <template v-else-if="state === 'disconnected'"
        ><AppAlert
          tone="warning"
          heading="The agent stopped."
          description="Your document is unchanged. Reconnect to continue."
        />
        <AppButton class="self-end" color="primary" variant="solid" @click="start"
          >Reconnect</AppButton
        ></template
      >
      <template v-else
        ><AppAlert
          tone="success"
          :heading="`${agent} is ready to edit your document.`"
          description="Model selection is managed by the agent. A separate visual-feedback API is not configured."
        />
        <AppButton class="self-end" color="primary" variant="solid" @click="emit('start')"
          >Done</AppButton
        ></template
      >
    </template>
  </SetupScreen>
</template>
