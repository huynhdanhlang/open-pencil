<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { computed, ref } from 'vue'

import { IS_TAURI } from '@open-pencil/core/constants'
import { useI18n } from '@open-pencil/vue'

import type { OnboardingConnectionPatch } from '@/app/ai/models/settings/onboarding/connections'
import type { AISetupEntry } from '@/app/ai/models/settings/onboarding/dialog'
import {
  ONBOARDING_GOALS,
  type OnboardingAccess,
  type OnboardingGoal,
  type OnboardingSpending
} from '@/app/ai/models/settings/onboarding/plan'
import { AI_SETUP_STEPS, useAIOnboarding } from '@/app/ai/models/settings/onboarding/use'
import SettingsSaveFeedback from '@/components/settings/layout/SettingsSaveFeedback.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import { AppDialogBody, AppDialogFooter, AppDialogHeader } from '@/components/ui/dialog'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'
import AppRadioGroup from '@/components/ui/toggle/AppRadioGroup.vue'
import theme from '@/theme/settings/ai-setup/flow'

import AISetupAccess from './AISetupAccess.vue'
import AISetupConnection from './AISetupConnection.vue'
import AISetupReview from './AISetupReview.vue'
import SetupChoice from './SetupChoice.vue'

const { entry, agentsAvailable = IS_TAURI } = defineProps<{
  entry: AISetupEntry
  agentsAvailable?: boolean
}>()
const emit = defineEmits<{ close: []; advanced: [] }>()
const { ai, common } = useI18n()
const styles = tv(theme)()

const onboarding = useAIOnboarding({ agentsAvailable })
const { answers, step, plan, hasProposal, busy, saveResult, canContinue } = onboarding
const phase = ref<'welcome' | 'wizard' | 'saved'>(entry === 'welcome' ? 'welcome' : 'wizard')

const goals = computed(() => [
  {
    id: 'design' as const,
    label: ai.value.aiSetupGoalDesign,
    description: ai.value.aiSetupGoalDesignDescription
  },
  {
    id: 'vision' as const,
    label: ai.value.aiSetupGoalVision,
    description: ai.value.aiSetupGoalVisionDescription
  }
])
const spendingOptions = computed<{ value: OnboardingSpending; label: string }[]>(() => [
  { value: 'existing', label: ai.value.aiSetupSpendingExisting },
  { value: 'metered', label: ai.value.aiSetupSpendingMetered }
])

const header = computed(() => {
  if (phase.value === 'welcome') {
    return {
      heading: ai.value.aiSetupWelcomeTitle,
      description: ai.value.aiSetupWelcomeDescription
    }
  }
  if (phase.value === 'saved') {
    return { heading: ai.value.aiSetupSavedTitle, description: ai.value.aiSetupSavedDescription }
  }
  const headings = {
    goals: ai.value.aiSetupGoalsTitle,
    access: ai.value.aiSetupAccessTitle,
    spending: ai.value.aiSetupSpendingTitle,
    connect: ai.value.aiSetupConnectTitle,
    review: ai.value.aiSetupReviewTitle
  }
  return {
    heading: headings[step.value],
    description: ai.value.aiSetupProgress({
      current: AI_SETUP_STEPS.indexOf(step.value) + 1,
      total: AI_SETUP_STEPS.length
    })
  }
})

function toggleGoal(goal: OnboardingGoal, checked: boolean): void {
  answers.goals = ONBOARDING_GOALS.filter((candidate) =>
    candidate === goal ? checked : answers.goals.includes(candidate)
  )
}

function updateConnection(providerID: OnboardingAccess, patch: OnboardingConnectionPatch): void {
  Object.assign(onboarding.connection(providerID), patch)
  onboarding.resetTest(providerID)
}

function back(): void {
  if (onboarding.back()) return
  if (entry === 'welcome') phase.value = 'welcome'
  else emit('close')
}

async function finish(): Promise<void> {
  if ((await onboarding.apply()) === 'saved') phase.value = 'saved'
}
</script>

