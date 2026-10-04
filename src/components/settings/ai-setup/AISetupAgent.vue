<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { tv } from 'tailwind-variants'
import { computed } from 'vue'

import type { ACPAgentDef } from '@open-pencil/core/constants'
import { useI18n } from '@open-pencil/vue'

import {
  codingAgentGuideURL,
  codingAgentSetupPrompt,
  MCP_INSTALL_COMMAND
} from '@/app/ai/acp/setup-prompt'
import type { AgentSetupState } from '@/app/ai/models/settings/onboarding/agents'
import SettingsLink from '@/components/settings/layout/SettingsLink.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import theme from '@/theme/settings/ai-setup/flow'

const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download'

const { agent, setup } = defineProps<{ agent: ACPAgentDef; setup: AgentSetupState }>()
const emit = defineEmits<{ check: []; installAgent: []; installBridge: [] }>()
const { ai, common } = useI18n()
const styles = tv(theme)()
const { copy, copied, text } = useClipboard({ copiedDuring: 1500 })

const detected = computed(() => setup.detected)
const prompt = computed(() => codingAgentSetupPrompt(agent.id))
const busy = computed(() => setup.installingAgent || setup.installingBridge)
/** Manual commands are for where one-click installation cannot help. */
const manualAgentCommand = computed(() => {
  if (!agent.installCommand || detected.value?.status === 'available') return null
  if (!setup.supported || !setup.npm || setup.error === 'install') {
    return agent.installCommand
  }
  return agent.adapterPackage ? null : agent.installCommand
})
const manualBridgeCommand = computed(() => {
  if (!setup.supported) return MCP_INSTALL_COMMAND
  return !setup.bridge && (!setup.npm || setup.error === 'canvas-install')
    ? MCP_INSTALL_COMMAND
    : null
})
const needsNpm = computed(
  () =>
    !setup.npm &&
    (detected.value?.status === 'needs-adapter' || (setup.detected !== null && !setup.bridge))
)
const errorMessage = computed(() => {
  if (setup.error === 'npm' || needsNpm.value) return ai.value.aiSetupAgentNeedsNpm
  if (setup.error === 'install' || setup.error === 'canvas-install') {
    return ai.value.aiSetupAgentInstallFailed
  }
  if (setup.error === 'canvas-start') return ai.value.aiSetupAgentMCPStartFailed
  if (setup.error === 'lookup') return ai.value.aiSetupAgentLookupFailed
  return null
})

function agentState(): string {
  if (detected.value?.status === 'available') return ai.value.aiSetupAgentInstalled
  if (detected.value?.status === 'needs-adapter') return ai.value.aiSetupAgentNeedsAdapter
  return ai.value.aiSetupAgentNotFound
}

function copiedLabel(value: string, label: string): string {
  return copied.value && text.value === value ? common.value.copied : label
}
</script>

<template>
  <p :class="styles.help()">{{ ai.aiSetupAgentDescription({ agent: agent.name }) }}</p>

  <template v-if="setup.supported">
    <p v-if="setup.scanning && !detected" role="status" :class="styles.signInStatus()">
      <icon-lucide-loader-2 :class="styles.spinner()" aria-hidden="true" />
      {{ ai.aiSetupAgentChecking }}
    </p>
    <ul v-else-if="detected" :class="styles.installList()">
      <li :class="styles.installItem()" :data-status="detected.status">
        <icon-lucide-circle-check
          v-if="detected.status === 'available'"
          :class="styles.signedInIcon()"
          aria-hidden="true"
        />
        <icon-lucide-circle-dashed v-else :class="styles.missingIcon()" aria-hidden="true" />
        <span class="flex-1">{{ agent.name }} · {{ agentState() }}</span>
        <AppButton
          v-if="detected.status === 'needs-adapter' && setup.npm"
          size="xs"
          variant="outline"
          :disabled="busy"
          :loading="setup.installingAgent"
          @click="emit('installAgent')"
        >
          {{ setup.installingAgent ? ai.aiSetupAgentInstalling : ai.aiSetupAgentInstallAdapter }}
        </AppButton>
        <SettingsLink
          v-else-if="detected.status === 'not-installed' && agent.setupURL"
          :href="agent.setupURL"
        >
          {{ ai.aiSetupAgentGetCLI({ agent: agent.name }) }}
        </SettingsLink>
      </li>
      <li :class="styles.installItem()" :data-status="setup.bridge ? 'available' : 'missing'">
        <icon-lucide-circle-check
          v-if="setup.bridge"
          :class="styles.signedInIcon()"
          aria-hidden="true"
        />
        <icon-lucide-circle-dashed v-else :class="styles.missingIcon()" aria-hidden="true" />
        <span class="flex-1">
          {{ ai.aiSetupAgentMCP }} ·
          {{ setup.bridge ? ai.aiSetupAgentInstalled : ai.aiSetupAgentNotFound }}
        </span>
        <AppButton
          v-if="!setup.bridge && setup.npm"
          size="xs"
          variant="outline"
          :disabled="busy"
          :loading="setup.installingBridge"
          @click="emit('installBridge')"
        >
          {{ setup.installingBridge ? ai.aiSetupAgentInstalling : ai.aiSetupAgentInstallMCP }}
        </AppButton>
      </li>
    </ul>
    <AppAlert v-if="errorMessage" tone="warning" :heading="errorMessage">
      <template v-if="setup.error === 'npm' || needsNpm" #actions>
        <SettingsLink :href="NODE_DOWNLOAD_URL">Node.js</SettingsLink>
      </template>
    </AppAlert>
  </template>

  <template v-if="manualAgentCommand">
    <p :class="styles.help()">{{ ai.aiSetupAgentInstall }}</p>
    <div :class="styles.command()">
      <code>{{ manualAgentCommand }}</code>
      <AppButton size="xs" @click="copy(manualAgentCommand)">
        {{ copiedLabel(manualAgentCommand, common.copy) }}
      </AppButton>
    </div>
  </template>
  <template v-if="manualBridgeCommand">
    <p :class="styles.help()">{{ ai.aiSetupAgentMCPInstall }}</p>
    <div :class="styles.command()">
      <code>{{ manualBridgeCommand }}</code>
      <AppButton size="xs" @click="copy(manualBridgeCommand)">
        {{ copiedLabel(manualBridgeCommand, common.copy) }}
      </AppButton>
    </div>
  </template>

  <p :class="styles.help()">{{ ai.aiSetupAgentPromptHint({ agent: agent.name }) }}</p>
  <div :class="styles.signInActions()">
    <AppButton size="xs" variant="outline" @click="copy(prompt)">
      <template #leading><icon-lucide-clipboard-copy class="size-3" /></template>
      {{ copiedLabel(prompt, ai.aiSetupAgentCopyPrompt) }}
    </AppButton>
    <AppButton
      v-if="setup.supported"
      size="xs"
      :disabled="busy || setup.scanning"
      @click="emit('check')"
    >
      {{ ai.aiSetupAgentCheckAgain }}
    </AppButton>
    <SettingsLink :href="codingAgentGuideURL(agent.id)">{{ ai.aiSetupAgentGuide }}</SettingsLink>
  </div>
</template>
