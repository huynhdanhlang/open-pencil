<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { tv } from 'tailwind-variants'
import { computed } from 'vue'

import { ACP_AGENTS, AI_PROVIDERS } from '@open-pencil/core/constants'
import { useI18n } from '@open-pencil/vue'

import { modelProviderName } from '@/app/ai/models/provider-name'
import type {
  OnboardingConnectionPatch,
  OnboardingConnectionState
} from '@/app/ai/models/settings/onboarding/connections'
import {
  isOnboardingAgent,
  ONBOARDING_SERVER_PROVIDER,
  type OnboardingAccess
} from '@/app/ai/models/settings/onboarding/plan'
import ProviderConnectionTestButton from '@/components/chat/ProviderConnectionTestButton.vue'
import ProviderSettingsField from '@/components/settings/provider/ProviderSettingsField.vue'
import ProviderSettingsInput from '@/components/settings/provider/ProviderSettingsInput.vue'
import ProviderSettingsKeyField from '@/components/settings/provider/ProviderSettingsKeyField.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import theme from '@/theme/settings/ai-setup/flow'

const {
  providerID,
  state,
  hasSavedKey = false,
  recommended = false,
  disabled = false
} = defineProps<{
  providerID: OnboardingAccess
  state: OnboardingConnectionState
  /** A key saved for the connection that matches what is entered now. */
  hasSavedKey?: boolean
  /** Suggested for pay-as-you-go rather than chosen by the person. */
  recommended?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ update: [patch: OnboardingConnectionPatch]; test: [] }>()
const { ai, common, credentials, settings } = useI18n()
const styles = tv(theme)()
const { copy, copied } = useClipboard({ copiedDuring: 1500 })

const name = computed(() =>
  providerID === ONBOARDING_SERVER_PROVIDER
    ? ai.value.aiSetupAccessServer
    : modelProviderName(providerID)
)
const agent = computed(() =>
  isOnboardingAgent(providerID)
    ? ACP_AGENTS.find((candidate) => `acp:${candidate.id}` === providerID)
    : undefined
)
const provider = computed(() => AI_PROVIDERS.find((candidate) => candidate.id === providerID))
const server = computed(() => providerID === ONBOARDING_SERVER_PROVIDER)
const keyHint = computed(() => {
  if (hasSavedKey) return settings.value.savedCredentialHint
  return server.value ? ai.value.aiSetupServerKeyHint : undefined
})
</script>

<template>
  <section :class="styles.connection()" :data-provider="providerID">
    <h3 :class="styles.connectionHeading()">{{ name }}</h3>

    <template v-if="agent">
      <p :class="styles.help()">{{ ai.aiSetupAgentDescription({ agent: agent.name }) }}</p>
      <template v-if="agent.installCommand">
        <p :class="styles.help()">{{ ai.aiSetupAgentInstall }}</p>
        <div :class="styles.command()">
          <code>{{ agent.installCommand }}</code>
          <AppButton size="xs" @click="copy(agent.installCommand)">
            {{ copied ? common.copied : common.copy }}
          </AppButton>
        </div>
      </template>
    </template>

    <template v-else>
      <p v-if="recommended" :class="styles.help()">{{ ai.aiSetupMeteredNote }}</p>
      <template v-if="server">
        <ProviderSettingsField v-slot="{ control }" :label="ai.baseURL">
          <ProviderSettingsInput
            v-bind="control"
            :model-value="state.customBaseURL"
            :aria-label="ai.baseURL"
            :placeholder="ai.baseURLPlaceholder"
            @update:model-value="emit('update', { customBaseURL: String($event) })"
          />
        </ProviderSettingsField>
        <ProviderSettingsField v-slot="{ control }" :label="ai.modelID">
          <ProviderSettingsInput
            v-bind="control"
            :model-value="state.customModelID"
            :aria-label="ai.modelID"
            @update:model-value="emit('update', { customModelID: String($event) })"
          />
        </ProviderSettingsField>
      </template>
      <ProviderSettingsKeyField
        :model-value="state.apiKey"
        :label="ai.apiKey"
        :saved="hasSavedKey"
        :hint="keyHint"
        kind="api"
        :placeholder="hasSavedKey ? credentials.savedReplace : (provider?.keyPlaceholder ?? '')"
        :key-u-r-l="provider?.keyURL"
        :key-u-r-l-label="credentials.getAPIKey"
        @update:model-value="emit('update', { apiKey: $event })"
      />
      <ProviderConnectionTestButton
        :status="state.test"
        :reason="state.reason"
        :disabled="disabled"
        @test="emit('test')"
      />
    </template>
  </section>
</template>
