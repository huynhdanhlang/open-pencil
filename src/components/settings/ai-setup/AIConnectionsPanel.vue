<script setup lang="ts">
import { computed, ref } from 'vue'

import SettingsGroup from '@/components/settings/layout/SettingsGroup.vue'
import SettingsSection from '@/components/settings/layout/SettingsSection.vue'
import AppButton from '@/components/ui/button/AppButton.vue'

import ConnectionItem from './ConnectionItem.vue'
import { goals, routes } from './recommendations'
import SetupActions from './SetupActions.vue'
import TaskAssignmentField from './TaskAssignmentField.vue'
const {
  connected = ['Codex', 'OpenRouter'],
  assignments = { 'Create and edit designs': 'codex-agent' }
} = defineProps<{ connected?: string[]; assignments?: Record<string, string> }>()
const emit = defineEmits<{
  add: []
  manage: [name: string]
  review: []
  save: [assignments: Record<string, string>]
}>()
const edits = ref<Record<string, string>>({})
const dirty = computed(() => Object.keys(edits.value).length > 0)
function value(task: string) {
  return edits.value[task] ?? assignments[task] ?? '__none__'
}
function detail(task: string) {
  return routes.find((route) => route.id === value(task))?.billing
}
function save() {
  const next = { ...assignments }
  for (const [task, id] of Object.entries(edits.value)) next[task] = id === '__none__' ? '' : id
  emit('save', next)
  edits.value = {}
}
</script>
<template>
  <main
    class="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-xl border border-border bg-panel p-5 text-surface"
  >
    <header class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-base font-semibold">AI setup</h1>
        <p class="mt-1 text-xs text-muted">Your accounts and models, organized by task.</p>
      </div>
      <AppButton class="shrink-0" variant="outline" size="sm" @click="emit('review')"
        >Review setup</AppButton
      >
    </header>
    <SettingsSection>
      <template #title>Connections</template>
      <template #actions
        ><AppButton size="xs" @click="emit('add')"
          ><template #leading><icon-lucide-plus /></template>Add connection</AppButton
        ></template
      >
      <ul class="divide-y divide-border border-y border-border">
        <ConnectionItem
          v-for="name in connected"
          :key="name"
          :name="name"
          :agent="['Codex', 'Claude Code', 'Pi'].includes(name)"
          :detail="routes.find((route) => route.connection === name)?.billing ?? 'Custom endpoint'"
          @manage="emit('manage', name)"
        />
      </ul>
      <p v-if="!connected.length" class="py-3 text-xs text-muted">
        Connect an account or local server to choose models for your tasks.
      </p>
    </SettingsSection>
    <SettingsSection>
      <template #title>Tasks</template>
      <SettingsGroup>
        <TaskAssignmentField
          v-for="goal in goals"
          :key="goal.id"
          :model-value="value(goal.label) || '__none__'"
          :label="goal.label"
          :description="goal.description"
          :options="
            routes
              .filter(
                (route) =>
                  connected.includes(route.connection) && route.capabilities.includes(goal.id)
              )
              .map((route) => ({ value: route.id, label: route.label }))
          "
          :detail="detail(goal.label)"
          @update:model-value="edits[goal.label] = $event"
        />
      </SettingsGroup>
      <p class="text-[11px] text-muted">
        Paid fallback is off. Each task uses only the account shown.
      </p>
    </SettingsSection>
    <SetupActions v-if="dirty"
      ><template #secondary><AppButton @click="edits = {}">Discard changes</AppButton></template
      ><AppButton color="primary" variant="solid" @click="save"
        >Save changes</AppButton
      ></SetupActions
    >
  </main>
</template>
