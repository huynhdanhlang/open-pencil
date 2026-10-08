/** Only presentation invalidation is delayed; font resolution and graph mutation stay live. */
export function createFontStatusRefresh(refresh: () => void, shouldDefer: () => boolean) {
  let frame = 0
  let disposed = false

  function immediate() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (!disposed) refresh()
  }

  function mutated() {
    if (disposed) return
    if (!shouldDefer()) {
      immediate()
      return
    }
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      mutated()
    })
  }

  return {
    immediate,
    mutated,
    dispose() {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }
  }
}
