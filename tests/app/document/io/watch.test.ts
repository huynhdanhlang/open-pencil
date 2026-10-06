import { expect, test } from 'bun:test'

import { createFileWatcher } from '@/app/document/io/watch'
import { createDeferred } from '@/app/runtime/deferred'

function fixture() {
  const registrations: {
    reload: () => void
    complete: () => void
    released: () => number
  }[] = []
  let reloads = 0
  const watcher = createFileWatcher(
    {
      getFilePath: () => '/owned.fig',
      getFileHandle: () => null,
      getLastWriteTime: () => 0,
      reloadFromDisk: () => {
        reloads++
      }
    },
    {
      isTauri: true,
      watchBrowserFile: async () => () => undefined,
      watchTauriFile: async (_path, _time, reload) => {
        const pending = createDeferred<() => void>()
        let released = 0
        registrations.push({
          reload,
          complete: () =>
            pending.resolve(() => {
              released++
            }),
          released: () => released
        })
        return pending.promise
      }
    }
  )
  return { watcher, registrations, reloads: () => reloads }
}

test('stop unregisters a file watch whose native registration completes late', async () => {
  const { watcher, registrations, reloads } = fixture()
  const pending = watcher.startWatchingFile()
  watcher.stopWatchingFile()
  registrations[0].complete()
  await pending
  registrations[0].reload()
  expect(registrations[0].released()).toBe(1)
  expect(reloads()).toBe(0)
})

test('overlapping registrations keep only the latest source watcher', async () => {
  const { watcher, registrations, reloads } = fixture()
  const first = watcher.startWatchingFile()
  const second = watcher.startWatchingFile()
  registrations[1].complete()
  await second
  registrations[0].complete()
  await first
  registrations[0].reload()
  registrations[1].reload()
  expect(reloads()).toBe(1)
  expect(registrations[0].released()).toBe(1)
  watcher.stopWatchingFile()
  expect(registrations[1].released()).toBe(1)
})

test('a disposed document cannot install or restart a file watcher', async () => {
  const { watcher, registrations, reloads } = fixture()
  const pending = watcher.startWatchingFile()
  watcher.dispose()
  registrations[0].complete()
  await pending
  registrations[0].reload()
  await watcher.startWatchingFile()
  expect(registrations).toHaveLength(1)
  expect(registrations[0].released()).toBe(1)
  expect(reloads()).toBe(0)
})
