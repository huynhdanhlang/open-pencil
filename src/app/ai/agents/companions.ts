const APP_VERSION =
  typeof __OPENPENCIL_APP_VERSION__ === 'string' ? __OPENPENCIL_APP_VERSION__ : '0.0.0-test'

function majorMinor(version: string): string | null {
  const match = /^(\d+)\.(\d+)/.exec(version)
  return match ? `${match[1]}.${match[2]}` : null
}

/**
 * Whether an installed OpenPencil companion (MCP server, Harness) is too old or new for this app.
 * Companions must match the app's major.minor version; an unknown version is not reported.
 */
export function isOutdatedCompanion(
  version: string | null | undefined,
  appVersion: string = APP_VERSION
): boolean {
  if (!version) return false
  return majorMinor(version) !== majorMinor(appVersion)
}

/** The command that replaces a global package with the package manager that installed it. */
export function globalInstallCommand(target: string, executablePath?: string | null): string {
  return executablePath?.includes('/.bun/') ? `bun add -g ${target}` : `npm i -g ${target}`
}
