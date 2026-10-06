/** Yield a browser task without depending on display frames or throttled timers. */
export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    let frame: number | undefined
    const finish = () => {
      channel.port1.close()
      channel.port2.close()
      if (frame !== undefined) cancelAnimationFrame(frame)
      resolve()
    }
    channel.port1.onmessage = finish
    frame = requestAnimationFrame(finish)
    channel.port2.postMessage(null)
  })
}
