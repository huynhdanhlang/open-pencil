<script setup lang="ts">
import { tv } from 'tailwind-variants'

import theme from '@/theme/settings/ai-setup/connection-status'
const { status } = defineProps<{
  status: 'connected' | 'ready' | 'starting' | 'sign-in' | 'unavailable'
}>()
const labels = {
  connected: 'Connected',
  ready: 'Agent ready',
  starting: 'Starting…',
  'sign-in': 'Sign-in required',
  unavailable: 'Unavailable'
}
const styles = tv(theme)()
</script>
<template>
  <span :class="styles.root()"
    ><span :class="styles.dot()" :data-status="status" aria-hidden="true" />{{
      labels[status]
    }}</span
  >
</template>
