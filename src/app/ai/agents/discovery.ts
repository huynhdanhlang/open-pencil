import { computed, ref, shallowRef } from 'vue'

import {
  ACP_AGENTS,
  IS_TAURI,
  type ACPAgentDef,
  type ACPAgentID
} from '@open-pencil/core/constants'

import { installAgentAdapter, installCanvasBridge, lookupAgents, type AgentLookup } from './native'

export type DetectedAgent = {
  definition: ACPAgentDef
  cliPath: string | null
  adapterPath: string | null
  status: 'available' | 'needs-adapter' | 'not-installed'
}

export function detectedAgents(lookup: AgentLookup): DetectedAgent[] {
  return ACP_AGENTS.map((definition) => {
    const cliPath = lookup.executables[definition.cliCommand ?? definition.command] ?? null
    const adapterPath = lookup.executables[definition.command] ?? null
    const unavailableStatus = cliPath ? 'needs-adapter' : 'not-installed'
    return {
      definition,
      cliPath,
      adapterPath,
      status: adapterPath ? 'available' : unavailableStatus
    }
  })
}

export function createAgentDiscovery(options: {
  enabled: boolean
  lookup: () => Promise<AgentLookup>
  install: (agent: ACPAgentDef, searchPath: string) => Promise<void>
  installBridge?: (searchPath: string) => Promise<void>
  restartBridge?: () => Promise<void>
}) {
  const snapshot = shallowRef<AgentLookup | null>(null)
  const scanning = ref(false)
  const installing = ref<ACPAgentID | 'canvas' | null>(null)
  const error = ref<'lookup' | 'install' | 'npm' | 'canvas-install' | 'canvas-start' | null>(null)
  let pending: Promise<void> | null = null
  const agents = computed(() => (snapshot.value ? detectedAgents(snapshot.value) : []))
  const availableAgents = computed(() =>
    agents.value.filter((agent) => agent.status === 'available')
  )
  const npmAvailable = computed(() => Boolean(snapshot.value?.executables.npm))
  const canvasBridgeAvailable = computed(() =>
    Boolean(snapshot.value?.executables['openpencil-mcp-http'])
  )

  function refresh(force = false): Promise<void> {
    if (!options.enabled) return Promise.resolve()
    if (pending) return force ? pending.then(() => refresh()) : pending
    scanning.value = true
    error.value = null
    pending = options
      .lookup()
      .then((result) => {
        snapshot.value = result
        return undefined
      })
      .catch(() => {
        error.value = 'lookup'
      })
      .finally(() => {
        scanning.value = false
        pending = null
      })
    return pending
  }

  async function install(id: ACPAgentID): Promise<void> {
    if (!options.enabled || installing.value) return
    const agent = agents.value.find((candidate) => candidate.definition.id === id)
    if (!agent?.definition.adapterPackage || agent.status !== 'needs-adapter') return
    if (!snapshot.value || !npmAvailable.value) {
      error.value = 'npm'
      return
    }
    installing.value = id
    error.value = null
    try {
      await options.install(agent.definition, snapshot.value.searchPath)
      await refresh(true)
      if (
        agents.value.find((candidate) => candidate.definition.id === id)?.status !== 'available'
      ) {
        error.value = 'install'
      }
    } catch {
      error.value = 'install'
    } finally {
      installing.value = null
    }
  }

  async function setupCanvasBridge(): Promise<void> {
    if (!options.enabled || installing.value || !snapshot.value) return
    if (!canvasBridgeAvailable.value && !npmAvailable.value) {
      error.value = 'npm'
      return
    }
    installing.value = 'canvas'
    error.value = null
    let installed = canvasBridgeAvailable.value
    try {
      if (!installed) {
        if (!options.installBridge) throw new Error('Canvas bridge setup is unavailable.')
        await options.installBridge(snapshot.value.searchPath)
        await refresh(true)
        if (!canvasBridgeAvailable.value) throw new Error('Canvas bridge was not found.')
        installed = true
      }
      await options.restartBridge?.()
    } catch {
      error.value = installed ? 'canvas-start' : 'canvas-install'
    } finally {
      installing.value = null
    }
  }

  return {
    supported: options.enabled,
    agents,
    availableAgents,
    scanning,
    installing,
    error,
    npmAvailable,
    canvasBridgeAvailable,
    setupCanvasBridge,
    refresh,
    install
  }
}

export const agentDiscovery = createAgentDiscovery({
  enabled: IS_TAURI,
  lookup: lookupAgents,
  install: installAgentAdapter,
  installBridge: installCanvasBridge,
  async restartBridge() {
    const { restartMCPRuntime } = await import('@/app/automation/mcp/runtime')
    const result = await restartMCPRuntime()
    if (!result.ok) throw result.error
  }
})
