<script setup lang="ts">
import { computed, ref } from 'vue'

import SettingsGroup from '@/components/settings/layout/SettingsGroup.vue'
import AppButton from '@/components/ui/button/AppButton.vue'

import type { TaskProposal } from './recommendations'
import SetupActions from './SetupActions.vue'
import TaskAssignmentField from './TaskAssignmentField.vue'

const {
  proposals,
  connected,
  existing = {},
  mode = 'initial'
} = defineProps<{
  proposals: TaskProposal[]
  connected: string[]
  existing?: Record<string, string>
  mode?: 'initial' | 'adjust'
}>()
const emit = defineEmits<{ change: []; confirm: [assignments: Record<string, string>] }>()
const choices = ref<Record<string, string>>({})

function options(proposal: TaskProposal) {
  const available = proposal.options.filter((route) => connected.includes(route.connection))
  return available.map((route) => ({
    value: route.id,
    label: route.id === existing[proposal.task] ? `${route.label} — current` : route.label
  }))
}

function selected(proposal: TaskProposal) {
  const available = options(proposal)
  const choice = choices.value[proposal.task] ?? existing[proposal.task]
  if (choice === '') return ''
  return available.find((option) => option.value === choice)?.value ?? available[0]?.value ?? ''
}

const primary = computed(
  () => proposals.find((item) => item.task === 'Create and edit designs') ?? proposals[0]
)
const canFinish = computed(() => Boolean(primary.value && selected(primary.value)))

function confirm() {
  if (!canFinish.value) return
  emit('confirm', {
    ...existing,
    ...Object.fromEntries(proposals.map((proposal) => [proposal.task, selected(proposal)]))
  })
}
</script>
<template>
  <div class="flex flex-col gap-3">
    <p class="text-xs text-muted">
      {{
        mode === 'adjust'
          ? 'Your current assignments are kept unless you change them. Nothing is applied until you confirm.'
          : 'We’ve selected defaults from your connected access. Adjust them before finishing.'
      }}
    </p>
    <SettingsGroup>
      <TaskAssignmentField
        v-for="proposal in proposals"
        :key="proposal.task"
        :label="proposal.task"
        :model-value="selected(proposal) || '__none__'"
        :options="options(proposal)"
        :detail="proposal.options.find((route) => route.id === selected(proposal))?.billing"
        @update:model-value="choices[proposal.task] = $event === '__none__' ? '' : $event"
      >
        <p v-if="mode === 'adjust'" class="mt-1 text-[11px] text-muted">
          {{
            existing[proposal.task] === selected(proposal)
              ? 'Keep current setup'
              : 'Assignment will change on confirmation'
          }}
        </p>
        <AppButton v-if="!options(proposal).length" @click="emit('change')">{{
          proposal.requires ? `Set up ${proposal.requires}` : 'Choose another connection'
        }}</AppButton>
      </TaskAssignmentField>
    </SettingsGroup>
    <p class="text-xs text-muted">
      Paid fallback is off. Connecting an account alone does not change task assignments.
    </p>
    <SetupActions>
      <template #secondary><AppButton @click="emit('change')">Back</AppButton></template>
      <AppButton color="primary" variant="solid" :disabled="!canFinish" @click="confirm">{{
        mode === 'adjust' ? 'Apply changes' : 'Finish setup'
      }}</AppButton>
    </SetupActions>
  </div>
</template>
