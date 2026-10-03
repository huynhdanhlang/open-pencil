<script setup lang="ts">
import SettingsRow from '@/components/settings/layout/SettingsRow.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'

const { label, description, options, detail } = defineProps<{
  label: string
  description?: string
  options: { value: string; label: string }[]
  detail?: string
}>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <SettingsRow
    class="max-sm:flex-col max-sm:items-stretch"
    :label="label"
    :description="description"
  >
    <AppSelect
      v-model="model"
      class="w-full sm:w-64"
      :label="label"
      :options="[{ value: '__none__', label: 'Not configured' }, ...options]"
    />
    <p v-if="detail" class="mt-1.5 text-[11px] text-muted">{{ detail }}</p>
    <slot />
  </SettingsRow>
</template>
