/// <reference types="vite/client" />
import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm'

import { IS_BROWSER } from './constants'

let instance: CanvasKit | null = null
let initialization: Promise<CanvasKit> | null = null

export interface CanvasKitOptions {
  locateFile?: (file: string) => string
}

export async function getCanvasKit(options?: CanvasKitOptions): Promise<CanvasKit> {
  if (instance) return instance
  if (initialization) return initialization

  const defaultLocate = (file: string) => {
    if (!IS_BROWSER) {
      const ckPath = import.meta.resolve('canvaskit-wasm')
      return decodeURIComponent(new URL(file, ckPath).pathname)
    }
    const base = 'env' in import.meta ? import.meta.env.BASE_URL : '/'
    const prefix = base === '/' ? '' : base.replace(/\/$/, '')
    return `${prefix}/${file}`
  }

  // Scene, overlay and preview surfaces start together. Share the in-flight module,
  // not just its resolved value: native handles cannot cross WASM module instances.
  initialization = CanvasKitInit({
    locateFile: options?.locateFile ?? defaultLocate
  }).then((ck) => {
    instance = ck
    return ck
  })
  try {
    return await initialization
  } finally {
    // A failed initialization must not permanently poison subsequent attempts.
    initialization = null
  }
}
