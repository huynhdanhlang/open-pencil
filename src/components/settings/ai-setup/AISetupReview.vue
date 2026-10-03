<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { modelProviderName } from '@/app/ai/models/provider-name'
import {
  isOnboardingAgent,
  type OnboardingGoal,
  type OnboardingPlan,
  type PlannedModel
} from '@/app/ai/models/settings/onboarding/plan'
import SettingsGroup from '@/components/settings/layout/SettingsGroup.vue'
import SettingsRow from '@/components/settings/layout/SettingsRow.vue'

const { plan, goals } = defineProps<{ plan: OnboardingPlan; goals: OnboardingGoal[] }>()
const { ai } = useI18n()

function modelLabel(model: PlannedModel): string {
  const provider = modelProviderName(model.providerID)
  if (isOnboardingAgent(model.providerID)) return `${provider} · ${ai.value.aiSetupAgentModel}`
  return model.modelID ? `${model.name} · ${provider}` : provider
}

function visionLabel(): string {
  const { vision } = plan
  if (vision === 'design') return ai.value.modelRoleUseDesign
  return vision ? modelLabel(vision) : ai.value.noModel
}

const rows = computed(() => {
  const result: { role: OnboardingGoal; label: string; value: string }[] = []
  if (goals.includes('design')) {
    result.push({
      role: 'design',
      label: ai.value.modelRoleDesign,
      value: plan.design ? modelLabel(plan.design) : ai.value.noModel
    })
  }
  if (goals.includes('vision')) {
    result.push({ role: 'vision', label: ai.value.modelRoleVision, value: visionLabel() })
  }
  return result
})
</script>

<template>
  <SettingsGroup>
    <SettingsRow
      v-for="row in rows"
      :key="row.role"
      :label="row.label"
      :description="row.value"
      :data-model-role="row.role"
    />
  </SettingsGroup>
</template>