<template>
  <AppDialogHeader
    :heading="header.heading"
    :description="header.description"
    :close-label="common.close"
  >
    <template #actions>
      <AppButton v-if="phase === 'wizard'" size="xs" class="mr-1 ml-auto" @click="emit('advanced')">
        {{ ai.aiSetupAdvanced }}
      </AppButton>
    </template>
  </AppDialogHeader>

  <AppDialogBody>
    <div :class="styles.body()" :data-ai-setup-step="phase === 'wizard' ? step : phase">
      <section v-if="phase === 'welcome'" :class="styles.intro()">
        <h3 :class="styles.introHeading()">{{ ai.aiSetupWelcomeAITitle }}</h3>
        <p :class="styles.introText()">{{ ai.aiSetupWelcomeAIDescription }}</p>
      </section>

      <template v-else-if="phase === 'saved'">
        <AISetupReview :plan="plan" :goals="answers.goals" />
      </template>

      <template v-else-if="step === 'goals'">
        <SetupChoice
          v-for="goal in goals"
          :key="goal.id"
          :label="goal.label"
          :description="goal.description"
        >
          <AppCheckbox
            :model-value="answers.goals.includes(goal.id)"
            :ariaLabel="goal.label"
            @update:model-value="toggleGoal(goal.id, $event)"
          />
        </SetupChoice>
      </template>

      <template v-else-if="step === 'access'">
        <p :class="styles.help()">{{ ai.aiSetupAccessDescription }}</p>
        <AISetupAccess v-model="answers.access" :agents-available="agentsAvailable" />
      </template>

      <template v-else-if="step === 'spending'">
        <p :class="styles.help()">{{ ai.aiSetupSpendingDescription }}</p>
        <AppRadioGroup
          v-model="answers.spending"
          :label="ai.aiSetupSpendingTitle"
          :options="spendingOptions"
          :ui="{ root: 'gap-3', option: styles.choice() }"
        />
      </template>

      <template v-else-if="step === 'connect'">
        <AppAlert
          v-if="!hasProposal"
          tone="warning"
          :heading="ai.aiSetupNothingTitle"
          :description="ai.aiSetupNothingDescription"
        />
        <AppAlert
          v-else-if="!plan.connections.length"
          tone="success"
          :heading="ai.aiSetupAlreadyConnected"
        />
        <AISetupConnection
          v-for="providerID in plan.connections"
          :key="providerID"
          :provider-i-d="providerID"
          :state="onboarding.connection(providerID)"
          :has-saved-key="onboarding.hasSavedKey(providerID)"
          :recommended="!answers.access.includes(providerID)"
          :disabled="busy"
          @update="updateConnection(providerID, $event)"
          @test="onboarding.testConnection(providerID)"
        />
      </template>

      <template v-else>
        <p :class="styles.help()">{{ ai.aiSetupReviewDescription }}</p>
        <AISetupReview :plan="plan" :goals="answers.goals" />
        <SettingsSaveFeedback
          :result="saveResult"
          :error="saveResult === 'saved' ? null : saveResult"
        />
      </template>
    </div>
  </AppDialogBody>

  <AppDialogFooter :ui="{ footer: 'justify-between' }">
    <template v-if="phase === 'welcome'">
      <AppButton variant="outline" @click="emit('close')">{{ ai.aiSetupSkip }}</AppButton>
      <AppButton color="primary" variant="solid" @click="phase = 'wizard'">
        {{ ai.aiSetupStart }}
      </AppButton>
    </template>
    <template v-else-if="phase === 'saved'">
      <AppButton class="ml-auto" color="primary" variant="solid" @click="emit('close')">
        {{ common.done }}
      </AppButton>
    </template>
    <template v-else>
      <AppButton :disabled="busy" @click="back">{{ common.back }}</AppButton>
      <AppButton
        v-if="step === 'review'"
        color="primary"
        variant="solid"
        :disabled="busy"
        @click="finish"
      >
        {{ ai.aiSetupFinish }}
      </AppButton>
      <AppButton
        v-else
        color="primary"
        variant="solid"
        :disabled="!canContinue"
        @click="onboarding.next()"
      >
        {{ ai.aiSetupContinue }}
      </AppButton>
    </template>
  </AppDialogFooter>
</template>
