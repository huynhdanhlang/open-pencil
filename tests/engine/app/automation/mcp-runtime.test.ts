import { describe, expect, test } from 'bun:test'

import type { ToolDescriptor } from '@open-pencil/mcp/tools'

import { createMCPRuntimeService, type MCPRuntimeDependencies } from '@/app/automation/mcp/runtime'
import { createDeferred } from '@/app/runtime/deferred'

function descriptor(name = 'get_page_tree'): ToolDescriptor {
  return {
    name,
    description: name,
    effect: 'read',
    availability: 'default',
    capabilities: ['document:read'],
    enabled: true
  }
}

function setup(overrides: Partial<MCPRuntimeDependencies> = {}) {
  const calls: string[] = []
  const catalogs: ToolDescriptor[][] = []
  const dependencies: MCPRuntimeDependencies = {
    canConnect: () => true,
    connect: () => {
      calls.push('connect')
      return () => calls.push('disconnect-bridge')
    },
    readHealth: async () => ({ status: 'ok', version: '0.14.0', tools: [descriptor()] }),
    setToolDescriptors: (tools) => catalogs.push(tools),
    getStartupFailure: () => null,
    getHealthFailure: () => null,
    spawn: async () => ({
      authToken: 'token',
      managed: true,
      disconnect: () => {
        calls.push('disconnect-server')
      }
    }),
    ...overrides
  }
  return { calls, catalogs, service: createMCPRuntimeService(dependencies) }
}

const getStore = () => ({}) as never

