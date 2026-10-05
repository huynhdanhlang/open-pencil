/** Trusted launcher, bundled for the pinned Node runtime; never exposed to the model. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { rmSync } from 'node:fs'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
// The pinned adapter owns its nested Codex dependency; resolution must start at its entry, not this bundle.
// eslint-disable-next-line no-restricted-imports -- Resolve the existing adapter's private dependency without installing another CLI.
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

import * as v from 'valibot'

import {
  buildSnapshotHelperConfig,
  helperLaunchEnvironment,
  helperProfileSchema,
  snapshotHelperCatalog,
  SNAPSHOT_HELPER_POLICY,
  type HelperProfile
} from './helper-policy'
import pinnedModels from './pinned-models.json'

const objectSchema = v.record(v.string(), v.unknown())
const parseObject = (line: string) => v.parse(v.pipe(v.string(), v.parseJson(), objectSchema), line)
const children = new Set<ChildProcessWithoutNullStreams>()
const privateDirectories = new Set<string>()
process.once('exit', () => {
  for (const directory of privateDirectories) rmSync(directory, { recursive: true, force: true })
})
function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill()
    }
  }
  children.delete(child)
}
function shutdown(): void {
  for (const child of children) terminate(child)
}
process.once('SIGTERM', () => {
  shutdown()
  process.exit(143)
})
process.once('SIGINT', () => {
  shutdown()
  process.exit(130)
})

async function effectiveConfig(cli: string): Promise<unknown> {
  const child = spawn(process.execPath, [cli, 'app-server'], { detached: true, stdio: 'pipe' })
  children.add(child)
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const lines = createInterface({ input: child.stdout })
  child.stderr.resume()
  const fail = (error: Error) => {
    for (const request of pending.values()) request.reject(error)
  }
  child.on('error', fail)
  child.on('exit', () => fail(new Error('Helper config service exited')))
  lines.on('line', (line) => {
    try {
      if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('Config response exceeds limit')
      const message = parseObject(line)
      if (typeof message.id !== 'number') return
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error('Helper config request failed'))
      else request.resolve(message.result)
    } catch {
      fail(new Error('Invalid helper config response'))
    }
  })
  const request = (id: number, method: string, params: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  const timer = setTimeout(() => {
    fail(new Error('Helper configuration timed out'))
    terminate(child)
  }, 10000)
  try {
    await request(1, 'initialize', {
      clientInfo: { name: 'openpencil-helper-policy', version: '1' },
      capabilities: {}
    })
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n')
    return await request(2, 'config/read', { includeLayers: true, cwd: homedir() })
  } finally {
    clearTimeout(timer)
    lines.close()
    terminate(child)
  }
}

export async function restrictedCodexConfig(
  entry: string,
  profile: string,
  requested?: HelperProfile
): Promise<Record<string, unknown>> {
  const cli = createRequire(entry).resolve('@openai/codex/bin/codex.js')
  const adapterPackage = parseObject(
    await readFile(join(dirname(entry), '..', 'package.json'), 'utf8')
  )
  const cliPackage = parseObject(await readFile(join(dirname(cli), '..', 'package.json'), 'utf8'))
  if (
    adapterPackage.version !== '2.1.1' ||
    cliPackage.version !== SNAPSHOT_HELPER_POLICY.codexVersion
  ) {
    throw new Error('Unsupported pinned helper version')
  }
  const base = parseObject(await readFile(profile, 'utf8'))
  const config = buildSnapshotHelperConfig(base, await effectiveConfig(cli), requested)
  const catalog = snapshotHelperCatalog(pinnedModels)
  if (
    requested?.model &&
    requested.model !== 'default' &&
    !catalog.models.some((model) => model.slug === requested.model?.split('[')[0])
  )
    throw new Error('Configured model is not in the pinned helper catalog')
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-helper-'))
  privateDirectories.add(directory)
  const path = join(directory, 'models.json')
  await writeFile(path, JSON.stringify(catalog), { mode: 0o600 })
  config.model_catalog_json = path
  return config
}

/** CODEX_CONFIG is a thread override; catalog selection must also reach app-server startup. */
export async function pinnedCodexLauncher(
  entry: string,
  config: Record<string, unknown>
): Promise<string> {
  const cli = createRequire(entry).resolve('@openai/codex/bin/codex.js')
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-helper-cli-'))
  privateDirectories.add(directory)
  const path = join(directory, 'codex')
  const args = [cli, '-c', 'model_catalog_json=' + JSON.stringify(config.model_catalog_json)]
  const script =
    '#!' +
    process.execPath +
    '\n' +
    'const {spawn}=require("node:child_process");\n' +
    'const child=spawn(' +
    JSON.stringify(process.execPath) +
    ',' +
    JSON.stringify(args) +
    '.concat(process.argv.slice(2)),{stdio:"inherit"});\n' +
    'for(const signal of ["SIGTERM","SIGINT"]) process.on(signal,()=>child.kill(signal));\n' +
    'child.on("error",()=>process.exit(1));child.on("exit",code=>process.exit(code??1));\n'
  await writeFile(path, script, { mode: 0o700 })
  return path
}

