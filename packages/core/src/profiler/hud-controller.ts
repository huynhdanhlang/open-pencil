import type { CanvasKit, Canvas, Typeface } from 'canvaskit-wasm'

import type { FrameStats } from './frame/stats'
import { HudRenderer } from './hud-renderer'
import type { PhaseTimer } from './phase-timer'

export class HudController {
  private hud: HudRenderer | null = null
  private typeface: Typeface | null = null

  constructor(private ck: CanvasKit) {}

  /** Takes ownership of the original handle; SkFonts hold their own native references. */
  setTypeface(typeface: Typeface): void {
    if (this.typeface === typeface) return
    this.hud?.setTypeface(typeface)
    this.typeface?.delete()
    this.typeface = typeface
  }

  draw(canvas: Canvas, stats: FrameStats, phases: PhaseTimer, showRulers: boolean): void {
    if (!this.hud) {
      this.hud = new HudRenderer(this.ck)
      if (this.typeface) this.hud.setTypeface(this.typeface)
    }
    this.hud.draw(canvas, stats, phases.averages, showRulers)
  }

  destroy(): void {
    this.hud?.destroy()
    this.hud = null
    this.typeface?.delete()
    this.typeface = null
  }
}
