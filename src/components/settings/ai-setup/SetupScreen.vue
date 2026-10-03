<script setup lang="ts">
import { tv } from 'tailwind-variants'

import theme from '@/theme/settings/ai-setup/screen'
const { heading, description } = defineProps<{ heading: string; description: string }>()
const styles = tv(theme)()
</script>
<template>
  <section :class="styles.root()">
    <header :class="styles.header()">
      <h1 :class="styles.title()">{{ heading }}</h1>
      <p :class="styles.description()">{{ description }}</p>
    </header>
    <div :class="styles.body()"><slot /></div>
    <footer v-if="$slots.footer" :class="styles.footer()"><slot name="footer" /></footer>
  </section>
</template>
