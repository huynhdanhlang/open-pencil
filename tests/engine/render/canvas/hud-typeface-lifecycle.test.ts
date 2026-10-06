import { expect, mock, test } from 'bun:test'

import type { CanvasKit, Typeface } from 'canvaskit-wasm'

import { HudController } from '#core/profiler/hud-controller'

function face() {
  return { delete: mock() } as unknown as Typeface & { delete: ReturnType<typeof mock> }
}

test('HUD owns the original typeface even when never drawn, releasing replacement and final handles once', () => {
  const hud = new HudController({} as CanvasKit)
  const first = face()
  const next = face()
  hud.setTypeface(first)
  hud.setTypeface(first)
  expect(first.delete).not.toHaveBeenCalled()
  hud.setTypeface(next)
  expect(first.delete).toHaveBeenCalledTimes(1)
  expect(next.delete).not.toHaveBeenCalled()
  hud.destroy()
  hud.destroy()
  expect(next.delete).toHaveBeenCalledTimes(1)
})
