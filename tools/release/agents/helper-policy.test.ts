import { expect, test } from 'bun:test'

import {
  buildSnapshotHelperConfig,
  helperLaunchEnvironment,
  snapshotHelperCatalog
} from './helper-policy'

test('helper disables all inherited servers and tools without changing selected model or original config', () => {
  const base = { model: 'gpt-6.1-sol', model_reasoning_effort: 'high', 'agents.enabled': true }
  const before = structuredClone(base)
  const result = buildSnapshotHelperConfig(base, {
    config: { mcp_servers: { hidden: {} } },
    layers: [{ config: { mcp_servers: { inherited: {} } } }]
  })
  expect(result.mcp_servers).toEqual({ hidden: { enabled: false }, inherited: { enabled: false } })
  expect(result.model).toBe('gpt-6.1-sol')
  expect(result.model_reasoning_effort).toBe('high')
  expect(result['features.shell_tool']).toBe(false)
  expect(result['features.view_image']).toBe(false)
  expect(result['agents.enabled']).toBe(false)
  expect(result.sandbox_mode).toBe('read-only')
  expect(result.approval_policy).toBe('never')
  expect(base).toEqual(before)
})

test('helper model catalog removes patch/shell tools while preserving every other model field', () => {
  const model = {
    slug: 'selected',
    base_instructions: 'exact',
    context_window: 100,
    apply_patch_tool_type: 'freeform',
    shell_type: 'unified_exec'
  }
  const result = snapshotHelperCatalog({ models: [model] })
  expect(result.models).toEqual([{ ...model, apply_patch_tool_type: null, shell_type: 'disabled' }])
  expect(model.apply_patch_tool_type).toBe('freeform')
})

test('explicit reusable model and effort override defaults without weakening helper policy', () => {
  const result = buildSnapshotHelperConfig(
    { model: 'default-model', model_reasoning_effort: 'low' },
    { config: {} },
    { model: 'gpt-6.1-sol', effort: 'high' }
  )
  expect(result.model).toBe('gpt-6.1-sol')
  expect(result.model_reasoning_effort).toBe('high')
  expect(result['features.shell_tool']).toBe(false)
})

test('launcher removes ambient Codex executable overrides', () => {
  const result = helperLaunchEnvironment(
    { CODEX_PATH: '/another/cli', KEEP: 'yes' },
    { model: 'configured' }
  )
  expect(result.CODEX_PATH).toBeUndefined()
  expect(result.INITIAL_AGENT_MODE).toBe('read-only')
  expect(result.KEEP).toBe('yes')
  expect(JSON.parse(result.CODEX_CONFIG ?? '{}')).toEqual({ model: 'configured' })
})
