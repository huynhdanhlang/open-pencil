<script setup lang="ts">
import { ref } from 'vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'

import SetupScreen from './SetupScreen.vue'

type State = 'disconnected' | 'waiting' | 'cancelled' | 'expired' | 'connected'
const { initialState = 'disconnected' } = defineProps<{ initialState?: State }>()
const emit = defineEmits<{ authorize: []; connectKey: []; done: []; cancel: [] }>()
const state = ref<State>(initialState)
const manual = ref(false)
const key = ref('')
function useKey() {
  state.value = 'disconnected'
  manual.value = true
}
function cancel() {
  state.value = 'disconnected'
  emit('cancel')
}
function authorize() {
  state.value = 'waiting'
  emit('authorize')
}
</script>
<template>
  <SetupScreen
    heading="OpenRouter"
    description="One account for models from multiple providers. Requests use your OpenRouter credits."
  >
    <template v-if="state === 'disconnected'">
      <template v-if="manual">
        <label class="flex flex-col gap-2 text-xs"
          >OpenRouter API key<AppInput
            v-model="key"
            type="password"
            aria-label="OpenRouter API key"
            placeholder="sk-or-…"
        /></label>
        <div class="flex gap-2">
          <AppButton
            color="primary"
            variant="solid"
            :disabled="!key.trim()"
            @click="emit('connectKey')"
            >Connect</AppButton
          ><AppButton @click="manual = false">Back</AppButton>
        </div>
      </template>
      <div v-else class="flex flex-wrap gap-2">
        <AppButton color="primary" variant="solid" @click="authorize"
          >Connect with OpenRouter</AppButton
        ><AppButton @click="manual = true">Use an API key instead</AppButton>
      </div>
    </template>
    <template v-else-if="state === 'waiting'">
      <p role="status" class="flex items-center gap-2">
        <icon-lucide-loader-2 class="size-4 animate-spin" />Waiting for OpenRouter…
      </p>
      <p class="text-xs text-muted">Complete authorization in your browser, then return here.</p>
      <div class="flex gap-2">
        <AppButton variant="outline" @click="emit('authorize')">Open browser again</AppButton
        ><AppButton @click="cancel">Cancel</AppButton>
      </div>
    </template>
    <template v-else-if="state === 'cancelled' || state === 'expired'">
      <AppAlert
        tone="warning"
        :heading="
          state === 'cancelled'
            ? 'Authorization cancelled. No connection was added.'
            : 'The sign-in link expired. Connect again to continue.'
        "
      />
      <div class="flex gap-2">
        <AppButton color="primary" variant="solid" @click="authorize">Connect again</AppButton
        ><AppButton @click="useKey">Use an API key instead</AppButton>
      </div>
    </template>
    <template v-else>
      <AppAlert
        tone="success"
        heading="Connected"
        description="No task assignments changed. You can choose models for your tasks after connecting."
      />
      <div class="flex justify-end">
        <AppButton color="primary" variant="solid" @click="emit('done')">Done</AppButton>
      </div>
    </template>
  </SetupScreen>
</template>
