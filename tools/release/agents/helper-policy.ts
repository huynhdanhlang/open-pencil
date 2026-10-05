import * as v from 'valibot'

const record = v.record(v.string(), v.unknown())
const configReadSchema = v.object({
  config: record,
  layers: v.optional(v.array(v.object({ config: record })), [])
})

export const helperProfileSchema = v.strictObject({
  model: v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(128))),
  effort: v.nullable(
    v.picklist(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
  )
})
export type HelperProfile = v.InferOutput<typeof helperProfileSchema>

export function helperLaunchEnvironment(
  inherited: Record<string, string | undefined>,
  config: Record<string, unknown>
): Record<string, string | undefined> {
  const { CODEX_PATH: _override, ...environment } = inherited
  return { ...environment, INITIAL_AGENT_MODE: 'read-only', CODEX_CONFIG: JSON.stringify(config) }
}

export const SNAPSHOT_HELPER_POLICY = {
  version: 1,
  codexVersion: '0.159.3',
  shell: false,
  applyPatch: false,
  localImages: false,
  mcp: false,
  recursiveAgents: false,
  sandbox: 'read-only',
  approvals: 'deny-all'
} as const

/** Preserve exact pinned model metadata; remove only environment tool declarations. */
export function snapshotHelperCatalog(source: unknown): { models: Record<string, unknown>[] } {
  const catalog = v.parse(v.object({ models: v.array(record) }), source)
  return {
    models: catalog.models.map((model) => ({
      ...model,
      apply_patch_tool_type: null,
      shell_type: 'disabled'
    }))
  }
}

export function buildSnapshotHelperConfig(
  base: Record<string, unknown>,
  effectiveConfig: unknown,
  requested?: HelperProfile
): Record<string, unknown> {
  const effective = v.parse(configReadSchema, effectiveConfig)
  const names = new Set<string>()
  for (const layer of [base, effective.config, ...effective.layers.map((entry) => entry.config)]) {
    const servers = v.safeParse(record, layer.mcp_servers)
    if (servers.success) for (const name of Object.keys(servers.output)) names.add(name)
  }
  const config: Record<string, unknown> = {
    ...base,
    mcp_servers: Object.fromEntries([...names].map((name) => [name, { enabled: false }])),
    'features.shell_tool': false,
    'features.view_image': false,
    'features.plugins': false,
    'features.multi_agent': false,
    'features.multi_agent_v2': false,
    'agents.enabled': false,
    'skills.include_instructions': false,
    'features.skip_host_skill_discovery': true,
    project_doc_max_bytes: 0,
    web_search: 'disabled',
    sandbox_mode: 'read-only',
    approval_policy: 'never',
    developer_instructions:
      'You are a snapshot-only design reviewer. Use only the design context and task supplied in the prompt. Return analysis and suggestions. Do not edit anything, read files, execute commands, use network services or spawn agents. Your result is advisory; the main agent owns all edits.'
  }
  if (requested?.model && requested.model !== 'default')
    config.model = requested.model.split('[')[0]
  if (requested?.effort) config.model_reasoning_effort = requested.effort
  return config
}
