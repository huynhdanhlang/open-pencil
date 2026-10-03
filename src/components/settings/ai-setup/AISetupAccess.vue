<script setup lang="ts">
import { tv } from 'tailwind-variants'

import { useI18n } from '@open-pencil/vue'

import { modelProviderName } from '@/app/ai/models/provider-name'
import {
  ONBOARDING_AGENTS,
  ONBOARDING_API_PROVIDERS,
  ONBOARDING_SERVER_PROVIDER,
  type OnboardingAccess
} from '@/app/ai/models/settings/onboarding/plan'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'
import theme from '@/theme/settings/ai-setup/flow'

import SetupChoice from './SetupChoice.vue'

const { agentsAvailable } = defineProps<{ agentsAvailable: boolean }>()
const access = defineModel<OnboardingAccess[]>({ required: true })
const { ai } = useI18n()
const styles = tv(theme)()

function toggle(providerID: OnboardingAccess, checked: boolean): void {
  access.value = checked
    ? [...access.value, providerID]
    : access.value.filter((candidate) => candidate !== providerID)
}
</script>

<template>
  <section :class="styles.group()">
    <h3 :class="styles.groupHeading()">{{ ai.aiSetupAccessAgents }}</h3>
    <template v-if="agentsAvailable">
      <p :class="styles.help()">{{ ai.aiSetupAccessAgentsDescription }}</p>
      <SetupChoice
        v-for="agent in ONBOARDING_AGENTS"
        :key="agent"
        :label="modelProviderName(agent)"
      >
        <AppCheckbox
          :model-value="access.includes(agent)"
          :ariaLabel="modelProviderName(agent)"
          @update:model-value="toggle(agent, $event)"
        />
      </SetupChoice>
    </template>
    <AppAlert v-else :heading="ai.aiSetupAccessAgentsDesktop" />
  </section>
  <section :class="styles.group()">
    <h3 :class="styles.groupHeading()">{{ ai.aiSetupAccessAPI }}</h3>
    <SetupChoice
      v-for="provider in ONBOARDING_API_PROVIDERS"
      :key="provider"
      :label="modelProviderName(provider)"
    >
      <AppCheckbox
        :model-value="access.includes(provider)"
        :ariaLabel="modelProviderName(provider)"
        @update:model-value="toggle(provider, $event)"
      />
    </SetupChoice>
  </section>
  <section :class="styles.group()">
    <SetupChoice :label="ai.aiSetupAccessServer" :description="ai.aiSetupAccessServerDescription">
      <AppCheckbox
        :model-value="access.includes(ONBOARDING_SERVER_PROVIDER)"
        :ariaLabel="ai.aiSetupAccessServer"
        @update:model-value="toggle(ONBOARDING_SERVER_PROVIDER, $event)"
      />
    </SetupChoice>
  </section>
</template>
