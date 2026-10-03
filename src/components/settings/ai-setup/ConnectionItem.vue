<script setup lang="ts">
import AppActionRow from '@/components/ui/list/AppActionRow.vue'

import ConnectionStatus from './ConnectionStatus.vue'

const {
  name,
  detail,
  agent = false
} = defineProps<{ name: string; detail: string; agent?: boolean }>()
const emit = defineEmits<{ manage: [] }>()
</script>

<template>
  <li>
    <AppActionRow
      :aria-label="`Manage ${name}`"
      :ui="{ root: 'w-full py-3', trailing: 'flex items-center gap-2' }"
      @click="emit('manage')"
    >
      <template #leading>
        <icon-lucide-terminal v-if="agent" class="size-4 text-muted" />
        <icon-lucide-network v-else class="size-4 text-muted" />
      </template>
      {{ name }}
      <template #description>{{ detail }}</template>
      <template #trailing>
        <ConnectionStatus :status="agent ? 'ready' : 'connected'" />
        <icon-lucide-chevron-right class="size-3 text-muted" />
      </template>
    </AppActionRow>
  </li>
</template>
