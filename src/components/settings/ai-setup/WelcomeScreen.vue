<script setup lang="ts">
import { tv } from 'tailwind-variants'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppBadge from '@/components/ui/feedback/AppBadge.vue'
import theme from '@/theme/settings/ai-setup/welcome'

const emit = defineEmits<{ setup: []; skip: [] }>()
const styles = tv(theme)()
</script>

<template>
  <section :class="styles.root()" aria-labelledby="welcome-heading">
    <header>
      <h1 id="welcome-heading" :class="styles.heading()">Welcome to OpenPencil</h1>
      <p :class="styles.description()">
        Create and edit designs on an open canvas. Import Figma files and make them your own.
      </p>
      <ul :class="styles.features()">
        <li :class="styles.feature()">
          <icon-lucide-frame :class="styles.featureIcon()" />Frames, shapes, and text
        </li>
        <li :class="styles.feature()">
          <icon-lucide-pen-tool :class="styles.featureIcon()" />Editable vector graphics
        </li>
        <li :class="styles.feature()">
          <icon-lucide-layout-grid :class="styles.featureIcon()" />Auto layout
        </li>
        <li :class="styles.feature()">
          <icon-lucide-component :class="styles.featureIcon()" />Reusable components
        </li>
      </ul>
    </header>

    <section :class="styles.ai()" aria-labelledby="welcome-ai-heading">
      <div :class="styles.aiHeader()">
        <h2 id="welcome-ai-heading" :class="styles.aiHeading()">
          Make it your AI design workspace
        </h2>
        <AppBadge>Recommended</AppBadge>
      </div>
      <ul :class="styles.capabilities()">
        <li>Describe changes and let an agent edit the canvas.</li>
        <li>Get visual feedback on your designs.</li>
        <li>Generate editable artwork with a compatible model.</li>
      </ul>
      <p :class="styles.guidance()">
        We’ll help you connect the accounts you already use and choose models for your workflow.
      </p>
      <p :class="styles.note()">You can adjust your setup later in Settings.</p>
    </section>

    <footer :class="styles.actions()">
      <AppButton variant="outline" @click="emit('skip')">Start designing instead</AppButton>
      <AppButton color="primary" variant="solid" @click="emit('setup')">Set up AI</AppButton>
    </footer>
  </section>
</template>
