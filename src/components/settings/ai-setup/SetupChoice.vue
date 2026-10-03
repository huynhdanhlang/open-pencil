<script setup lang="ts">
const { label, description } = defineProps<{ label: string; description?: string }>()
</script>

<template>
  <label
    class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-3 transition-colors hover:bg-hover has-[:checked]:border-accent has-[:checked]:bg-accent/5 has-[[data-state=checked]]:border-accent has-[[data-state=checked]]:bg-accent/5 focus-within:ring-2 focus-within:ring-accent/50"
  >
    <slot />
    <span
      ><span class="font-medium">{{ label }}</span
      ><span v-if="description" class="mt-1 block text-muted">{{ description }}</span></span
    >
  </label>
</template>
