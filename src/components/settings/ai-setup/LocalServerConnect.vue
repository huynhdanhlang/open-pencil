<script setup lang="ts">
import { ref } from 'vue'

import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import AppInput from '@/components/ui/input/AppInput.vue'
import AppCombobox from '@/components/ui/select/AppCombobox.vue'

import SetupScreen from './SetupScreen.vue'
const { initialState = 'idle', proxy = false } = defineProps<{
  initialState?: 'idle' | 'unreachable' | 'discovered' | 'manual'
  proxy?: boolean
}>()
const emit = defineEmits<{ check: []; connect: [] }>()
const endpoint = ref(proxy ? 'https://ai.example.org/v1' : 'http://localhost:11434/v1')
const key = ref('')
const model = ref(proxy ? 'team/design' : 'qwen3-coder:30b')
const advanced = ref(proxy)
const name = ref('')
const models = [
  { value: 'qwen3-coder:30b', label: 'qwen3-coder:30b' },
  { value: 'qwen3:8b', label: 'qwen3:8b' }
]
</script>
<template>
  <SetupScreen
    :heading="proxy ? 'Connect a custom endpoint' : 'Connect Ollama'"
    :description="
      proxy
        ? 'Use your organization’s proxy or an OpenAI-compatible server.'
        : 'Start Ollama on this computer, then check which models are available.'
    "
  >
    <label class="flex flex-col gap-2 text-xs"
      >Server URL<AppInput v-model="endpoint" aria-label="Server URL"
    /></label>
    <AppButton class="self-start" variant="outline" @click="emit('check')">Check server</AppButton>
    <AppAlert
      v-if="initialState === 'unreachable'"
      tone="error"
      heading="Can’t reach the server."
      description="Make sure it’s running and allows connections from this browser."
    />
    <template v-if="initialState === 'discovered'"
      ><AppAlert tone="success" heading="Server connected · 2 models available" />
      <label class="flex flex-col gap-2 text-xs"
        >Model<AppCombobox
          v-model="model"
          label="Model"
          :options="models"
          search-placeholder="Search installed models…" /></label
    ></template>
    <template v-if="initialState === 'manual'"
      ><p class="text-sm text-muted">
        This endpoint does not expose model discovery. Enter a model ID provided by your
        administrator.
      </p>
      <label class="flex flex-col gap-2 text-xs"
        >Model ID<AppInput v-model="model" aria-label="Model ID" /></label
    ></template>
    <AppButton class="self-start" @click="advanced = !advanced"
      >Advanced connection settings</AppButton
    >
    <template v-if="advanced">
      <label class="flex flex-col gap-2 text-xs"
        >API key (optional)<AppInput v-model="key" aria-label="API key" type="password"
      /></label>
      <label class="flex flex-col gap-2 text-xs"
        >Display name (optional)<AppInput
          v-model="name"
          aria-label="Display name"
          placeholder="Studio proxy"
      /></label>
      <p class="text-xs text-muted">
        Protocol: OpenAI-compatible Chat Completions. Capabilities have not been verified.
      </p>
    </template>
    <p class="text-sm text-muted">
      {{
        proxy
          ? 'Usage and billing are managed by your server’s operator.'
          : 'Requests use the server address above.'
      }}
    </p>
    <AppButton
      class="self-end"
      v-if="initialState === 'discovered' || initialState === 'manual'"
      color="primary"
      variant="solid"
      @click="emit('connect')"
      >Test model and continue</AppButton
    >
  </SetupScreen>
</template>
