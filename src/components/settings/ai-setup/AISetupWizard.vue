<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { computed, reactive, ref } from 'vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppCheckbox from '@/components/ui/toggle/AppCheckbox.vue'
import theme from '@/theme/settings/ai-setup/wizard'

import { accounts, goals, proposeSetup, type SetupAnswers } from './recommendations'
import SetupActions from './SetupActions.vue'
import SetupChoice from './SetupChoice.vue'
import TaskAssignmentReview from './TaskAssignmentReview.vue'
const {
  initialAnswers,
  initialStep = 0,
  verifiedConnections = [],
  mode = 'initial',
  existingAssignments = {}
} = defineProps<{
  initialAnswers?: SetupAnswers
  initialStep?: number
  verifiedConnections?: string[]
  mode?: 'initial' | 'adjust'
  existingAssignments?: Record<string, string>
}>()
const emit = defineEmits<{
  connect: [provider: string]
  manual: []
  cancel: []
  applied: [assignments: Record<string, string>, answers: SetupAnswers]
}>()
const answers = reactive<SetupAnswers>({
  accounts: [...(initialAnswers?.accounts ?? [])],
  goals: [...(initialAnswers?.goals ?? ['editing'])],
  spending: initialAnswers?.spending ?? 'existing'
})
const step = ref(initialStep)
const applied = ref(false)
const styles = tv(theme)()
const proposals = computed(() => proposeSetup(answers))
const required = computed(() => [
  ...new Set(proposals.value.flatMap((item) => (item.requires ? [item.requires] : [])))
])
const titles = [
  'What would you like AI to do?',
  'What do you already use?',
  'Include pay-as-you-go models?',
  'Connect recommended access',
  'Your AI setup'
]
const waiting = ref('')
function toggle<T>(list: T[], value: T, checked: boolean) {
  const index = list.indexOf(value)
  if (checked && index === -1) list.push(value)
  if (!checked && index !== -1) list.splice(index, 1)
}
function connect(provider: string) {
  waiting.value = provider
  emit('connect', provider)
}
function goBack() {
  if (step.value === 0) emit('cancel')
  else step.value--
}

function confirm(assignments: Record<string, string>) {
  applied.value = true
  emit('applied', assignments, {
    accounts: [...answers.accounts],
    goals: [...answers.goals],
    spending: answers.spending
  })
}
</script>
<template>
  <main :class="styles.root()">
    <header :class="styles.header()">
      <span :class="styles.help()"
        >{{ mode === 'adjust' ? 'Adjust your AI setup' : 'AI setup' }} · {{ step + 1 }} of 5</span
      ><AppButton @click="emit('manual')">Manual configuration</AppButton>
    </header>
    <h1 :class="styles.heading()">{{ applied ? 'Your setup is saved' : titles[step] }}</h1>
    <div v-if="applied" class="mt-3 text-xs text-muted">
      You can change connections and task assignments independently in Settings.
    </div>
    <div v-else :class="styles.body()" class="mt-4">
      <template v-if="step === 0">
        <p :class="styles.help()">
          {{
            mode === 'adjust'
              ? 'Review your workflow and existing access. Working assignments will be kept unless you change them.'
              : 'Choose what you want to do. We’ll recommend a setup for you.'
          }}
        </p>
        <SetupChoice
          v-for="goal in goals"
          :key="goal.id"
          :label="goal.label"
          :description="goal.description"
        >
          <AppCheckbox
            :model-value="answers.goals.includes(goal.id)"
            :ariaLabel="goal.label"
            @update:model-value="toggle(answers.goals, goal.id, $event)"
          />
        </SetupChoice>
        <p :class="styles.help()">You can change these choices later.</p>
      </template>
      <template v-else-if="step === 1">
        <p :class="styles.help()">We’ll help you get started with the accounts you have.</p>
        <p :class="styles.help()">
          Select all that apply. If you don’t have an account yet, just continue.
        </p>
        <SetupChoice v-for="account in accounts" :key="account.value" :label="account.label">
          <AppCheckbox
            :model-value="answers.accounts.includes(account.value)"
            :ariaLabel="account.label"
            @update:model-value="toggle(answers.accounts, account.value, $event)"
          />
        </SetupChoice>
      </template>
      <template v-else-if="step === 2">
        <p :class="styles.help()">
          Additional models can provide visual feedback or generate vector artwork. Requests are
          billed to the API or gateway account you connect, separately from your AI subscriptions.
        </p>
        <SetupChoice label="Use my existing accounts only">
          <input v-model="answers.spending" type="radio" value="existing" name="spending" />
        </SetupChoice>
        <SetupChoice label="Include pay-as-you-go options">
          <input v-model="answers.spending" type="radio" value="metered" name="spending" />
        </SetupChoice>
        <p :class="styles.help()">Choosing an option here only changes our recommendations.</p>
      </template>
      <template v-else-if="step === 3">
        <div v-for="provider in required" :key="provider" :class="styles.row()">
          <div class="flex items-center justify-between gap-3">
            <strong>{{ provider }}</strong>
            <span v-if="verifiedConnections.includes(provider)">Connected</span>
            <AppButton v-else color="primary" variant="solid" @click="connect(provider)"
              >Connect {{ provider }}</AppButton
            >
          </div>
          <p :class="styles.help()">
            {{ proposals.find((item) => item.requires === provider)?.reason }}
          </p>
          <p class="text-[11px] text-muted">
            {{ proposals.find((item) => item.requires === provider)?.billing }}
          </p>
        </div>
        <AppAlert
          v-if="required.includes('OpenRouter')"
          heading="Why OpenRouter?"
          description="Access models from several vendors with one account. Start with one model for editing and image input; API requests use separate credits."
        />
        <AppAlert
          v-if="waiting && !verifiedConnections.includes(waiting)"
          :heading="`Complete ${waiting} setup to continue.`"
          description="Task assignments will be confirmed separately."
        />
        <p v-if="!required.length" :class="styles.help()">
          No suitable access selected. Go back to choose an account or set up a connection manually.
        </p>
      </template>
      <TaskAssignmentReview
        v-else
        :proposals="proposals"
        :connected="verifiedConnections"
        :existing="existingAssignments"
        :mode="mode"
        @change="step = 3"
        @confirm="confirm"
      />
    </div>
    <SetupActions v-if="!applied && step !== 4" class="mt-4">
      <template #secondary><AppButton @click="goBack">Back</AppButton></template>
      <AppButton
        color="primary"
        variant="solid"
        :disabled="
          !answers.goals.length ||
          (step === 3 && !required.some((provider) => verifiedConnections.includes(provider)))
        "
        @click="step++"
        >{{ step === 3 ? 'Review assignments' : 'Continue' }}</AppButton
      >
    </SetupActions>
  </main>
</template>
