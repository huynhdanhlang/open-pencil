import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { FileSystemIconLoader } from 'unplugin-icons/loaders'

const require = createRequire(import.meta.url)

/**
 * Monochrome provider and agent logos from LobeHub, used as `<icon-ai-openai />` or
 * `~icons/ai/openai`. They draw with `currentColor` on a 24px grid, like Lucide.
 */
export function aiIconCollection() {
  const icons = join(dirname(require.resolve('@lobehub/icons-static-svg/package.json')), 'icons')
  // Titles would add tooltips and duplicate the accessible name of the label beside the logo.
  return FileSystemIconLoader(icons, (svg) => svg.replace(/<title>.*?<\/title>/, ''))
}