async function main(): Promise<void> {
  if (process.platform !== 'linux')
    throw new Error('unsupported_helper_boundary: Linux pinned launcher required')
  const entry = process.env.OPENPENCIL_CODEX_ACP_ENTRY
  const profile = process.env.OPENPENCIL_CODEX_PROFILE
  if (!entry || !profile) throw new Error('Missing pinned helper installation')
  const requested = process.argv[2]
    ? v.parse(helperProfileSchema, parseObject(process.argv[2]))
    : undefined
  const config = await restrictedCodexConfig(entry, profile, requested)
  const launcher = await pinnedCodexLauncher(entry, config)
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'pipe',
    env: { ...helperLaunchEnvironment(process.env, config), CODEX_PATH: launcher },
    cwd: homedir()
  })
  children.add(child)
  // ACP envelopes only. No filesystem or MCP proxy is provided to the helper.
  const input = createInterface({ input: process.stdin })
  const output = createInterface({ input: child.stdout })
  const initializeIds = new Set<unknown>()
  input.on('line', (line) => {
    try {
      if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('ACP request exceeds limit')
      const message = parseObject(line)
      if (message.method === 'initialize') initializeIds.add(message.id)
      if (message.method === 'session/new') {
        const params = v.parse(objectSchema, message.params)
        message.params = { ...params, cwd: homedir(), mcpServers: [] }
      }
      if (message.method === 'session/set_mode' || message.method === 'session/set_config_option')
        throw new Error('Helper policy cannot be changed')
      child.stdin.write(JSON.stringify(message) + '\n')
    } catch {
      shutdown()
      process.exitCode = 1
      input.close()
      output.close()
    }
  })
  input.once('close', () => {
    shutdown()
  })
  output.on('line', (line) => {
    try {
      if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('ACP response exceeds limit')
      const message = parseObject(line)
      if (message.method === 'session/request_permission') {
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { outcome: { outcome: 'cancelled' } }
          }) + '\n'
        )
        return
      }
      if (initializeIds.delete(message.id)) {
        const result = v.parse(objectSchema, message.result)
        const meta = v.safeParse(objectSchema, result._meta)
        message.result = {
          ...result,
          _meta: {
            ...(meta.success ? meta.output : {}),
            openpencilSnapshotHelper: SNAPSHOT_HELPER_POLICY
          }
        }
      }
      process.stdout.write(JSON.stringify(message) + '\n')
    } catch {
      shutdown()
      process.exitCode = 1
      input.close()
      output.close()
    }
  })
  // Raw adapter logs can contain task inputs; do not forward them to the editor/logs.
  child.stderr.resume()
  child.on('error', () => {
    process.stderr.write('Codex helper failed to start\n')
    shutdown()
    process.exit(1)
  })
  child.on('exit', (code) => {
    children.delete(child)
    input.close()
    output.close()
    process.exit(code ?? 1)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch(() => {
    process.stderr.write('unsupported_helper_boundary: Codex helper configuration failed\n')
    shutdown()
    process.exit(1)
  })
