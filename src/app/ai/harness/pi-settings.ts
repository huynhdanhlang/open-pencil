import * as v from 'valibot'

/** The settings Pi's CLI keeps next to its sign-ins; only non-secret fields are read. */
const piSettingsSchema = v.object({
  defaultModel: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1)))
})

export interface PiAccount {
  /** Pi's agent folder; the Harness companion reuses the sign-ins stored there. */
  agentDir: string
  /** Pi's default model, used when an OpenPencil Pi profile names none. */
  defaultModel: string | null
}

/** Reads the default model from Pi's `settings.json`; never touches `auth.json`. */
export function parsePiSettings(text: string): string | null {
  try {
    const parsed = v.safeParse(piSettingsSchema, JSON.parse(text))
    return parsed.success ? (parsed.output.defaultModel ?? null) : null
  } catch {
    return null
  }
}

/** Finds the Pi CLI's agent folder (`~/.pi/agent`) and its default model on the desktop. */
export async function readPiAccount(): Promise<PiAccount | null> {
  const [{ homeDir, join }, { readTextFile }] = await Promise.all([
    import('@tauri-apps/api/path'),
    import('@tauri-apps/plugin-fs')
  ])
  const home = await homeDir().catch(() => '')
  if (!home) return null
  const agentDir = await join(home, '.pi', 'agent')
  // The desktop capability allows reading only this file from Pi's folder.
  const settings = await readTextFile(await join(agentDir, 'settings.json')).catch(() => null)
  return { agentDir, defaultModel: settings ? parsePiSettings(settings) : null }
}
