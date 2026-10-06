import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import * as v from 'valibot'

import { ACP_AGENTS } from '@open-pencil/core/constants'

import { resolvePlatformCommand } from '@/app/tauri/command'

import { repoPath } from '#tests/helpers/paths'

const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

describe('resolvePlatformCommand', () => {
  test('wraps a bare command in cmd /c through its own scope entry on Windows', () => {
    expect(resolvePlatformCommand('claude-agent-acp', [], WINDOWS_UA)).toEqual({
      command: 'cmd-claude-agent-acp',
      args: ['/c', 'claude-agent-acp']
    })
  })

  test('preserves extra args after the command on Windows', () => {
    expect(resolvePlatformCommand('gemini', ['--acp'], WINDOWS_UA)).toEqual({
      command: 'cmd-gemini',
      args: ['/c', 'gemini', '--acp']
    })
  })

  test('passes the command through unchanged on non-Windows', () => {
    expect(resolvePlatformCommand('claude-agent-acp', ['--acp'], MAC_UA)).toEqual({
      command: 'claude-agent-acp',
      args: ['--acp']
    })
  })

  test('defaults args to an empty array', () => {
    expect(resolvePlatformCommand('openpencil-mcp-http', undefined, MAC_UA)).toEqual({
      command: 'openpencil-mcp-http',
      args: []
    })
  })

  test('passes through when the user agent is unavailable (headless/non-browser)', () => {
    expect(resolvePlatformCommand('openpencil-mcp-http', ['--stdio'], '')).toEqual({
      command: 'openpencil-mcp-http',
      args: ['--stdio']
    })
  })

  test('the snapshot helper uses its own scope and the pinned Codex executable on Windows', () => {
    const args = ['--openpencil-snapshot-helper', '{"model":"gpt-6.1-sol[high]","effort":"high"}']
    expect(resolvePlatformCommand('codex-acp-snapshot-helper', args, WINDOWS_UA)).toEqual({
      command: 'cmd-codex-acp-snapshot-helper',
      args: ['/c', 'codex-acp', ...args]
    })
  })
})

const ShellScope = v.object({
  permissions: v.array(
    v.union([
      v.string(),
      v.object({
        identifier: v.string(),
        allow: v.optional(
          v.array(
            v.object({
              name: v.optional(v.string()),
              cmd: v.optional(v.string()),
              args: v.optional(v.union([v.boolean(), v.array(v.unknown())]))
            })
          )
        )
      })
    ])
  )
})

function spawnScope() {
  const text = readFileSync(repoPath('desktop/capabilities/default.json'), 'utf8')
  const capability = v.parse(v.pipe(v.string(), v.parseJson(), ShellScope), text)
  const spawn = capability.permissions.find(
    (permission) => typeof permission !== 'string' && permission.identifier === 'shell:allow-spawn'
  )
  return typeof spawn === 'string' ? [] : (spawn?.allow ?? [])
}

describe('shell scope', () => {
  // Every program the app starts, with the arguments it starts it with.
  const spawns: [string, string[]][] = [
    ...ACP_AGENTS.map((agent): [string, string[]] => [agent.command, agent.args]),
    ['openpencil-mcp-http', []],
    ['openpencil-harness', []]
  ]

  for (const userAgent of [WINDOWS_UA, MAC_UA]) {
    for (const [name, args] of spawns) {
      test(`allows exactly ${name} ${args.join(' ')} on ${userAgent === MAC_UA ? 'macOS' : 'Windows'}`, () => {
        const resolved = resolvePlatformCommand(name, args, userAgent)
        const entry = spawnScope().find((candidate) => candidate.name === resolved.command)
        expect(entry?.cmd).toBe(userAgent === WINDOWS_UA ? 'cmd' : name)
        expect(entry?.args === false ? [] : entry?.args).toEqual(resolved.args)
      })
    }
  }

  test('allows nothing but those programs', () => {
    const expected = [WINDOWS_UA, MAC_UA].flatMap((userAgent) =>
      spawns.map(([name, args]) => resolvePlatformCommand(name, args, userAgent).command)
    )
    expect(
      spawnScope()
        .map((entry) => entry.name)
        .sort()
    ).toEqual(
      [
        ...new Set([...expected, 'codex-acp-snapshot-helper', 'cmd-codex-acp-snapshot-helper'])
      ].sort()
    )
  })

  test('lets no program take arbitrary arguments', () => {
    expect(spawnScope().filter((entry) => entry.args === true)).toEqual([])
  })

  test('helper scopes allow one validated profile argument and reject command metacharacters', () => {
    for (const windows of [false, true]) {
      const name = windows ? 'cmd-codex-acp-snapshot-helper' : 'codex-acp-snapshot-helper'
      const scope = spawnScope().find((entry) => entry.name === name)
      expect(scope?.cmd).toBe(windows ? 'cmd' : 'codex-acp')
      const args = scope?.args as Array<string | { validator: string }> | undefined
      expect(args?.slice(0, -1)).toEqual(
        windows
          ? ['/c', 'codex-acp', '--openpencil-snapshot-helper']
          : ['--openpencil-snapshot-helper']
      )
      const profile = args?.at(-1) as { validator: string } | undefined
      expect(profile?.validator).toBeDefined()
      const validate = new RegExp(profile?.validator ?? '(?!)')
      for (const valid of [
        '{"model":null,"effort":null}',
        '{"model":"gpt-6.1-sol[high]","effort":"high"}'
      ]) {
        expect(validate.test(valid)).toBe(true)
      }
      for (const invalid of [
        '{"model":"x&whoami","effort":"high"}',
        '{"model":"x";whoami","effort":"high"}',
        '--shell',
        '{"model":"gpt-6.1-sol","effort":"arbitrary"}'
      ]) {
        expect(validate.test(invalid)).toBe(false)
      }
    }
  })
})