describe('MCP runtime service', () => {
  test('recovers an exited managed server with fresh authentication and the same editor', async () => {
    const closed = createDeferred<undefined>()
    let starts = 0
    const tokens: (string | null)[] = []
    const { service } = setup({
      spawn: async () => ({
        managed: true,
        authToken: `token-${++starts}`,
        closed: starts === 1 ? closed.promise : undefined,
        disconnect: () => undefined
      }),
      connect: (store, token) => {
        expect(store).toBe(getStore)
        tokens.push(token)
        return () => undefined
      }
    })
    await service.start(getStore)
    closed.resolve(undefined)
    await Promise.resolve()
    await service.refresh()
    expect(starts).toBe(2)
    expect(tokens).toEqual(['token-1', 'token-2'])
    expect(service.state.status).toBe('running')
    await service.stop()
  })

  for (const reason of ['stopped', 'external'] as const) {
    test(`does not respawn a ${reason} server after its late exit`, async () => {
      const closed = createDeferred<undefined>()
      let starts = 0
      const { service } = setup({
        spawn: async () => {
          starts++
          return {
            managed: reason !== 'external',
            authToken: 'token',
            closed: closed.promise,
            disconnect: () => undefined
          }
        }
      })
      await service.start(getStore)
      if (reason === 'stopped') await service.stop()
      closed.resolve(undefined)
      await Promise.resolve()
      await service.refresh()
      expect(starts).toBe(1)
      await service.stop()
    })
  }

  test('bounds repeated managed crashes and leaves an actionable error', async () => {
    const exits = Array.from({ length: 5 }, () => createDeferred<undefined>())
    let starts = 0
    let healthy = false
    const { catalogs, service } = setup({
      readHealth: async () => (healthy ? { status: 'ok', tools: [descriptor()] } : null),
      spawn: async () => {
        healthy = true
        return {
          managed: true,
          authToken: 'token',
          closed: exits[starts++].promise,
          disconnect: () => undefined
        }
      }
    })
    await service.start(getStore)
    for (let index = 0; index < 4; index++) {
      healthy = false
      exits[index].resolve(undefined)
      await Promise.resolve()
      await service.refresh()
    }
    expect(starts).toBe(4)
    expect(service.state.status).toBe('error')
    expect(service.state.failure?.code).toBe('exited')
    expect(catalogs.at(-1)).toEqual([])
    await service.stop()
  })

  test('starts only after a healthy server response', async () => {
    const { calls, catalogs, service } = setup()

    expect(await service.start(getStore)).toEqual({ ok: true })
    expect(service.state.status).toBe('running')
    expect(service.state.version).toBe('0.14.0')
    expect(calls).toEqual(['connect'])
    expect(catalogs.at(-1)?.map((tool) => tool.name)).toEqual(['get_page_tree'])
  })

  test('serializes refresh behind stop so stale health cannot restore running state', async () => {
    let releaseHealth: (() => void) | undefined
    const blockedHealth = new Promise<void>((resolve) => {
      releaseHealth = resolve
    })
    let healthCalls = 0
    const { service } = setup({
      readHealth: async () => {
        healthCalls++
        if (healthCalls === 2) await blockedHealth
        return { status: 'ok', tools: [descriptor()] }
      }
    })
    await service.start(getStore)

    const refresh = service.refresh()
    const stop = service.stop()
    releaseHealth?.()
    await Promise.all([refresh, stop])

    expect(service.state.status).toBe('stopped')
  })

  test('reports startup failure and cleans up the spawned server', async () => {
    const { calls, service } = setup({ readHealth: async () => null })

    const result = await service.start(getStore)

    expect(result.ok).toBe(false)
    expect(service.state.status).toBe('error')
    expect(service.state.failure).toEqual({ code: 'unreachable', detail: expect.any(String) })
    expect(calls).toEqual(['disconnect-server'])
  })

  test('surfaces why the server could not start instead of a generic message', async () => {
    const { service } = setup({
      spawn: async () => null,
      readHealth: async () => null,
      getStartupFailure: () => ({ code: 'not-installed', detail: '@open-pencil/mcp@0.15.0' })
    })

    await service.start(getStore)

    expect(service.state.failure).toEqual({
      code: 'not-installed',
      detail: '@open-pencil/mcp@0.15.0'
    })
  })

  test('distinguishes a rejected token from a missing server', async () => {
    const { service } = setup({
      readHealth: async () => null,
      getHealthFailure: () => ({ code: 'rejected', detail: 'HTTP 401' })
    })

    await service.start(getStore)

    expect(service.state.failure).toEqual({ code: 'rejected', detail: 'HTTP 401' })
  })

  test('reports an unexpected health payload', async () => {
    const { service } = setup({
      readHealth: async () => null,
      getHealthFailure: () => ({ code: 'malformed', detail: 'HTTP 200' })
    })

    await service.start(getStore)

    expect(service.state.failure).toEqual({ code: 'malformed', detail: 'HTTP 200' })
  })

  test('clears local runtime state even when server shutdown fails', async () => {
    const { catalogs, service } = setup({
      spawn: async () => ({
        authToken: 'token',
        managed: true,
        disconnect: () => {
          throw new Error('shutdown failed')
        }
      })
    })
    await service.start(getStore)

    const result = await service.stop()

    expect(result.ok).toBe(false)
    expect(service.state.status).toBe('error')
    expect(service.state.version).toBeNull()
    expect(catalogs.at(-1)).toEqual([])
  })

  test('does not start a replacement when shutdown fails', async () => {
    let spawnCalls = 0
    const { service } = setup({
      spawn: async () => {
        spawnCalls++
        return {
          authToken: 'token',
          managed: true,
          disconnect: () => {
            throw new Error('shutdown failed')
          }
        }
      }
    })
    await service.start(getStore)

    const result = await service.restart()

    expect(result.ok).toBe(false)
    expect(spawnCalls).toBe(1)
    expect(service.state.status).toBe('error')
  })

  test('restarts with the retained editor store inside one lifecycle operation', async () => {
    const { calls, service } = setup()
    await service.start(getStore)

    expect(await service.restart()).toEqual({ ok: true })
    expect(service.state.status).toBe('running')
    expect(calls).toEqual(['connect', 'disconnect-bridge', 'disconnect-server', 'connect'])
  })
})
