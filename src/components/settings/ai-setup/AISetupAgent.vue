<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { tv } from 'tailwind-variants'
import { computed } from 'vue'

import type { ACPAgentDef } from '@open-pencil/core/constants'
import { useI18n } from '@open-pencil/vue'

import { MCP_INSTALL_COMMAND } from '@/app/ai/acp/install'
import { codingAgentGuideURL, codingAgentSetupPrompt } from '@/app/ai/acp/setup-prompt'
import type { AgentInstallStatus } from '@/app/ai/models/settings/onboarding/agents'
import SettingsLink from '@/components/settings/layout/SettingsLink.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import theme from '@/theme/settings/ai-setup/flow'

const { agent, status } = defineProps<{ agent: ACPAgentDef; status: AgentInstallStatus }>()
const emit = defineEmits<{ check: [] }>()
const { ai, common } = useI18n()
const styles = tv(theme)()
const { copy, copied, text } = useClipboard({ copiedDuring: 1500 })

const install = computed(() => (typeof status === 'object' ? status : null))
const prompt = computed(() => codingAgentSetupPrompt(agent.id))

function copiedLabel(value: string): string {
  return copied.value && text.value === value ? common.value.copied : common.value.copy
}
</script>

<template>
  <p :class="styles.help()">{{ ai.aiSetupAgentDescription({ agent: agent.name }) }}</p>

  <p v-if="status === 'checking'" role="status" :class="styles.signInStatus()">
    <icon-lucide-loader-2 :class="styles.spinner()" aria-hidden="true" />
    {{ ai.aiSetupAgentChecking }}
  </p>
  <ul v-else-if="install" :class="styles.installList()">
    <li :class="styles.installItem()" :data-installed="install.agent">
      <icon-lucide-circle-check
        v-if="install.agent"
        :class="styles.signedInIcon()"
        aria-hidden="true"
      />
      <icon-lucide-circle-dashed v-else :class="styles.missingIcon()" aria-hidden="true" />
      {{ agent.name }} ·
      {{ install.agent ? ai.aiSetupAgentInstalled : ai.aiSetupAgentNotFound }}
    </li>
    <li :class="styles.installItem()" :data-installed="install.automation">
      <icon-lucide-circle-check
        v-if="install.automation"
        :class="styles.signedInIcon()"
        aria-hidden="true"
      />
      <icon-lucide-circle-dashed v-else :class="styles.missingIcon()" aria-hidden="true" />
      {{ ai.aiSetupAgentMCP }} ·
      {{ install.automation ? ai.aiSetupAgentInstalled : ai.aiSetupAgentNotFound }}
    </li>
  </ul>

  <template v-if="agent.installCommand && install?.agent !== true">
    <p :class="styles.help()">{{ ai.aiSetupAgentInstall }}</p>
    <div :class="styles.command()">
      <code>{{ agent.installCommand }}</code>
      <AppButton size="xs" @click="copy(agent.installCommand)">
        {{ copiedLabel(agent.installCommand) }}
      </AppButton>
    </div>
  </template>
  <template v-if="install?.automation !== true">
    <p :class="styles.help()">{{ ai.aiSetupAgentMCPInstall }}</p>
    <div :class="styles.command()">
      <code>{{ MCP_INSTALL_COMMAND }}</code>
      <AppButton size="xs" @click="copy(MCP_INSTALL_COMMAND)">
        {{ copiedLabel(MCP_INSTALL_COMMAND) }}
      </AppButton>
    </div>
  </template>

  <p :class="styles.help()">{{ ai.aiSetupAgentPromptHint({ agent: agent.name }) }}</p>
  <div :class="styles.signInActions()">
    <AppButton size="xs" variant="outline" @click="copy(prompt)">
      <template #leading><icon-lucide-clipboard-copy class="size-3" /></template>
      {{ copied && text === prompt ? common.copied : ai.aiSetupAgentCopyPrompt }}
    </AppButton>
    <AppButton v-if="install" size="xs" @click="emit('check')">
      {{ ai.aiSetupAgentCheckAgain }}
    </AppButton>
    <SettingsLink :href="codingAgentGuideURL(agent.id)">{{ ai.aiSetupAgentGuide }}</SettingsLink>
  </div>
</template>
