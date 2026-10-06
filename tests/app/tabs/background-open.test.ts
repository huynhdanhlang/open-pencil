import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/scene-graph'

import { closeTab, createTab, getActiveStore, openFileInNewTab } from '@/app/tabs'

test('the native tab-opening path imports a real FIG while display frames are suspended', async () => {
  const originals = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
  )
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const requestFrame = (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  }
  Reflect.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      innerWidth: 1280,
      innerHeight: 800,
      openPencil: {},
      requestAnimationFrame: requestFrame,
      cancelAnimationFrame: (id: number) => frames.delete(id),
      addEventListener() {},
      removeEventListener() {},
      location: { href: 'http://localhost/' }
    }
  })
  Reflect.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { hidden: true, fonts: { add() {}, ready: Promise.resolve() } }
  })
  globalThis.requestAnimationFrame = requestFrame
  globalThis.cancelAnimationFrame = (id) => frames.delete(id)
  const graph = new SceneGraph()
  const frame = graph.createNode('FRAME', graph.getPages()[0].id, {
    name: 'Preserved design',
    width: 1600,
    height: 1000
  })
  graph.createNode('RECTANGLE', frame.id, { name: 'Real child', width: 120, height: 80 })
  const written = await new IORegistry(BUILTIN_IO_FORMATS).writeDocument('fig', graph)
  if (!(written.data instanceof Uint8Array)) throw new Error('FIG writer did not produce bytes')
  const file = new File([written.data.slice().buffer], 'background.fig')
  const tab = createTab()
  let opening: Promise<void> | undefined
  try {
    opening = openFileInNewTab(file, undefined, '/tmp/background.fig')
    const completed = await Promise.race([
      opening.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500))
    ])
    expect(completed).toBe(true)
    expect(getActiveStore().getDocumentFilePath()).toBe('/tmp/background.fig')
    expect(
      [...getActiveStore().graph.nodes.values()].some((node) => node.name === 'Real child')
    ).toBe(true)
    expect(getActiveStore().state.preparation).toBeNull()
  } finally {
    tab.store.preparationController.dispose()
    for (const callback of frames.values()) callback(0)
    frames.clear()
    await opening?.catch(() => undefined)
    await closeTab(tab.id, 'discard')
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}, 5000)
