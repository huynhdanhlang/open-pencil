<script setup lang="ts">
import { ref } from 'vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppInput from '@/components/ui/input/AppInput.vue'

import SetupScreen from './SetupScreen.vue'
const emit = defineEmits<{ connected: []; back: [] }>()
const key = ref('')
</script>
<template>
  <SetupScreen
    heading="Connect Vercel AI Gateway"
    description="Use models for editing, image feedback, and vector generation through your gateway account."
  >
    <label class="flex flex-col gap-2 text-xs"
      >AI Gateway API key<AppInput v-model="key" aria-label="AI Gateway API key" type="password"
    /></label>
    <p class="text-xs text-muted">
      Requests use your Vercel AI Gateway account. Available models and operations are checked after
      connecting.
    </p>
    <template #footer
      ><AppButton @click="emit('back')">Back</AppButton
      ><AppButton color="primary" variant="solid" :disabled="!key.trim()" @click="emit('connected')"
        >Connect gateway</AppButton
      ></template
    >
  </SetupScreen>
</template>
